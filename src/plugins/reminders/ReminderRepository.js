class ReminderRepository {
  constructor(db) {
    this.db = db;
  }

  _row(r) {
    if (!r) return null;
    let repeat;
    try {
      repeat = r.repeat ? JSON.parse(r.repeat) : null;
    } catch {
      repeat = null;
    }
    return { ...r, repeat };
  }

  create(data) {
    const now = Date.now();
    const info = this.db
      .prepare(
        `INSERT INTO reminders (guild_id, user_id, target, channel_id, mention_role_id, staff, content, run_at, repeat, timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.guildId, data.userId, data.target, data.channelId || null, data.mentionRoleId || null, data.staff ? 1 : 0,
        data.content, data.runAt, data.repeat ? JSON.stringify(data.repeat) : null, data.timezone || "UTC", now, now
      );
    return this.get(info.lastInsertRowid);
  }

  get(id) {
    return this._row(this.db.prepare("SELECT * FROM reminders WHERE id = ?").get(id));
  }

  update(id, fields) {
    const allowed = { content: "content", runAt: "run_at", repeat: "repeat", target: "target", channelId: "channel_id", timezone: "timezone" };
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(fields)) {
      const col = allowed[k];
      if (!col) continue;
      sets.push(`${col} = ?`);
      params.push(k === "repeat" ? (v ? JSON.stringify(v) : null) : v);
    }
    if (!sets.length) return this.get(id);
    this.db.prepare(`UPDATE reminders SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...params, Date.now(), id);
    return this.get(id);
  }

  markSent(id, { nextRunAt = null } = {}) {
    this.db
      .prepare("UPDATE reminders SET sent_count = sent_count + 1, last_sent_at = ?, run_at = COALESCE(?, run_at), active = CASE WHEN ? IS NULL THEN 0 ELSE active END, updated_at = ? WHERE id = ?")
      .run(Date.now(), nextRunAt, nextRunAt, Date.now(), id);
  }

  deactivate(id) {
    return this.db.prepare("UPDATE reminders SET active = 0, updated_at = ? WHERE id = ? AND active = 1").run(Date.now(), id).changes > 0;
  }

  listForUser(guildId, userId, { includeStaff = false } = {}) {
    return this.db
      .prepare(`SELECT * FROM reminders WHERE guild_id = ? AND active = 1 AND (user_id = ? ${includeStaff ? "OR staff = 1" : ""}) ORDER BY run_at ASC LIMIT 50`)
      .all(guildId, userId)
      .map((r) => this._row(r));
  }

  countActive(guildId, userId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM reminders WHERE guild_id = ? AND user_id = ? AND active = 1").get(guildId, userId).c;
  }

  purgeInactive(olderThanMs) {
    return this.db.prepare("DELETE FROM reminders WHERE active = 0 AND updated_at < ?").run(Date.now() - olderThanMs).changes;
  }
}

module.exports = ReminderRepository;
