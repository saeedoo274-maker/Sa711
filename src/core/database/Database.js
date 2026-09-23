const fs = require("fs");
const path = require("path");

/**
 * يختار محرّك قاعدة البيانات المتاح تلقائيًا.
 *
 * الترتيب:
 *  1) better-sqlite3 إن كان مثبّتًا ومبنيًا (الأسرع).
 *  2) SQLite المدمج في Node 22+ — بلا أي مكتبة خارجية ولا أدوات بناء.
 *
 * الفائدة: على الاستضافات التي تمنع سكربتات التثبيت (node-gyp)،
 * يعمل البوت بلا أي تدخّل يدوي طالما إصدار Node مناسب.
 */
function selectDriver(logger) {
  try {
    const BetterSqlite3 = require("better-sqlite3");
    logger.info("محرّك قاعدة البيانات: better-sqlite3");
    return BetterSqlite3;
  } catch { /* غير مثبّت أو لم يُبنَ — نجرّب البديل */ }

  try {
    require("node:sqlite");
    const NodeSqlite = require("./drivers/NodeSqliteDriver");
    logger.info("محرّك قاعدة البيانات: SQLite المدمج في Node");
    return NodeSqlite;
  } catch { /* إصدار Node أقدم من 22 */ }

  const version = process.versions.node;
  const major = parseInt(version.split(".")[0], 10);
  const lines = [`لا يوجد محرّك قاعدة بيانات صالح. إصدار Node الحالي: ${version}`, ""];

  if (major < 22) {
    lines.push(
      "أسهل حل: غيّر إصدار Node إلى 22 من إعدادات الاستضافة (Startup ← Node Version).",
      "بعدها سيعمل البوت مباشرة بلا أي تثبيت إضافي، لأن Node 22 فيه SQLite مدمج.",
      "",
      "أو ثبّت المكتبة يدويًا من الكونسول:",
      "  npm install better-sqlite3 --foreground-scripts"
    );
  } else {
    lines.push("شغّل من الكونسول: npm install");
  }

  throw new Error(lines.join("\n"));
}

/**
 * طبقة قاعدة البيانات.
 * SQLite تم اختيارها لأنها قاعدة بيانات حقيقية بمعاملات ACID (ضرورية لمنع Race Conditions)
 * ولا تحتاج خادمًا خارجيًا، فتعمل على أي استضافة.
 * للانتقال إلى Postgres/MySQL: استبدل هذا الملف وطبقة Repositories فقط،
 * لأن باقي المشروع لا يتعامل مع SQL مباشرة. راجع ARCHITECTURE.md.
 */
class DatabaseService {
  constructor(logger, dbPath) {
    this.logger = logger;
    this.dbPath = dbPath || "./data/bot.db";
    this.db = null;
  }

  connect() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const Driver = selectDriver(this.logger);
    this.db = new Driver(this.dbPath);
    // WAL يحسّن الأداء ويسمح بقراءات متوازية مع الكتابة
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    // يمنع أخطاء القفل عند التزامن العالي
    this.db.pragma("busy_timeout = 5000");

    this.runMigrations();
    this.logger.info(`قاعدة البيانات جاهزة: ${this.dbPath}`);
    return this.db;
  }

  runMigrations() {
    const dir = path.join(__dirname, "migrations");
    if (!fs.existsSync(dir)) return;

    this.db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`);

    const applied = new Set(this.db.prepare("SELECT name FROM _migrations").all().map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      // كل هجرة داخل transaction: إما تُطبَّق كاملة أو لا تُطبَّق إطلاقًا
      const migrate = this.db.transaction(() => {
        this.db.exec(sql);
        this.db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
      });
      migrate();
      this.logger.info(`تم تطبيق الهجرة: ${file}`);
    }
  }

  /** ينفذ دالة داخل معاملة ذرية. أي استثناء يُرجع كل التغييرات. */
  transaction(fn) {
    return this.db.transaction(fn);
  }

  stats() {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    const counts = {};
    for (const t of tables) {
      try {
        counts[t] = this.db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
      } catch {
        counts[t] = -1;
      }
    }
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(this.dbPath).size;
    } catch { /* الملف قد لا يكون موجودًا بعد */ }
    return { path: this.dbPath, tables: counts, sizeBytes };
  }

  close() {
    if (this.db) this.db.close();
  }
}

module.exports = DatabaseService;
