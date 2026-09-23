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

    this._instrumentTransactions();
    this.runMigrations(this.extraMigrationSources || []);
    this.logger.info(`قاعدة البيانات جاهزة: ${this.dbPath}`);
    return this.db;
  }

  /**
   * يطبّق الهجرات الأساسية ثم هجرات الإضافات.
   * كل ملف هجرة يُطبَّق مرة واحدة فقط ويُسجَّل في `_migrations`.
   * الهجرات الجديدة قد تحوي قسم `-- @down` للتراجع؛ القسم لا يُنفَّذ عند التطبيق.
   */
  runMigrations(extraSources = []) {
    const dir = path.join(__dirname, "migrations");

    this.db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`);

    const applied = new Set(this.db.prepare("SELECT name FROM _migrations").all().map((r) => r.name));
    const sources = [];
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
        sources.push({ name: file, file: path.join(dir, file) });
      }
    }
    // هجرات الإضافات تُسجَّل باسم مميّز حتى لا تتصادم مع الأساسية
    for (const src of extraSources) {
      if (!fs.existsSync(src.dir)) continue;
      for (const file of fs.readdirSync(src.dir).filter((f) => f.endsWith(".sql")).sort()) {
        sources.push({ name: `plugin/${src.plugin}/${file}`, file: path.join(src.dir, file) });
      }
    }

    let count = 0;
    for (const { name, file } of sources) {
      if (applied.has(name)) continue;
      const { up } = DatabaseService.splitMigration(fs.readFileSync(file, "utf8"));
      // كل هجرة داخل transaction: إما تُطبَّق كاملة أو لا تُطبَّق إطلاقًا
      const migrate = this.db.transaction(() => {
        this.db.exec(up);
        this.db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(name, Date.now());
      });
      migrate();
      count++;
      this.logger.info(`تم تطبيق الهجرة: ${name}`);
    }
    this._migrationSources = sources;
    return count;
  }

  /** يفصل قسم التطبيق عن قسم التراجع في ملف الهجرة. */
  static splitMigration(sql) {
    const marker = sql.search(/^--\s*@down\s*$/m);
    if (marker === -1) return { up: sql, down: null };
    return { up: sql.slice(0, marker), down: sql.slice(marker).replace(/^--\s*@down\s*$/m, "").trim() || null };
  }

  /** قائمة الهجرات مع حالتها وإمكانية التراجع عنها. */
  migrationStatus() {
    const applied = new Map(this.db.prepare("SELECT name, applied_at FROM _migrations").all().map((r) => [r.name, r.applied_at]));
    return (this._migrationSources || []).map(({ name, file }) => {
      const { down } = DatabaseService.splitMigration(fs.readFileSync(file, "utf8"));
      return { name, appliedAt: applied.get(name) || null, reversible: !!down };
    });
  }

  /**
   * يتراجع عن آخر هجرة مطبّقة (أو هجرة محددة) إن كان لها قسم `@down`.
   * الهجرات القديمة بلا قسم تراجع ترفض بوضوح بدل حذف بيانات بشكل غير مضمون.
   */
  rollback(name = null) {
    const status = this.migrationStatus().filter((m) => m.appliedAt);
    const target = name ? status.find((m) => m.name === name) : status.sort((a, b) => b.appliedAt - a.appliedAt || b.name.localeCompare(a.name))[0];
    if (!target) return { ok: false, reason: "notFound" };
    const src = this._migrationSources.find((s) => s.name === target.name);
    const { down } = DatabaseService.splitMigration(fs.readFileSync(src.file, "utf8"));
    if (!down) return { ok: false, reason: "irreversible", name: target.name };
    this.db.transaction(() => {
      this.db.exec(down);
      this.db.prepare("DELETE FROM _migrations WHERE name = ?").run(target.name);
    })();
    this.logger.warn(`تم التراجع عن الهجرة: ${target.name}`);
    return { ok: true, name: target.name };
  }

  /** فحص سلامة قاعدة البيانات والمفاتيح الأجنبية. */
  integrityCheck() {
    const integrity = this.db.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]);
    let foreignKeys = [];
    try {
      foreignKeys = this.db.prepare("PRAGMA foreign_key_check").all();
    } catch (error) {
      this.logger.warn(`تعذّر فحص المفاتيح الأجنبية: ${error.message}`);
    }
    return { ok: integrity.length === 1 && integrity[0] === "ok" && foreignKeys.length === 0, integrity, foreignKeys: foreignKeys.slice(0, 20) };
  }

  /** ينفذ دالة داخل معاملة ذرية. أي استثناء يُرجع كل التغييرات. */
  transaction(fn) {
    return this.db.transaction(fn);
  }

  /**
   * يغلّف دالة المعاملات في المحرك لقياس عددها ومدتها وفشلها،
   * دون تغيير سلوكها — كل المستودعات تستفيد تلقائيًا.
   */
  _instrumentTransactions() {
    const stats = (this.txStats = { total: 0, failed: 0, totalMs: 0, slowest: 0, lastError: null });
    const original = this.db.transaction.bind(this.db);
    this.db.transaction = (fn) => {
      const wrapped = original(fn);
      return (...args) => {
        const started = process.hrtime.bigint();
        try {
          return wrapped(...args);
        } catch (error) {
          stats.failed++;
          stats.lastError = error.message;
          throw error;
        } finally {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          stats.total++;
          stats.totalMs += ms;
          if (ms > stats.slowest) stats.slowest = ms;
        }
      };
    };
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
