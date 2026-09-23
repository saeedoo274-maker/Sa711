const { DatabaseSync } = require("node:sqlite");

/**
 * محرّك قاعدة بيانات مبني على SQLite المدمج في Node 22+.
 *
 * فائدته: لا يحتاج تثبيت أي مكتبة خارجية ولا أدوات بناء (node-gyp)،
 * فيعمل على الاستضافات التي تمنع سكربتات التثبيت.
 * يقدّم نفس واجهة better-sqlite3 حتى لا تعرف بقية طبقات المشروع أي محرّك يعمل تحتها.
 */
class Statement {
  constructor(stmt) {
    this.stmt = stmt;
  }

  /** يوحّد شكل المعاملات ويحوّل undefined إلى null لأن SQLite لا يقبلها. */
  _params(args) {
    if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) {
      const out = {};
      for (const [key, value] of Object.entries(args[0])) out[key] = value === undefined ? null : value;
      return [out];
    }
    return args.map((a) => (a === undefined ? null : a));
  }

  run(...args) {
    const result = this.stmt.run(...this._params(args));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid)
    };
  }

  get(...args) {
    return this.stmt.get(...this._params(args));
  }

  all(...args) {
    return this.stmt.all(...this._params(args));
  }
}

class NodeSqliteDatabase {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this._inTransaction = false;
  }

  pragma(statement) {
    // بعض التوجيهات غير مدعومة في المحرّك المدمج، وتجاهلها آمن
    try {
      this.db.exec(`PRAGMA ${statement}`);
    } catch { /* تجاهل متعمّد */ }
  }

  exec(sql) {
    this.db.exec(sql);
  }

  prepare(sql) {
    return new Statement(this.db.prepare(sql));
  }

  /** معاملة ذرّية بنفس سلوك better-sqlite3، مع دعم التداخل. */
  transaction(fn) {
    return (...args) => {
      if (this._inTransaction) return fn(...args);
      this._inTransaction = true;
      this.db.exec("BEGIN");
      try {
        const result = fn(...args);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        try { this.db.exec("ROLLBACK"); } catch { /* المعاملة سقطت أصلًا */ }
        throw error;
      } finally {
        this._inTransaction = false;
      }
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = NodeSqliteDatabase;
