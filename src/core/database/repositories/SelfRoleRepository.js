class SelfRoleRepository {
  constructor(db) {
    this.db = db;
  }

  save({ id, guildId, channelId, messageId, config }) {
    this.db
      .prepare(
        `INSERT INTO self_role_panels (id, guild_id, channel_id, message_id, config, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id,
           message_id = excluded.message_id, config = excluded.config`
      )
      .run(id, guildId, channelId || null, messageId || null, JSON.stringify(config || {}), Date.now());
  }

  get(id) {
    const row = this.db.prepare("SELECT * FROM self_role_panels WHERE id = ?").get(id);
    return row ? { ...row, config: JSON.parse(row.config || "{}") } : null;
  }

  list(guildId) {
    return this.db
      .prepare("SELECT * FROM self_role_panels WHERE guild_id = ?")
      .all(guildId)
      .map((r) => ({ ...r, config: JSON.parse(r.config || "{}") }));
  }

  delete(id) {
    return this.db.prepare("DELETE FROM self_role_panels WHERE id = ?").run(id).changes === 1;
  }
}

module.exports = SelfRoleRepository;
