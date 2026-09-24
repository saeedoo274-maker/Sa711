class VerificationRepository {
  constructor(db) {
    this.db = db;
  }

  record(guildId, userId) {
    this.db
      .prepare("INSERT INTO verification_log (guild_id, user_id, verified_at) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET verified_at = excluded.verified_at")
      .run(guildId, userId, Date.now());
  }

  count(guildId, sinceMs = 0) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM verification_log WHERE guild_id = ? AND verified_at >= ?").get(guildId, sinceMs).c;
  }

  total() {
    return this.db.prepare("SELECT COUNT(*) AS c FROM verification_log").get().c;
  }
}

module.exports = VerificationRepository;
