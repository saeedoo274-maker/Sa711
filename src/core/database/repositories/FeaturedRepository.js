class FeaturedRepository {
  constructor(db) {
    this.db = db;
  }

  /** ذرّي: نفس الرسالة لا تُميَّز مرتين، بحكم المفتاح الفريد. */
  create(d) {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO featured_posts
           (guild_id, source_channel, source_message, featured_channel, featured_message, author_id, reason, featured_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        d.guildId, d.sourceChannel, d.sourceMessage, d.featuredChannel || null,
        d.featuredMessage || null, d.authorId || null, d.reason || null, d.featuredBy, Date.now()
      );
    if (res.changes !== 1) return null;
    return this.getBySource(d.guildId, d.sourceMessage);
  }

  getBySource(guildId, sourceMessageId) {
    return this.db.prepare("SELECT * FROM featured_posts WHERE guild_id = ? AND source_message = ?").get(guildId, sourceMessageId) || null;
  }

  list(guildId, limit = 15) {
    return this.db.prepare("SELECT * FROM featured_posts WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?").all(guildId, limit);
  }

  count(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM featured_posts WHERE guild_id = ?").get(guildId).c;
  }

  remove(guildId, sourceMessageId) {
    return this.db.prepare("DELETE FROM featured_posts WHERE guild_id = ? AND source_message = ?").run(guildId, sourceMessageId).changes === 1;
  }
}

module.exports = FeaturedRepository;
