const fs = require("node:fs");
const path = require("node:path");

/**
 * نسخ احتياطي دوري لقاعدة البيانات.
 *
 * لماذا؟ على منصات مثل Railway، كل نشر جديد يستبدل الحاوية.
 * البيانات تنجو فقط إذا كانت على Volume دائم — والنسخ الاحتياطي
 * يحميك إضافةً من الحذف الخاطئ أو تلف الملف.
 *
 * النسخ تُكتب داخل نفس مجلد البيانات، فتنجو مع القاعدة نفسها.
 */
class BackupService {
  constructor(app) {
    this.app = app;
    this.timer = null;
  }

  get dir() {
    return path.join(path.dirname(this.app.database.dbPath), "backups");
  }

  get intervalMs() {
    const hours = parseInt(process.env.BACKUP_INTERVAL_HOURS || "6", 10);
    return Math.max(1, hours) * 3_600_000;
  }

  get keep() {
    return Math.max(1, parseInt(process.env.BACKUP_KEEP || "10", 10));
  }

  start() {
    if (process.env.BACKUP_ENABLED === "false") {
      this.app.logger.info("النسخ الاحتياطي معطّل عبر BACKUP_ENABLED=false");
      return;
    }
    this.timer = setInterval(() => {
      this.run().catch((err) => this.app.errors.capture(err, { system: "backup" }));
    }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
    this.app.logger.info(`النسخ الاحتياطي كل ${this.intervalMs / 3_600_000} ساعة، مع الاحتفاظ بآخر ${this.keep} نسخة.`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * ينشئ نسخة احتياطية.
   * تُستخدم آلية النسخ المدمجة في المحرّك إن توفّرت، لأنها تضمن
   * نسخة متسقة حتى أثناء الكتابة، بخلاف نسخ الملف يدويًا.
   */
  async run() {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });

    // الطابع يشمل الميلي ثانية، وإن تصادف نضيف لاحقة —
    // فنسختان في نفس الثانية لا تتعارضان (يحدث عند النسخ اليدوي المتتالي)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
    let target = path.join(this.dir, `bot-${stamp}.db`);
    let suffix = 1;
    while (fs.existsSync(target)) {
      target = path.join(this.dir, `bot-${stamp}-${suffix++}.db`);
    }

    try {
      const db = this.app.database.db;
      if (typeof db.backup === "function") {
        await db.backup(target);
      } else {
        // بديل آمن: VACUUM INTO ينتج ملفًا متسقًا بلا قفل طويل
        db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      }
    } catch (error) {
      this.app.logger.error(`فشل النسخ الاحتياطي: ${error.message}`);
      return { ok: false, error: error.message };
    }

    const removed = this.rotate();
    const size = fs.existsSync(target) ? fs.statSync(target).size : 0;
    this.app.logger.info(`نسخة احتياطية: ${path.basename(target)} (${Math.round(size / 1024)} KB)`);

    return { ok: true, file: path.basename(target), sizeBytes: size, removed };
  }

  /** يحذف النسخ الأقدم ويُبقي العدد المحدد. */
  rotate() {
    if (!fs.existsSync(this.dir)) return 0;
    const files = fs
      .readdirSync(this.dir)
      .filter((f) => f.startsWith("bot-") && f.endsWith(".db"))
      .sort()
      .reverse();

    let removed = 0;
    for (const file of files.slice(this.keep)) {
      try {
        fs.unlinkSync(path.join(this.dir, file));
        removed++;
      } catch { /* تجاهل: النسخة قد تكون محذوفة أصلًا */ }
    }
    return removed;
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.startsWith("bot-") && f.endsWith(".db"))
      .sort()
      .reverse()
      .map((f) => {
        const stat = fs.statSync(path.join(this.dir, f));
        return { file: f, sizeBytes: stat.size, createdAt: stat.mtimeMs };
      });
  }
}

module.exports = BackupService;
