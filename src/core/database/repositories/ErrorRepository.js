class ErrorRepository {
  constructor(db) {
    this.db = db;
  }

  create({ errorId, guildId, userId, system, command, message, stack }) {
    this.db
      .prepare(
        `INSERT INTO error_logs (error_id, guild_id, user_id, system, command, message, stack, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(errorId, guildId || null, userId || null, system || null, command || null, message, stack || null, Date.now());
  }

  getById(errorId) {
    return this.db.prepare("SELECT * FROM error_logs WHERE error_id = ?").get(errorId) || null;
  }

  recent(limit = 10) {
    return this.db.prepare("SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?").all(limit);
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS c FROM error_logs").get().c;
  }

  countSince(timestamp) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM error_logs WHERE created_at >= ?").get(timestamp).c;
  }
}

module.exports = ErrorRepository;
