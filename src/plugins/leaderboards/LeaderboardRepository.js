/**
 * استعلامات الترتيب للقراءة فقط من جداول الأنظمة. كل استعلام مقيّد بالسيرفر
 * ومحدود بالصفحة، ومعظمها يستفيد من فهارس موجودة.
 */
class LeaderboardRepository {
  constructor(db) {
    this.db = db;
  }

  _has(table) {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  }

  query(type, guildId, { sinceDay = null, sinceMs = 0, limit = 10, offset = 0 } = {}) {
    const q = {
      xp: ["level_members", "SELECT user_id, xp AS score FROM level_members WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC LIMIT ? OFFSET ?", [guildId]],
      level: ["level_members", "SELECT user_id, level AS score, xp FROM level_members WHERE guild_id = ? AND level > 0 ORDER BY level DESC, xp DESC LIMIT ? OFFSET ?", [guildId]],
      messages: ["member_activity_daily", "SELECT user_id, SUM(messages) AS score FROM member_activity_daily WHERE guild_id = ? AND day >= ? GROUP BY user_id HAVING score > 0 ORDER BY score DESC LIMIT ? OFFSET ?", [guildId, sinceDay || "0000"]],
      voice: ["member_activity_daily", "SELECT user_id, SUM(voice_seconds) AS score FROM member_activity_daily WHERE guild_id = ? AND day >= ? GROUP BY user_id HAVING score > 0 ORDER BY score DESC LIMIT ? OFFSET ?", [guildId, sinceDay || "0000"]],
      activity: ["member_activity_daily", "SELECT user_id, COUNT(*) AS score FROM member_activity_daily WHERE guild_id = ? AND day >= ? GROUP BY user_id ORDER BY score DESC LIMIT ? OFFSET ?", [guildId, sinceDay || "0000"]],
      economy: ["accounts", "SELECT user_id, wallet + bank AS score FROM accounts WHERE guild_id = ? AND wallet + bank > 0 ORDER BY score DESC LIMIT ? OFFSET ?", [guildId]],
      tickets: ["tickets", "SELECT closed_by AS user_id, COUNT(*) AS score FROM tickets WHERE guild_id = ? AND closed_by IS NOT NULL AND closed_at >= ? GROUP BY closed_by ORDER BY score DESC LIMIT ? OFFSET ?", [guildId, sinceMs]],
      achievements: ["achievement_unlocks", "SELECT user_id, COUNT(*) AS score FROM achievement_unlocks WHERE guild_id = ? AND unlocked_at >= ? GROUP BY user_id ORDER BY score DESC LIMIT ? OFFSET ?", [guildId, sinceMs]],
      games: ["game_stats", "SELECT user_id, SUM(profit) AS score FROM game_stats WHERE guild_id = ? GROUP BY user_id HAVING score != 0 ORDER BY score DESC LIMIT ? OFFSET ?", [guildId]],
      invites: ["invite_joins", "SELECT inviter_id AS user_id, COUNT(*) AS score FROM invite_joins WHERE guild_id = ? AND inviter_id IS NOT NULL AND left_at IS NULL AND fake = 0 AND joined_at >= ? GROUP BY inviter_id ORDER BY score DESC LIMIT ? OFFSET ?", [guildId, sinceMs]],
      giveaways: ["giveaway_winners", "SELECT w.user_id, COUNT(*) AS score FROM giveaway_winners w JOIN giveaways g ON g.id = w.giveaway_id WHERE g.guild_id = ? AND w.drawn_at >= ? GROUP BY w.user_id ORDER BY score DESC LIMIT ? OFFSET ?", [guildId, sinceMs]],
      reputation: ["social_reputation", "SELECT receiver_id AS user_id, COUNT(*) AS score FROM social_reputation WHERE guild_id = ? AND created_at >= ? GROUP BY receiver_id ORDER BY score DESC LIMIT ? OFFSET ?", [guildId, sinceMs]]
    }[type];
    if (!q || !this._has(q[0])) return [];
    return this.db.prepare(q[1]).all(...q[2], limit, offset);
  }

  /** ترتيب عضو محدد في نوع معيّن (للتذييل "ترتيبك"). */
  positionOf(type, guildId, userId, opts) {
    const all = this.query(type, guildId, { ...opts, limit: 1000, offset: 0 });
    const idx = all.findIndex((r) => r.user_id === userId);
    return idx === -1 ? null : { position: idx + 1, score: all[idx].score, total: all.length };
  }
}

module.exports = LeaderboardRepository;
