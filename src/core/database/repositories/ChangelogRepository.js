class ChangelogRepository {
  constructor(db) {
    this.db = db;
  }

  publish({ version, title, body, publishedBy }) {
    const info = this.db
      .prepare("INSERT INTO changelogs (version, title, body, published_by, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(version, title, body, publishedBy, Date.now());
    return this.getById(info.lastInsertRowid);
  }

  getById(id) {
    return this.db.prepare("SELECT * FROM changelogs WHERE id = ?").get(id) || null;
  }

  latest() {
    return this.db.prepare("SELECT * FROM changelogs ORDER BY id DESC LIMIT 1").get() || null;
  }

  list(limit = 10) {
    return this.db.prepare("SELECT * FROM changelogs ORDER BY id DESC LIMIT ?").all(limit);
  }

  // ---------------- اشتراك السيرفرات ----------------

  setBroadcast(guildId, { channelId, enabled }) {
    this.db
      .prepare(
        `INSERT INTO changelog_broadcasts (guild_id, channel_id, enabled) VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           channel_id = COALESCE(excluded.channel_id, changelog_broadcasts.channel_id),
           enabled = excluded.enabled`
      )
      .run(guildId, channelId || null, enabled ? 1 : 0);
    return this.getBroadcast(guildId);
  }

  getBroadcast(guildId) {
    return this.db.prepare("SELECT * FROM changelog_broadcasts WHERE guild_id = ?").get(guildId) || null;
  }

  /** السيرفرات المشتركة التي لم تستلم آخر إصدار بعد. */
  pendingBroadcasts(latestId) {
    return this.db
      .prepare(
        `SELECT * FROM changelog_broadcasts
         WHERE enabled = 1 AND channel_id IS NOT NULL
           AND (last_sent_id IS NULL OR last_sent_id < ?)`
      )
      .all(latestId);
  }

  markSent(guildId, changelogId) {
    this.db.prepare("UPDATE changelog_broadcasts SET last_sent_id = ? WHERE guild_id = ?").run(changelogId, guildId);
  }
}

module.exports = ChangelogRepository;
