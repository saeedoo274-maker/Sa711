class GithubWebhookRepository {
  constructor(db) {
    this.db = db;
  }

  save({ guildId, channelId, secret, repoFilter, events }) {
    this.db
      .prepare(
        `INSERT INTO github_webhooks (guild_id, channel_id, secret, repo_filter, events, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           channel_id = excluded.channel_id, secret = excluded.secret,
           repo_filter = excluded.repo_filter, events = excluded.events`
      )
      .run(guildId, channelId, secret, repoFilter || null, JSON.stringify(events || []), Date.now());
    return this.get(guildId);
  }

  get(guildId) {
    const row = this.db.prepare("SELECT * FROM github_webhooks WHERE guild_id = ?").get(guildId);
    return row ? { ...row, events: JSON.parse(row.events || "[]") } : null;
  }

  /** يبحث عن كل الاشتراكات المطابقة لمستودع معيّن (أو بلا فلتر مستودع). */
  findByRepo(repoFullName) {
    return this.db
      .prepare("SELECT * FROM github_webhooks WHERE repo_filter IS NULL OR repo_filter = ?")
      .all(repoFullName)
      .map((r) => ({ ...r, events: JSON.parse(r.events || "[]") }));
  }

  delete(guildId) {
    return this.db.prepare("DELETE FROM github_webhooks WHERE guild_id = ?").run(guildId).changes === 1;
  }
}

module.exports = GithubWebhookRepository;
