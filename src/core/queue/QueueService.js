const POLL_MS = 2_000;

/**
 * طابور المهام الثقيلة مع عمّال (Workers).
 *
 * الأحداث (مثل ضغطة زر "أرسل للجميع") لا تنفّذ العمل الثقيل بنفسها؛
 * تضيف مهمة للطابور وتعود فورًا، والعامل ينفّذها بالخلفية مع:
 *  - حد تزامن لكل طابور (الإذاعة واحدة في كل لحظة مثلًا)
 *  - تقدّم محفوظ يظهر للمستخدم (`progress/total`)
 *  - إلغاء أثناء التنفيذ (العامل يفحص `isCancelled()` بين الخطوات)
 *  - إعادة محاولة بتأخير متصاعد، واستئناف المهام العالقة بعد إعادة التشغيل
 */
class QueueService {
  constructor(app) {
    this.app = app;
    this.repo = app.platform;
    this.queues = new Map(); // name -> { handler, concurrency, description }
    this.active = new Map(); // name -> عدد العمّال العاملين الآن في هذه العملية
    this.timer = null;
    this.stats = { processed: 0, failed: 0 };
    this.stopped = false;
  }

  /**
   * يعرّف طابورًا.
   * handler(job, tools) حيث tools = { progress(done, total), isCancelled(), sleep(ms) }
   * ويرجع نتيجة تُحفظ مع المهمة.
   */
  define(name, handler, { concurrency = 1, description = "" } = {}) {
    this.queues.set(name, { handler, concurrency: Math.max(1, concurrency), description });
    if (!this.active.has(name)) this.active.set(name, 0);
  }

  add(name, payload = {}, { guildId = null, maxAttempts = 3, delayMs = 0, createdBy = null } = {}) {
    if (!this.queues.has(name)) throw new Error(`طابور غير معروف: ${name}`);
    const job = this.repo.enqueue({ queue: name, guildId, payload, maxAttempts, availableAt: Date.now() + delayMs, createdBy });
    // لا ننتظر المؤقّت: نحاول البدء فورًا
    setImmediate(() => !this.stopped && this.pump(name).catch((err) => this.app.errors.capture(err, { system: `queue/${name}` })));
    return job;
  }

  get(id) {
    return this.repo.queueJob(id);
  }

  cancel(id) {
    return this.repo.cancelQueueJob(id);
  }

  list(filter) {
    return this.repo.listQueue(filter);
  }

  start() {
    if (this.timer) return;
    this.stopped = false;
    const recovered = this.repo.recoverStuckQueue();
    if (recovered) this.app.logger.warn(`الطابور: استُؤنفت ${recovered} مهمة توقفت أثناء التنفيذ.`);
    this.timer = setInterval(() => {
      for (const name of this.queues.keys()) {
        this.pump(name).catch((err) => this.app.errors.capture(err, { system: `queue/${name}` }));
      }
    }, POLL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** يشغّل ما يسمح به حد التزامن من مهام الطابور. */
  async pump(name) {
    const queue = this.queues.get(name);
    if (!queue || this.stopped) return;
    const running = [];
    while ((this.active.get(name) || 0) < queue.concurrency) {
      const job = this.repo.nextQueueJob(name);
      if (!job || !this.repo.claimQueueJob(job.id)) break;
      this.active.set(name, (this.active.get(name) || 0) + 1);
      running.push(
        this._run(queue, { ...job, attempts: job.attempts + 1 }).finally(() => {
          this.active.set(name, Math.max(0, (this.active.get(name) || 1) - 1));
        })
      );
    }
    await Promise.all(running);
  }

  async _run(queue, job) {
    const tools = {
      progress: (done, total) => this.repo.queueProgress(job.id, done, total),
      isCancelled: () => this.repo.isQueueJobCancelled(job.id),
      sleep: (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); })
    };
    try {
      const result = await queue.handler(job, tools, this.app);
      if (tools.isCancelled()) return;
      this.repo.finishQueueJob(job.id, { status: "done", result: result ?? null });
      this.stats.processed++;
    } catch (error) {
      this.stats.failed++;
      this.app.errors.capture(error, { system: `queue/${job.queue}`, guildId: job.guild_id || undefined });
      if (job.attempts < job.max_attempts) {
        this.repo.finishQueueJob(job.id, { status: "pending", error: error.message, availableAt: Date.now() + job.attempts * 30_000 });
      } else {
        this.repo.finishQueueJob(job.id, { status: "failed", error: error.message });
      }
    }
  }

  status() {
    const counts = {};
    for (const row of this.repo.queueCounts()) {
      counts[row.queue] = counts[row.queue] || {};
      counts[row.queue][row.status] = row.c;
    }
    return { ...this.stats, queues: [...this.queues.keys()], counts };
  }
}

module.exports = QueueService;
