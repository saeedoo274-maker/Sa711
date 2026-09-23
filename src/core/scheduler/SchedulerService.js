const { nextOccurrence } = require("../utils/time");

const TICK_MS = 15_000;
const JOB_TIMEOUT_MS = 120_000;

/**
 * المجدول المركزي.
 *
 * كل مهمة مؤجلة (تذكير، إعلان مجدول، سحب مجدول، نسخ احتياطي، تنظيف...)
 * تُحفظ في `scheduled_jobs`، فتنجو من إعادة التشغيل.
 *
 * - مؤقّت واحد لكل البوت مهما كثرت المهام (نفس نهج السحوبات الحالي).
 * - الاستلام ذرّي: `UPDATE ... WHERE status = 'pending'` فلا تُنفَّذ مهمة مرتين.
 * - فشل مهمة يعيد المحاولة بتأخير متصاعد حتى `max_attempts` ثم تُعلَّم فاشلة.
 * - نوع غير معرّف (إضافة معطّلة) لا يُستلم أصلًا ويبقى منتظرًا.
 */
class SchedulerService {
  constructor(app) {
    this.app = app;
    this.repo = app.platform;
    this.handlers = new Map(); // type -> { handler, description }
    this.timer = null;
    this.running = false;
    this.stats = { ticks: 0, executed: 0, failed: 0, lastTickAt: null };
  }

  /**
   * يعرّف نوع مهمة.
   * handler(job, app) قد يرجع { payload } لتحديث حمولة المهمة المتكررة،
   * أو { done: true } لإنهاء مهمة متكررة.
   */
  define(type, handler, { description = "" } = {}) {
    if (typeof handler !== "function") throw new Error(`معالج المهمة ${type} ليس دالة`);
    this.handlers.set(type, { handler, description });
  }

  types() {
    return [...this.handlers.keys()];
  }

  /**
   * يجدول مهمة. `runAt` طابع زمني، أو يُحسب من `repeat` إن لم يُحدَّد.
   * `uniqueKey` يجعل الجدولة idempotent: إعادة الجدولة بنفس المفتاح تحدّث المهمة بدل تكرارها.
   */
  schedule({ type, guildId = null, payload = {}, runAt = null, repeat = null, uniqueKey = null, maxAttempts = 3, createdBy = null }) {
    let at = runAt;
    if (!at && repeat) at = nextOccurrence(repeat, Date.now());
    if (!at || !Number.isFinite(at)) throw new Error("موعد المهمة غير صالح");
    return this.repo.createJob({ type, guildId, payload, runAt: at, repeat, uniqueKey, maxAttempts, createdBy });
  }

  cancel(id) {
    return this.repo.cancelJob(id);
  }

  cancelByKey(uniqueKey) {
    return this.repo.cancelJobByKey(uniqueKey);
  }

  get(id) {
    return this.repo.job(id);
  }

  getByKey(key) {
    return this.repo.jobByKey(key);
  }

  reschedule(id, runAt, repeat = null) {
    return this.repo.rescheduleJob(id, runAt, repeat);
  }

  list(filter) {
    return this.repo.listJobs(filter);
  }

  start() {
    if (this.timer) return;
    const recovered = this.repo.recoverStuckJobs();
    if (recovered) this.app.logger.warn(`المجدول: أُعيدت ${recovered} مهمة عالقة إلى الانتظار.`);
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.app.errors.capture(err, { system: "scheduler" }));
    }, TICK_MS);
    if (this.timer.unref) this.timer.unref();
    this.app.logger.info(`المجدول يعمل (${this.handlers.size} نوع مهمة).`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** دورة واحدة: تنفّذ المهام المستحقة بالتتابع. تُستدعى من المؤقّت ومن الاختبارات. */
  async tick(now = Date.now()) {
    if (this.running) return 0; // دورة سابقة لم تنتهِ بعد — لا تداخل
    this.running = true;
    this.stats.ticks++;
    this.stats.lastTickAt = now;
    let executed = 0;
    try {
      const due = this.repo.dueJobs(this.types(), now);
      for (const job of due) {
        if (!this.repo.claimJob(job.id)) continue; // استلمها مسار آخر
        await this._execute({ ...job, attempts: job.attempts + 1 });
        executed++;
      }
    } finally {
      this.running = false;
    }
    return executed;
  }

  async _execute(job) {
    const entry = this.handlers.get(job.type);
    let timeoutHandle;
    try {
      const result = await Promise.race([
        Promise.resolve(entry.handler(job, this.app)),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`انتهت مهلة المهمة ${job.type}`)), JOB_TIMEOUT_MS);
          if (timeoutHandle.unref) timeoutHandle.unref();
        })
      ]);
      clearTimeout(timeoutHandle);
      this.stats.executed++;

      if (result?.payload) this.repo.updateJobPayload(job.id, result.payload);

      const next = !result?.done && job.repeat ? nextOccurrence(job.repeat, Math.max(Date.now(), job.run_at)) : null;
      if (next) this.repo.finishJob(job.id, { status: "pending", runAt: next, resetAttempts: true });
      else this.repo.finishJob(job.id, { status: "done" });
    } catch (error) {
      clearTimeout(timeoutHandle);
      this.stats.failed++;
      this.app.errors.capture(error, { system: `scheduler/${job.type}`, guildId: job.guild_id || undefined });
      if (job.attempts < job.max_attempts) {
        // تأخير متصاعد: 1، 4، 9 دقائق...
        const retryAt = Date.now() + job.attempts * job.attempts * 60_000;
        this.repo.finishJob(job.id, { status: "pending", runAt: retryAt, error: error.message });
      } else if (job.repeat) {
        // المهمة المتكررة لا تموت بسبب فشل موعد واحد — تنتقل للموعد التالي
        const next = nextOccurrence(job.repeat, Date.now());
        this.repo.finishJob(job.id, next ? { status: "pending", runAt: next, error: error.message, resetAttempts: true } : { status: "failed", error: error.message });
      } else {
        this.repo.finishJob(job.id, { status: "failed", error: error.message });
      }
    }
  }

  status() {
    const counts = Object.fromEntries(this.repo.jobCounts().map((r) => [r.status, r.c]));
    return { ...this.stats, running: !!this.timer, types: this.types(), counts };
  }
}

module.exports = SchedulerService;
