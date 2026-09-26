class CaseworkRepository {
  constructor(db) {
    this.db = db;
  }

  addNote({ guildId, scope, ref, authorId = null, kind, content = null }) {
    const info = this.db
      .prepare("INSERT INTO casework_notes (guild_id, scope, ref, author_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(guildId, scope, ref, authorId, kind, content, Date.now());
    return info.lastInsertRowid;
  }

  notes(guildId, scope, ref, limit = 100) {
    return this.db.prepare("SELECT * FROM casework_notes WHERE guild_id = ? AND scope = ? AND ref = ? ORDER BY id ASC LIMIT ?").all(guildId, scope, ref, limit);
  }

  countNotes(guildId, scope, ref) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM casework_notes WHERE guild_id = ? AND scope = ? AND ref = ?").get(guildId, scope, ref).c;
  }

  link(guildId, x, y, userId) {
    const [a, b] = x < y ? [x, y] : [y, x];
    return this.db.prepare("INSERT OR IGNORE INTO case_links (guild_id, a, b, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(guildId, a, b, userId, Date.now()).changes === 1;
  }

  unlink(guildId, x, y) {
    const [a, b] = x < y ? [x, y] : [y, x];
    return this.db.prepare("DELETE FROM case_links WHERE guild_id = ? AND a = ? AND b = ?").run(guildId, a, b).changes === 1;
  }

  links(guildId, number) {
    return this.db
      .prepare("SELECT CASE WHEN a = ? THEN b ELSE a END AS other FROM case_links WHERE guild_id = ? AND (a = ? OR b = ?) ORDER BY other")
      .all(number, guildId, number, number)
      .map((r) => r.other);
  }

  evidenceForCase(guildId, caseNumber) {
    return this.db.prepare("SELECT number, officer_id, links, created_at FROM evidence WHERE guild_id = ? AND case_number = ? ORDER BY id").all(guildId, caseNumber);
  }

  reopen(guildId, caseNumber) {
    return this.db.prepare("UPDATE cases SET active = 1 WHERE guild_id = ? AND case_number = ? AND active = 0").run(guildId, caseNumber).changes === 1;
  }

  /** بحث القضايا بفلاتر اختيارية — مقيّد بالسيرفر ومحدود العدد. */
  searchCases(guildId, { userId = null, moderatorId = null, type = null, text = null, active = null, sinceMs = 0, limit = 15 } = {}) {
    const where = ["guild_id = ?"];
    const params = [guildId];
    if (userId) { where.push("target_id = ?"); params.push(userId); }
    if (moderatorId) { where.push("moderator_id = ?"); params.push(moderatorId); }
    if (type) { where.push("type = ?"); params.push(type); }
    if (active !== null) { where.push("active = ?"); params.push(active ? 1 : 0); }
    if (sinceMs) { where.push("created_at >= ?"); params.push(sinceMs); }
    if (text) { where.push("(reason LIKE ? ESCAPE '\\' OR target_tag LIKE ? ESCAPE '\\')"); const like = `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`; params.push(like, like); }
    params.push(Math.min(50, limit));
    return this.db.prepare(`SELECT * FROM cases WHERE ${where.join(" AND ")} ORDER BY case_number DESC LIMIT ?`).all(...params);
  }

  // ---------- البلاغات ----------

  report(guildId, number) {
    return this.db.prepare("SELECT * FROM admin_reports WHERE guild_id = ? AND number = ?").get(guildId, number) || null;
  }

  reportById(id) {
    return this.db.prepare("SELECT * FROM admin_reports WHERE id = ?").get(id) || null;
  }

  updateReport(id, fields) {
    const allowed = ["priority", "assignee_id", "escalated_at", "sla_due_at", "sla_breached"];
    const cols = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!cols.length) return;
    this.db.prepare(`UPDATE admin_reports SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id`).run({ ...fields, id });
  }

  /** يعلّم خرق SLA مرة واحدة وفقط إن كان البلاغ ما زال معلّقًا. */
  markReportBreached(id) {
    return this.db.prepare("UPDATE admin_reports SET sla_breached = 1 WHERE id = ? AND status = 'pending' AND sla_breached = 0").run(id).changes === 1;
  }

  escalateReport(id) {
    return this.db.prepare("UPDATE admin_reports SET escalated_at = ?, priority = 'urgent' WHERE id = ? AND status = 'pending' AND escalated_at IS NULL").run(Date.now(), id).changes === 1;
  }

  searchReports(guildId, { userId = null, status = null, text = null, limit = 15 } = {}) {
    const where = ["guild_id = ?"];
    const params = [guildId];
    if (userId) { where.push("(target_id = ? OR reporter_id = ? OR assignee_id = ?)"); params.push(userId, userId, userId); }
    if (status) { where.push("status = ?"); params.push(status); }
    if (text) { where.push("reason LIKE ? ESCAPE '\\'"); params.push(`%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
    params.push(Math.min(50, limit));
    return this.db.prepare(`SELECT * FROM admin_reports WHERE ${where.join(" AND ")} ORDER BY number DESC LIMIT ?`).all(...params);
  }
}

module.exports = CaseworkRepository;
