class AchievementRepository {
  constructor(db) {
    this.db = db;
    this._sum = db.prepare(
      `INSERT INTO member_metrics (guild_id, user_id, metric, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id, metric) DO UPDATE SET value = value + excluded.value`
    );
    this._max = db.prepare(
      `INSERT INTO member_metrics (guild_id, user_id, metric, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id, metric) DO UPDATE SET value = MAX(value, excluded.value)`
    );
    this._flush = db.transaction((rows) => {
      for (const r of rows) (r.mode === "max" ? this._max : this._sum).run(r.guildId, r.userId, r.metric, r.value);
    });
  }

  flush(rows) {
    this._flush(rows);
  }

  metrics(guildId, userId) {
    const out = {};
    for (const r of this.db.prepare("SELECT metric, value FROM member_metrics WHERE guild_id = ? AND user_id = ?").all(guildId, userId)) out[r.metric] = r.value;
    return out;
  }

  custom(guildId) {
    return this.db.prepare("SELECT * FROM achievements WHERE guild_id = ?").all(guildId).map((r) => ({
      ...r,
      hidden: !!r.hidden,
      enabled: !!r.enabled,
      reward: r.reward ? JSON.parse(r.reward) : null
    }));
  }

  upsert(guildId, a) {
    this.db
      .prepare(
        `INSERT INTO achievements (guild_id, key, name, description, emoji, category, metric, target, hidden, reward, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, key) DO UPDATE SET name = excluded.name, description = excluded.description, emoji = excluded.emoji,
           category = excluded.category, metric = excluded.metric, target = excluded.target, hidden = excluded.hidden,
           reward = excluded.reward, enabled = excluded.enabled`
      )
      .run(guildId, a.key, a.name, a.description || null, a.emoji || null, a.category, a.metric, a.target, a.hidden ? 1 : 0,
        a.reward ? JSON.stringify(a.reward) : null, a.enabled === false ? 0 : 1, Date.now());
  }

  remove(guildId, key) {
    return this.db.prepare("DELETE FROM achievements WHERE guild_id = ? AND key = ?").run(guildId, key).changes > 0;
  }

  /** فتح الإنجاز — true للمرة الأولى فقط. */
  unlock(guildId, userId, key) {
    return this.db.prepare("INSERT OR IGNORE INTO achievement_unlocks (guild_id, user_id, key, unlocked_at) VALUES (?, ?, ?, ?)").run(guildId, userId, key, Date.now()).changes === 1;
  }

  unlocks(guildId, userId) {
    const out = new Map();
    for (const r of this.db.prepare("SELECT key, unlocked_at FROM achievement_unlocks WHERE guild_id = ? AND user_id = ?").all(guildId, userId)) out.set(r.key, r.unlocked_at);
    return out;
  }

  leaderboard(guildId, limit = 10, offset = 0) {
    return this.db
      .prepare("SELECT user_id, COUNT(*) AS score, MAX(unlocked_at) AS last FROM achievement_unlocks WHERE guild_id = ? GROUP BY user_id ORDER BY score DESC, last ASC LIMIT ? OFFSET ?")
      .all(guildId, limit, offset);
  }

  holders(guildId, key) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM achievement_unlocks WHERE guild_id = ? AND key = ?").get(guildId, key).c;
  }
}

module.exports = AchievementRepository;
