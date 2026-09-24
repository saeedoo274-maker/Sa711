class AfkRepository {
  constructor(db) {
    this.db = db;
  }

  set(guildId, userId, { reason, since, expiresAt, originalNick, nickChanged, lastActiveAt }) {
    this.db
      .prepare(
        `INSERT INTO afk_status (guild_id, user_id, reason, since, expires_at, mentions, original_nick, nick_changed, last_active_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason, since = excluded.since,
           expires_at = excluded.expires_at, last_active_at = excluded.last_active_at`
      )
      .run(guildId, userId, reason, since, expiresAt, originalNick, nickChanged ? 1 : 0, lastActiveAt);
    return this.get(guildId, userId);
  }

  get(guildId, userId) {
    return this.db.prepare("SELECT * FROM afk_status WHERE guild_id = ? AND user_id = ?").get(guildId, userId) || null;
  }

  /** يزيل الحالة ذرّيًا ويُرجعها مع المنشنات — مرة واحدة فقط حتى لو تزامنت رسالتان. */
  remove(guildId, userId) {
    const tx = this.db.transaction(() => {
      const row = this.get(guildId, userId);
      if (!row) return null;
      this.db.prepare("DELETE FROM afk_status WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
      const mentions = this.db
        .prepare("SELECT * FROM afk_mentions WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 25")
        .all(guildId, userId);
      this.db.prepare("DELETE FROM afk_mentions WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
      return { ...row, mentionList: mentions };
    });
    return tx();
  }

  recordMention(guildId, userId, { authorId, channelId, messageId, excerpt }) {
    const tx = this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE afk_status SET mentions = mentions + 1 WHERE guild_id = ? AND user_id = ?").run(guildId, userId).changes;
      if (!changed) return false;
      this.db
        .prepare("INSERT INTO afk_mentions (guild_id, user_id, author_id, channel_id, message_id, excerpt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(guildId, userId, authorId, channelId, messageId, excerpt, Date.now());
      // الاحتفاظ بآخر 25 فقط
      this.db
        .prepare(
          `DELETE FROM afk_mentions WHERE guild_id = ? AND user_id = ? AND id NOT IN
             (SELECT id FROM afk_mentions WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 25)`
        )
        .run(guildId, userId, guildId, userId);
      return true;
    });
    return tx();
  }

  list(guildId, limit = 50) {
    return this.db.prepare("SELECT * FROM afk_status WHERE guild_id = ? ORDER BY since DESC LIMIT ?").all(guildId, limit);
  }

  all() {
    return this.db.prepare("SELECT guild_id, user_id FROM afk_status").all();
  }
}

module.exports = AfkRepository;
