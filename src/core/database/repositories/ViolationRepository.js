class ViolationRepository {
  constructor(db) {
    this.db = db;

    /** ترقيم متسلسل مستقل لكل سيرفر داخل معاملة واحدة، فلا يتكرر رقم مخالفة أبدًا. */
    this._issue = db.transaction((data) => {
      db.prepare("INSERT INTO violation_counters (guild_id, last_number) VALUES (?, 0) ON CONFLICT(guild_id) DO NOTHING")
        .run(data.guildId);
      db.prepare("UPDATE violation_counters SET last_number = last_number + 1 WHERE guild_id = ?").run(data.guildId);
      const { last_number: number } = db
        .prepare("SELECT last_number FROM violation_counters WHERE guild_id = ?")
        .get(data.guildId);

      db.prepare(
        `INSERT INTO violations (guild_id, number, target_id, officer_id, kind, amount, status, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`
      ).run(data.guildId, number, data.targetId, data.officerId, data.kind, data.amount, data.notes || null, Date.now());

      return number;
    });
  }

  issue(data) {
    const number = this._issue(data);
    return this.getByNumber(data.guildId, number);
  }

  getByNumber(guildId, number) {
    return this.db.prepare("SELECT * FROM violations WHERE guild_id = ? AND number = ?").get(guildId, number) || null;
  }

  /** التعليم كمدفوعة ذرّي: يمنع السداد المزدوج لنفس المخالفة. */
  markPaid(guildId, number) {
    return this.db
      .prepare("UPDATE violations SET status = 'paid', paid_at = ? WHERE guild_id = ? AND number = ? AND status = 'unpaid'")
      .run(Date.now(), guildId, number).changes === 1;
  }

  cancel(guildId, number) {
    return this.db
      .prepare("UPDATE violations SET status = 'cancelled' WHERE guild_id = ? AND number = ? AND status = 'unpaid'")
      .run(guildId, number).changes === 1;
  }

  listByTarget(guildId, targetId, { unpaidOnly = false, limit = 25 } = {}) {
    const sql = unpaidOnly
      ? "SELECT * FROM violations WHERE guild_id = ? AND target_id = ? AND status = 'unpaid' ORDER BY number DESC LIMIT ?"
      : "SELECT * FROM violations WHERE guild_id = ? AND target_id = ? ORDER BY number DESC LIMIT ?";
    return this.db.prepare(sql).all(guildId, targetId, limit);
  }

  unpaidCount(guildId, targetId) {
    return this.db
      .prepare("SELECT COUNT(*) AS c FROM violations WHERE guild_id = ? AND target_id = ? AND status = 'unpaid'")
      .get(guildId, targetId).c;
  }

  unpaidTotal(guildId, targetId) {
    return this.db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM violations WHERE guild_id = ? AND target_id = ? AND status = 'unpaid'")
      .get(guildId, targetId).total;
  }

  recent(guildId, limit = 15) {
    return this.db.prepare("SELECT * FROM violations WHERE guild_id = ? ORDER BY number DESC LIMIT ?").all(guildId, limit);
  }

  stats(guildId) {
    return this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END), 0) AS unpaid,
           COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid,
           COALESCE(SUM(CASE WHEN status = 'unpaid' THEN amount ELSE 0 END), 0) AS outstanding
         FROM violations WHERE guild_id = ?`
      )
      .get(guildId);
  }
}

module.exports = ViolationRepository;
