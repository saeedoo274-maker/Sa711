const DAY = 86_400_000;
const BATCH = 5000;
const STATE_KEY = "cleanup.policies";

/**
 * مدير التنظيف: سياسات احتفاظ للبيانات التي تنمو بلا حد.
 *
 *  - كل مهمة لها مدة احتفاظ افتراضية (0 = معطّلة) قابلة للتغيير عبر /مطور cleanup
 *  - المعاينة تعدّ الصفوف فقط، والتنفيذ يحذف على دفعات صغيرة (لا أقفال طويلة)
 *  - المهام التي جدولها غير موجود (إضافة غير مثبتة) تُتخطى تلقائيًا
 *  - السجلات المالية والقضايا والتذاكر لا تُحذف افتراضيًا
 *  - بيانات السيرفرات التي غادرها البوت: سياسة اختيارية (معطّلة افتراضيًا)
 */
class CleanupService {
  constructor(app) {
    this.app = app;
    this.tasks = new Map();
    this.lastRun = null;
    this._registerDefaults();
  }

  register({ key, label, table, dateColumn, where = "1=1", days = 0 }) {
    this.tasks.set(key, { key, label, table, dateColumn, where, days });
  }

  _registerDefaults() {
    const r = (key, label, table, dateColumn, where, days) => this.register({ key, label, table, dateColumn, where, days });
    r("errors", "سجل الأخطاء", "error_logs", "created_at", "1=1", 90);
    r("scheduler", "مهام المجدول المنتهية", "scheduled_jobs", "updated_at", "status IN ('done','cancelled','failed')", 30);
    r("queue", "مهام الطابور المنتهية", "queue_jobs", "created_at", "status IN ('done','cancelled','failed')", 30);
    r("maintenanceLog", "سجل الصيانة", "maintenance_log", "created_at", "1=1", 180);
    r("abuseEvents", "أحداث حارس الإغراق", "abuse_events", "created_at", "1=1", 90);
    r("gameSessions", "جلسات الألعاب المنتهية", "game_sessions", "created_at", "status != 'active'", 60);
    r("presenceLog", "سجل دخول/خروج الأعضاء", "member_presence_log", "at", "1=1", 365);
    r("announcements", "مسودات وإعلانات ملغاة", "announcements", "created_at", "status IN ('draft','cancelled','failed')", 30);
    r("inviteLeft", "دعوات من غادروا", "invite_joins", "joined_at", "left_at IS NOT NULL", 365);
    r("ticketEvents", "خط زمني للتذاكر المغلقة", "ticket_events", "created_at", "ticket_id IN (SELECT id FROM tickets WHERE status = 'closed')", 0);
    r("transactions", "سجل المعاملات المالية", "transactions", "created_at", "1=1", 0);
    r("webSessions", "جلسات لوحة التحكم المنتهية", "web_sessions", "expires_at", "1=1", 1);
  }

  policies() {
    return this.app.platform.getState(STATE_KEY, {}) || {};
  }

  /** days = null يعيد الافتراضي، 0 يعطّل. */
  setPolicy(key, days) {
    if (!this.tasks.has(key) && key !== "leftGuilds") return false;
    const p = this.policies();
    if (days === null || days === undefined) delete p[key];
    else p[key] = Math.max(0, Math.min(3650, Math.floor(days)));
    this.app.platform.setState(STATE_KEY, p);
    return true;
  }

  daysFor(key) {
    const p = this.policies();
    if (p[key] !== undefined) return p[key];
    return key === "leftGuilds" ? 0 : this.tasks.get(key)?.days ?? 0;
  }

  _exists(table) {
    return !!this.app.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  }

  _hasColumn(table, column) {
    return this.app.db.prepare(`PRAGMA table_info("${table}")`).all().some((c) => c.name === column);
  }

  /** معاينة أو تنفيذ. يُرجع صفًا لكل مهمة. */
  run({ dryRun = true, only = null, now = Date.now() } = {}) {
    const rows = [];
    for (const task of this.tasks.values()) {
      if (only && task.key !== only) continue;
      const days = this.daysFor(task.key);
      if (!days) {
        rows.push({ key: task.key, label: task.label, days, skipped: "disabled", count: 0 });
        continue;
      }
      if (!this._exists(task.table)) {
        rows.push({ key: task.key, label: task.label, days, skipped: "missing", count: 0 });
        continue;
      }
      const cutoff = now - days * DAY;
      const cond = `(${task.where}) AND ${task.dateColumn} < ?`;
      let count = this.app.db.prepare(`SELECT COUNT(*) AS c FROM "${task.table}" WHERE ${cond}`).get(cutoff).c;
      if (!dryRun && count) {
        let removed = 0;
        const stmt = this.app.db.prepare(`DELETE FROM "${task.table}" WHERE rowid IN (SELECT rowid FROM "${task.table}" WHERE ${cond} LIMIT ${BATCH})`);
        for (;;) {
          const n = stmt.run(cutoff).changes;
          removed += n;
          if (n < BATCH) break;
        }
        count = removed;
      }
      rows.push({ key: task.key, label: task.label, days, count });
    }
    if (!only || only === "leftGuilds") rows.push(this._leftGuilds({ dryRun, now }));
    const report = { at: now, dryRun, rows, total: rows.reduce((a, r) => a + r.count, 0) };
    if (!dryRun) {
      this.lastRun = report;
      this.app.logger.info(`التنظيف: حُذف ${report.total} صفًا.`);
    }
    return report;
  }

  /** حذف بيانات السيرفرات التي غادرها البوت منذ مدة (معطّل افتراضيًا). */
  _leftGuilds({ dryRun, now }) {
    const days = this.daysFor("leftGuilds");
    const row = { key: "leftGuilds", label: "بيانات سيرفرات غادرها البوت", days, count: 0 };
    if (!days) return { ...row, skipped: "disabled" };
    if (!this._exists("guild_registry")) return { ...row, skipped: "missing" };
    const cutoff = now - days * DAY;
    const current = new Set(this.app.client.guilds?.cache?.keys?.() || []);
    const left = this.app.db.prepare("SELECT guild_id FROM guild_registry WHERE status = 'left' AND left_at IS NOT NULL AND left_at < ?").all(cutoff)
      .map((r) => r.guild_id).filter((id) => !current.has(id));
    row.guilds = left.length;
    if (!left.length) return row;
    const tables = this.app.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'guild_registry'").all().map((t) => t.name)
      .filter((t) => this._hasColumn(t, "guild_id"));
    for (const guildId of left) {
      for (const t of tables) {
        row.count += dryRun
          ? this.app.db.prepare(`SELECT COUNT(*) AS c FROM "${t}" WHERE guild_id = ?`).get(guildId).c
          : this.app.db.prepare(`DELETE FROM "${t}" WHERE guild_id = ?`).run(guildId).changes;
      }
      if (!dryRun) {
        this.app.db.prepare("DELETE FROM guilds WHERE id = ?").run(guildId);
        this.app.db.prepare("UPDATE guild_registry SET status = 'purged' WHERE guild_id = ?").run(guildId);
      }
    }
    return row;
  }
}

module.exports = CleanupService;
