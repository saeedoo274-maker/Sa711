class GuildRepository {
  constructor(db) {
    this.db = db;
  }

  /** يُرجع JSON الإعدادات الخام للسيرفر، أو null إن لم يكن مسجّلًا. */
  getRawConfig(guildId) {
    const row = this.db.prepare("SELECT config FROM guilds WHERE id = ?").get(guildId);
    if (!row) return null;
    try {
      return JSON.parse(row.config);
    } catch {
      return {};
    }
  }

  ensure(guildId) {
    const now = Date.now();
    this.db
      .prepare("INSERT OR IGNORE INTO guilds (id, config, created_at, updated_at) VALUES (?, '{}', ?, ?)")
      .run(guildId, now, now);
  }

  saveConfig(guildId, configObject) {
    const now = Date.now();
    const json = JSON.stringify(configObject);
    this.db
      .prepare(
        `INSERT INTO guilds (id, config, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`
      )
      .run(guildId, json, now, now);
  }

  delete(guildId) {
    const wipe = this.db.transaction(() => {
      this.db.prepare("DELETE FROM guilds WHERE id = ?").run(guildId);
      this.db.prepare("DELETE FROM staff_ranks WHERE guild_id = ?").run(guildId);
      this.db.prepare("DELETE FROM cases WHERE guild_id = ?").run(guildId);
      this.db.prepare("DELETE FROM case_counters WHERE guild_id = ?").run(guildId);
      this.db.prepare("DELETE FROM staff_activity WHERE guild_id = ?").run(guildId);
    });
    wipe();
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS c FROM guilds").get().c;
  }
}

module.exports = GuildRepository;
