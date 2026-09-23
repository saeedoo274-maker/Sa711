class QuizRepository {
  constructor(db) {
    this.db = db;
  }

  addQuestion(guildId, text, correct) {
    const insert = this.db.transaction(() => {
      const row = this.db.prepare("SELECT COALESCE(MAX(position),0) AS p FROM quiz_questions WHERE guild_id = ?").get(guildId);
      this.db
        .prepare("INSERT INTO quiz_questions (guild_id, position, text, correct, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(guildId, row.p + 1, text, correct, Date.now());
      return row.p + 1;
    });
    return insert();
  }

  list(guildId) {
    return this.db.prepare("SELECT * FROM quiz_questions WHERE guild_id = ? ORDER BY position ASC").all(guildId);
  }

  count(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM quiz_questions WHERE guild_id = ?").get(guildId).c;
  }

  removeByPosition(guildId, position) {
    return this.db.prepare("DELETE FROM quiz_questions WHERE guild_id = ? AND position = ?").run(guildId, position).changes === 1;
  }

  clear(guildId) {
    return this.db.prepare("DELETE FROM quiz_questions WHERE guild_id = ?").run(guildId).changes;
  }

  recordAttempt({ guildId, userId, score, total, passed }) {
    this.db
      .prepare("INSERT INTO quiz_attempts (guild_id, user_id, score, total, passed, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(guildId, userId, score, total, passed ? 1 : 0, Date.now());
  }

  lastAttempt(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM quiz_attempts WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(guildId, userId) || null;
  }

  hasPassed(guildId, userId) {
    return !!this.db
      .prepare("SELECT 1 FROM quiz_attempts WHERE guild_id = ? AND user_id = ? AND passed = 1")
      .get(guildId, userId);
  }
}

module.exports = QuizRepository;
