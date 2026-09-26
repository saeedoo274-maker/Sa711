class AppealRepository {
  constructor(db) {
    this.db = db;
  }

  /** يُرجع null إن كان هناك استئناف معلّق لنفس القضية (الفهرس الفريد يمنعه). */
  create({ guildId, caseNumber, userId, type, reason }) {
    const info = this.db
      .prepare("INSERT OR IGNORE INTO appeals (guild_id, case_number, user_id, type, reason, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
      .run(guildId, caseNumber, userId, type, reason, Date.now());
    return info.changes === 1 ? this.get(info.lastInsertRowid) : null;
  }

  get(id) {
    return this.db.prepare("SELECT * FROM appeals WHERE id = ?").get(id) || null;
  }

  forCase(guildId, caseNumber) {
    return this.db.prepare("SELECT * FROM appeals WHERE guild_id = ? AND case_number = ? ORDER BY id").all(guildId, caseNumber);
  }

  lastRejected(guildId, caseNumber) {
    return this.db.prepare("SELECT * FROM appeals WHERE guild_id = ? AND case_number = ? AND status = 'rejected' ORDER BY reviewed_at DESC LIMIT 1").get(guildId, caseNumber) || null;
  }

  /** قرار ذرّي: ينجح مرة واحدة فقط لو ضغط مراجعان في نفس اللحظة. */
  decide(id, status, reviewerId, note = null) {
    return this.db
      .prepare("UPDATE appeals SET status = ?, reviewer_id = ?, reviewed_at = ?, note = ? WHERE id = ? AND status = 'pending'")
      .run(status, reviewerId, Date.now(), note, id).changes === 1;
  }

  setMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE appeals SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  pending(guildId, limit = 15) {
    return this.db.prepare("SELECT * FROM appeals WHERE guild_id = ? AND status = 'pending' ORDER BY id LIMIT ?").all(guildId, limit);
  }

  search(guildId, { userId = null, status = null, limit = 15 } = {}) {
    const where = ["guild_id = ?"];
    const params = [guildId];
    if (userId) { where.push("user_id = ?"); params.push(userId); }
    if (status) { where.push("status = ?"); params.push(status); }
    params.push(Math.min(50, limit));
    return this.db.prepare(`SELECT * FROM appeals WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...params);
  }
}

module.exports = AppealRepository;
