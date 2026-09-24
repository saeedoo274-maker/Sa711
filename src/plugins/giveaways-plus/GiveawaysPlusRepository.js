const EXTRA_COLUMNS = ["min_level", "min_messages", "activity_days", "min_invites", "bonus_roles", "starts_at", "duration_ms", "description", "dm_winners"];

class GiveawaysPlusRepository {
  constructor(db) {
    this.db = db;
  }

  static parseBonus(giveaway) {
    try {
      const list = JSON.parse(giveaway?.bonus_roles || "[]");
      return Array.isArray(list) ? list.filter((b) => b && b.roleId && Number.isInteger(b.entries)) : [];
    } catch {
      return [];
    }
  }

  setExtras(id, extras) {
    const cols = Object.keys(extras).filter((k) => EXTRA_COLUMNS.includes(k));
    if (!cols.length) return;
    this.db.prepare(`UPDATE giveaways SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id`).run({ ...Object.fromEntries(cols.map((c) => [c, extras[c]])), id });
  }

  markScheduled(id, startsAt, durationMs) {
    this.db.prepare("UPDATE giveaways SET status = 'scheduled', starts_at = ?, duration_ms = ?, ends_at = ? WHERE id = ? AND status = 'active'").run(startsAt, durationMs, startsAt + durationMs, id);
  }

  /** تفعيل سحب مجدول — ذرّي: ينجح مرة واحدة فقط. */
  activate(id, endsAt) {
    return this.db.prepare("UPDATE giveaways SET status = 'active', ends_at = ? WHERE id = ? AND status = 'scheduled'").run(endsAt, id).changes === 1;
  }

  cancelScheduled(id) {
    return this.db.prepare("UPDATE giveaways SET status = 'cancelled' WHERE id = ? AND status = 'scheduled'").run(id).changes === 1;
  }

  markEndedAt(id) {
    this.db.prepare("UPDATE giveaways SET ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(Date.now(), id);
  }

  listScheduled(guildId) {
    return this.db.prepare("SELECT * FROM giveaways WHERE guild_id = ? AND status = 'scheduled' ORDER BY starts_at ASC LIMIT 25").all(guildId);
  }

  history(guildId, limit = 10, offset = 0) {
    return this.db
      .prepare(
        `SELECT g.*, (SELECT COUNT(*) FROM giveaway_entries e WHERE e.giveaway_id = g.id) AS entries,
                (SELECT GROUP_CONCAT(user_id) FROM (SELECT DISTINCT user_id FROM giveaway_winners w WHERE w.giveaway_id = g.id)) AS winner_ids
         FROM giveaways g WHERE g.guild_id = ? AND g.status IN ('ended', 'cancelled') ORDER BY g.id DESC LIMIT ? OFFSET ?`
      )
      .all(guildId, limit, offset);
  }

  winsOf(guildId, userId, limit = 15) {
    return this.db
      .prepare(
        `SELECT g.id, g.prize, MAX(w.drawn_at) AS drawn_at FROM giveaway_winners w JOIN giveaways g ON g.id = w.giveaway_id
         WHERE g.guild_id = ? AND w.user_id = ? GROUP BY g.id ORDER BY drawn_at DESC LIMIT ?`
      )
      .all(guildId, userId, limit);
  }

  winCount(guildId, userId) {
    return this.db
      .prepare("SELECT COUNT(DISTINCT w.giveaway_id) AS c FROM giveaway_winners w JOIN giveaways g ON g.id = w.giveaway_id WHERE g.guild_id = ? AND w.user_id = ?")
      .get(guildId, userId).c;
  }

  // ---------- القوالب ----------

  saveTemplate(guildId, name, data, userId) {
    this.db
      .prepare(
        `INSERT INTO giveaway_templates (guild_id, name, data, created_by, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, name) DO UPDATE SET data = excluded.data, created_by = excluded.created_by, created_at = excluded.created_at`
      )
      .run(guildId, name, JSON.stringify(data), userId, Date.now());
  }

  template(guildId, name) {
    const row = this.db.prepare("SELECT * FROM giveaway_templates WHERE guild_id = ? AND name = ?").get(guildId, name);
    if (!row) return null;
    try {
      return { ...row, data: JSON.parse(row.data) };
    } catch {
      return null;
    }
  }

  templates(guildId) {
    return this.db.prepare("SELECT name, data, created_by, created_at FROM giveaway_templates WHERE guild_id = ? ORDER BY name LIMIT 25").all(guildId);
  }

  templateCount(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM giveaway_templates WHERE guild_id = ?").get(guildId).c;
  }

  deleteTemplate(guildId, name) {
    return this.db.prepare("DELETE FROM giveaway_templates WHERE guild_id = ? AND name = ?").run(guildId, name).changes === 1;
  }
}

module.exports = GiveawaysPlusRepository;
