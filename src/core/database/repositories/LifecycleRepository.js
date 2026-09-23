const TABLES = {
  leave: "leave_requests",
  resign: "resignations",
  report: "admin_reports"
};

/**
 * سجلات دورة حياة الطاقم.
 *
 * الترقيم متسلسل ومستقل لكل سيرفر **ولكل نوع**، فالإجازة رقم 1 والاستقالة رقم 1
 * والبلاغ رقم 1 يتعايشون بلا تعارض.
 *
 * كل جدول يحمل `guild_id` وكل استعلام يفلتر به — وهذا ما كان ناقصًا في النظام المصدر.
 */
class LifecycleRepository {
  constructor(db) {
    this.db = db;

    this._nextNumber = db.transaction((guildId, kind) => {
      db.prepare("INSERT INTO lifecycle_counters (guild_id, kind, last_number) VALUES (?, ?, 0) ON CONFLICT(guild_id, kind) DO NOTHING")
        .run(guildId, kind);
      db.prepare("UPDATE lifecycle_counters SET last_number = last_number + 1 WHERE guild_id = ? AND kind = ?").run(guildId, kind);
      return db.prepare("SELECT last_number FROM lifecycle_counters WHERE guild_id = ? AND kind = ?").get(guildId, kind).last_number;
    });
  }

  _table(kind) {
    const table = TABLES[kind];
    if (!table) throw new Error(`نوع غير مسموح: ${kind}`);
    return table;
  }

  _hydrate(kind, row) {
    if (!row) return null;
    const out = { ...row, kind };
    if (row.saved_roles !== undefined) out.saved_roles = JSON.parse(row.saved_roles || "[]");
    if (row.evidence !== undefined) out.evidence = JSON.parse(row.evidence || "[]");
    return out;
  }

  // ---------------- الإجازات ----------------

  createLeave({ guildId, userId, reason, durationMs }) {
    const create = this.db.transaction(() => {
      const number = this._nextNumber(guildId, "leave");
      this.db
        .prepare(
          `INSERT INTO leave_requests (guild_id, number, user_id, reason, duration_ms, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`
        )
        .run(guildId, number, userId, reason || null, durationMs || null, Date.now());
      return number;
    });
    return this.get("leave", guildId, create());
  }

  /** يبدأ الإجازة فعليًا: يحفظ الرتب المسحوبة ويحدد موعد الانتهاء. */
  activateLeave(id, { reviewerId, savedRoles, endsAt }) {
    const changed = this.db
      .prepare(
        `UPDATE leave_requests SET status = 'active', reviewer_id = ?, reviewed_at = ?, saved_roles = ?, ends_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(reviewerId, Date.now(), JSON.stringify(savedRoles || []), endsAt || null, id).changes === 1;
    return changed;
  }

  /** إنهاء الإجازة ذرّيًا: تنجح مرة واحدة فقط مهما تعدد المستدعون. */
  endLeave(id) {
    return this.db
      .prepare("UPDATE leave_requests SET status = 'ended' WHERE id = ? AND status = 'active'")
      .run(id).changes === 1;
  }

  activeLeave(guildId, userId) {
    return this._hydrate(
      "leave",
      this.db
        .prepare("SELECT * FROM leave_requests WHERE guild_id = ? AND user_id = ? AND status = 'active'")
        .get(guildId, userId)
    );
  }

  dueLeaves(now = Date.now()) {
    return this.db
      .prepare("SELECT * FROM leave_requests WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ?")
      .all(now)
      .map((r) => this._hydrate("leave", r));
  }

  // ---------------- الاستقالات ----------------

  createResignation({ guildId, userId, reason }) {
    const create = this.db.transaction(() => {
      const number = this._nextNumber(guildId, "resign");
      this.db
        .prepare("INSERT INTO resignations (guild_id, number, user_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)")
        .run(guildId, number, userId, reason || null, Date.now());
      return number;
    });
    return this.get("resign", guildId, create());
  }

  completeResignation(id, { reviewerId, savedRoles }) {
    return this.db
      .prepare(
        `UPDATE resignations SET status = 'accepted', reviewer_id = ?, reviewed_at = ?, saved_roles = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(reviewerId, Date.now(), JSON.stringify(savedRoles || []), id).changes === 1;
  }

  // ---------------- البلاغات ----------------

  createReport(data) {
    const create = this.db.transaction(() => {
      const number = this._nextNumber(data.guildId, "report");
      this.db
        .prepare(
          `INSERT INTO admin_reports
             (guild_id, number, reporter_id, target_id, reason, incident_at, place, evidence, witnesses, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
        )
        .run(
          data.guildId, number, data.reporterId, data.targetId, data.reason,
          data.incidentAt || null, data.place || null,
          JSON.stringify(data.evidence || []), data.witnesses || null, Date.now()
        );
      return number;
    });
    return this.get("report", data.guildId, create());
  }

  acceptReport(id, { reviewerId, note, warningLevel }) {
    return this.db
      .prepare(
        `UPDATE admin_reports SET status = 'accepted', reviewer_id = ?, reviewed_at = ?, note = ?, warning_level = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(reviewerId, Date.now(), note || null, warningLevel || null, id).changes === 1;
  }

  /** عدد البلاغات المقبولة على إداري — يحدد درجة التحذير التالية. */
  acceptedAgainst(guildId, targetId) {
    return this.db
      .prepare("SELECT COUNT(*) AS c FROM admin_reports WHERE guild_id = ? AND target_id = ? AND status = 'accepted'")
      .get(guildId, targetId).c;
  }

  lastReportBy(guildId, reporterId) {
    return this._hydrate(
      "report",
      this.db
        .prepare("SELECT * FROM admin_reports WHERE guild_id = ? AND reporter_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(guildId, reporterId)
    );
  }

  // ---------------- مشترك ----------------

  get(kind, guildId, number) {
    const table = this._table(kind);
    // اسم الجدول من قائمة بيضاء ثابتة، ولا يأتي من مدخلات المستخدم إطلاقًا
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE guild_id = ? AND number = ?`).get(guildId, number);
    return this._hydrate(kind, row);
  }

  getById(kind, guildId, id) {
    const table = this._table(kind);
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE guild_id = ? AND id = ?`).get(guildId, id);
    return this._hydrate(kind, row);
  }

  reject(kind, id, { reviewerId, note }) {
    const table = this._table(kind);
    return this.db
      .prepare(`UPDATE ${table} SET status = 'rejected', reviewer_id = ?, reviewed_at = ?, note = ? WHERE id = ? AND status = 'pending'`)
      .run(reviewerId, Date.now(), note || null, id).changes === 1;
  }

  pendingFor(kind, guildId, userId) {
    const table = this._table(kind);
    const column = kind === "report" ? "reporter_id" : "user_id";
    const row = this.db
      .prepare(`SELECT * FROM ${table} WHERE guild_id = ? AND ${column} = ? AND status = 'pending'`)
      .get(guildId, userId);
    return this._hydrate(kind, row);
  }

  setMessage(kind, id, channelId, messageId) {
    const table = this._table(kind);
    this.db.prepare(`UPDATE ${table} SET channel_id = ?, message_id = ? WHERE id = ?`).run(channelId, messageId, id);
  }

  listPending(kind, guildId, limit = 15) {
    const table = this._table(kind);
    return this.db
      .prepare(`SELECT * FROM ${table} WHERE guild_id = ? AND status = 'pending' ORDER BY number ASC LIMIT ?`)
      .all(guildId, limit)
      .map((r) => this._hydrate(kind, r));
  }

  history(kind, guildId, userId, limit = 10) {
    const table = this._table(kind);
    const column = kind === "report" ? "target_id" : "user_id";
    return this.db
      .prepare(`SELECT * FROM ${table} WHERE guild_id = ? AND ${column} = ? ORDER BY number DESC LIMIT ?`)
      .all(guildId, userId, limit)
      .map((r) => this._hydrate(kind, r));
  }

  stats(kind, guildId) {
    const table = this._table(kind);
    return this.db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS pending,
           COALESCE(SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END),0) AS rejected
         FROM ${table} WHERE guild_id = ?`
      )
      .get(guildId);
  }
}

module.exports = LifecycleRepository;
module.exports.TABLES = TABLES;
