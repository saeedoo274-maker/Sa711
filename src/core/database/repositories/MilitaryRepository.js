/**
 * النظام العسكري: النقاط، نوبات الدوام، والبلاغات.
 *
 * قاعدة حاكمة: لا يمكن أن تُفتح نوبتان لنفس العسكري في نفس اللحظة —
 * الشرط `ended_at IS NULL` داخل جملة الإدراج/التحديث نفسها، لا بفحص منفصل.
 */
class MilitaryRepository {
  constructor(db) {
    this.db = db;

    /** يمنح أو يسحب نقاطًا ويسجّل العملية، داخل معاملة واحدة. */
    this._adjustPoints = db.transaction(({ guildId, userId, delta, actorId, reason }) => {
      db.prepare(
        `INSERT INTO military_points (guild_id, user_id, points, updated_at) VALUES (?, ?, 0, ?)
         ON CONFLICT(guild_id, user_id) DO NOTHING`
      ).run(guildId, userId, Date.now());

      // النقاط لا تنزل تحت الصفر مهما كان مقدار السحب
      db.prepare(
        "UPDATE military_points SET points = MAX(0, points + ?), updated_at = ? WHERE guild_id = ? AND user_id = ?"
      ).run(delta, Date.now(), guildId, userId);

      db.prepare(
        "INSERT INTO military_point_log (guild_id, user_id, actor_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(guildId, userId, actorId, delta, reason || null, Date.now());

      return db.prepare("SELECT * FROM military_points WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
    });

    this._nextReportNumber = db.transaction((guildId) => {
      db.prepare("INSERT INTO military_report_counters (guild_id, last_number) VALUES (?, 0) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
      db.prepare("UPDATE military_report_counters SET last_number = last_number + 1 WHERE guild_id = ?").run(guildId);
      return db.prepare("SELECT last_number FROM military_report_counters WHERE guild_id = ?").get(guildId).last_number;
    });
  }

  // ---------------- النقاط ----------------

  getPoints(guildId, userId) {
    const row = this.db.prepare("SELECT * FROM military_points WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
    return row || { guild_id: guildId, user_id: userId, points: 0, updated_at: null };
  }

  addPoints({ guildId, userId, amount, actorId, reason }) {
    return this._adjustPoints({ guildId, userId, delta: Math.abs(amount), actorId, reason });
  }

  removePoints({ guildId, userId, amount, actorId, reason }) {
    return this._adjustPoints({ guildId, userId, delta: -Math.abs(amount), actorId, reason });
  }

  setPoints({ guildId, userId, points, actorId }) {
    const current = this.getPoints(guildId, userId).points;
    return this._adjustPoints({ guildId, userId, delta: points - current, actorId, reason: "تحديد مباشر" });
  }

  /** تصفير نقاط كل السيرفر. يُرجع عدد السجلات المتأثرة. */
  resetAll(guildId, actorId) {
    const reset = this.db.transaction(() => {
      const rows = this.db.prepare("SELECT user_id, points FROM military_points WHERE guild_id = ? AND points > 0").all(guildId);
      for (const row of rows) {
        this.db
          .prepare("INSERT INTO military_point_log (guild_id, user_id, actor_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(guildId, row.user_id, actorId, -row.points, "تصفير شامل", Date.now());
      }
      this.db.prepare("UPDATE military_points SET points = 0, updated_at = ? WHERE guild_id = ?").run(Date.now(), guildId);
      return rows.length;
    });
    return reset();
  }

  leaderboard(guildId, limit = 15) {
    return this.db
      .prepare("SELECT * FROM military_points WHERE guild_id = ? AND points > 0 ORDER BY points DESC, user_id ASC LIMIT ?")
      .all(guildId, limit);
  }

  pointHistory(guildId, userId, limit = 10) {
    return this.db
      .prepare("SELECT * FROM military_point_log WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?")
      .all(guildId, userId, limit);
  }

  // ---------------- الدوام ----------------

  openShift(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM military_shifts WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL")
      .get(guildId, userId) || null;
  }

  /**
   * يبدأ نوبة. يُرجع null إن كانت هناك نوبة مفتوحة أصلًا —
   * الفحص والإدراج داخل معاملة واحدة فلا تُفتح نوبتان بضغطتين متزامنتين.
   */
  startShift(guildId, userId) {
    const start = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT 1 FROM military_shifts WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL")
        .get(guildId, userId);
      if (existing) return null;

      const info = this.db
        .prepare("INSERT INTO military_shifts (guild_id, user_id, started_at) VALUES (?, ?, ?)")
        .run(guildId, userId, Date.now());
      return this.db.prepare("SELECT * FROM military_shifts WHERE id = ?").get(info.lastInsertRowid);
    });
    return start();
  }

  /** ينهي النوبة المفتوحة ذرّيًا. يُرجع النوبة المنتهية أو null إن لم تكن مفتوحة. */
  endShift(guildId, userId) {
    const end = this.db.transaction(() => {
      const shift = this.db
        .prepare("SELECT * FROM military_shifts WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL")
        .get(guildId, userId);
      if (!shift) return null;

      const now = Date.now();
      const changed = this.db
        .prepare("UPDATE military_shifts SET ended_at = ?, duration_ms = ? WHERE id = ? AND ended_at IS NULL")
        .run(now, now - shift.started_at, shift.id).changes;
      if (changed !== 1) return null;

      return this.db.prepare("SELECT * FROM military_shifts WHERE id = ?").get(shift.id);
    });
    return end();
  }

  activeShifts(guildId) {
    // ترتيب ثانوي بـ id: عسكريان قد يسجّلان دخولًا في نفس المللي ثانية
    return this.db
      .prepare("SELECT * FROM military_shifts WHERE guild_id = ? AND ended_at IS NULL ORDER BY started_at ASC, id ASC")
      .all(guildId);
  }

  /** إجمالي وقت الدوام لعسكري خلال فترة (أو كامل السجل إن لم تُحدَّد). */
  totalDuty(guildId, userId, sinceMs = null) {
    const sql = sinceMs
      ? "SELECT COALESCE(SUM(duration_ms), 0) AS total, COUNT(*) AS shifts FROM military_shifts WHERE guild_id = ? AND user_id = ? AND ended_at IS NOT NULL AND started_at >= ?"
      : "SELECT COALESCE(SUM(duration_ms), 0) AS total, COUNT(*) AS shifts FROM military_shifts WHERE guild_id = ? AND user_id = ? AND ended_at IS NOT NULL";
    return sinceMs
      ? this.db.prepare(sql).get(guildId, userId, Date.now() - sinceMs)
      : this.db.prepare(sql).get(guildId, userId);
  }

  recentShifts(guildId, userId, limit = 10) {
    return this.db
      .prepare("SELECT * FROM military_shifts WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?")
      .all(guildId, userId, limit);
  }

  // ---------------- البلاغات ----------------

  createReport(data) {
    const create = this.db.transaction(() => {
      const number = this._nextReportNumber(data.guildId);
      this.db
        .prepare(
          `INSERT INTO military_reports (guild_id, number, reporter_id, kind, details, location, suspect, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(data.guildId, number, data.reporterId, data.kind, data.details, data.location || null, data.suspect || null, Date.now());
      return number;
    });
    return this.getReport(data.guildId, create());
  }

  getReport(guildId, number) {
    return this.db.prepare("SELECT * FROM military_reports WHERE guild_id = ? AND number = ?").get(guildId, number) || null;
  }

  getReportById(id) {
    return this.db.prepare("SELECT * FROM military_reports WHERE id = ?").get(id) || null;
  }

  setReportMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE military_reports SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  /** استلام البلاغ ذرّيًا: أول عسكري يضغط هو من يستلمه، ولا يُستلم مرتين. */
  claimReport(id, handlerId) {
    return this.db
      .prepare("UPDATE military_reports SET status = 'claimed', handler_id = ?, handled_at = ? WHERE id = ? AND status = 'open'")
      .run(handlerId, Date.now(), id).changes === 1;
  }

  closeReport(id, handlerId) {
    return this.db
      .prepare("UPDATE military_reports SET status = 'closed', handler_id = COALESCE(handler_id, ?), handled_at = ? WHERE id = ? AND status != 'closed'")
      .run(handlerId, Date.now(), id).changes === 1;
  }

  listReports(guildId, { status = null, limit = 15 } = {}) {
    const sql = status
      ? "SELECT * FROM military_reports WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT ?"
      : "SELECT * FROM military_reports WHERE guild_id = ? ORDER BY id DESC LIMIT ?";
    return status
      ? this.db.prepare(sql).all(guildId, status, limit)
      : this.db.prepare(sql).all(guildId, limit);
  }

  reportStats(guildId) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status='open' THEN 1 ELSE 0 END),0) AS open,
           COALESCE(SUM(CASE WHEN status='claimed' THEN 1 ELSE 0 END),0) AS claimed,
           COALESCE(SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END),0) AS closed
         FROM military_reports WHERE guild_id = ?`
      )
      .get(guildId);
  }

  // ---------------- سلّم الرتب بالنقاط ----------------

  addRank({ guildId, roleId, label, points }) {
    this.db
      .prepare("INSERT INTO military_ranks (guild_id, role_id, label, points, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, roleId, label, points, Date.now());
    return this.getRank(guildId, roleId);
  }

  getRank(guildId, roleId) {
    return this.db.prepare("SELECT * FROM military_ranks WHERE guild_id = ? AND role_id = ?").get(guildId, roleId) || null;
  }

  /** السلّم مرتّبًا تصاعديًا بالنقاط — الترتيب يحدد أي رتبة يستحقها العضو. */
  listRanks(guildId) {
    return this.db
      .prepare("SELECT * FROM military_ranks WHERE guild_id = ? ORDER BY points ASC, id ASC")
      .all(guildId);
  }

  removeRank(guildId, roleId) {
    return this.db.prepare("DELETE FROM military_ranks WHERE guild_id = ? AND role_id = ?").run(guildId, roleId).changes === 1;
  }

  /** أعلى رتبة تستحقها نقاط معيّنة، أو null إن لم تبلغ أدنى رتبة. */
  rankFor(guildId, points) {
    return this.db
      .prepare("SELECT * FROM military_ranks WHERE guild_id = ? AND points <= ? ORDER BY points DESC, id DESC LIMIT 1")
      .get(guildId, points) || null;
  }
}

module.exports = MilitaryRepository;
