class StarboardRepository {
  constructor(db) {
    this.db = db;
  }

  get(guildId, messageId) {
    return this.db
      .prepare("SELECT * FROM starboard_entries WHERE guild_id = ? AND source_message_id = ?")
      .get(guildId, messageId) || null;
  }

  /** يسجّل أو يحدّث عدد النجوم. */
  upsert({ guildId, messageId, channelId, authorId, stars, boardMessageId }) {
    this.db
      .prepare(
        `INSERT INTO starboard_entries
           (guild_id, source_message_id, source_channel_id, board_message_id, author_id, stars, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, source_message_id) DO UPDATE SET
           stars = excluded.stars,
           board_message_id = COALESCE(excluded.board_message_id, starboard_entries.board_message_id)`
      )
      .run(guildId, messageId, channelId, boardMessageId || null, authorId || null, stars, Date.now());
    return this.get(guildId, messageId);
  }

  setBoardMessage(guildId, messageId, boardMessageId) {
    this.db
      .prepare("UPDATE starboard_entries SET board_message_id = ? WHERE guild_id = ? AND source_message_id = ?")
      .run(boardMessageId, guildId, messageId);
  }

  remove(guildId, messageId) {
    return this.db
      .prepare("DELETE FROM starboard_entries WHERE guild_id = ? AND source_message_id = ?")
      .run(guildId, messageId).changes === 1;
  }

  top(guildId, limit = 10) {
    return this.db
      .prepare("SELECT * FROM starboard_entries WHERE guild_id = ? AND board_message_id IS NOT NULL ORDER BY stars DESC LIMIT ?")
      .all(guildId, limit);
  }

  count(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM starboard_entries WHERE guild_id = ?").get(guildId).c;
  }
}

module.exports = StarboardRepository;
