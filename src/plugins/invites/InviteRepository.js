class InviteRepository {
  constructor(db) {
    this.db = db;
  }

  recordJoin({ guildId, userId, inviterId, code, fake }) {
    this.db
      .prepare("INSERT INTO invite_joins (guild_id, user_id, inviter_id, code, fake, joined_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(guildId, userId, inviterId || null, code || null, fake ? 1 : 0, Date.now());
  }

  /** يعلّم آخر دخول مفتوح للعضو كمغادر (مرة واحدة). */
  markLeft(guildId, userId) {
    return this.db
      .prepare(`UPDATE invite_joins SET left_at = ? WHERE id = (
         SELECT id FROM invite_joins WHERE guild_id = ? AND user_id = ? AND left_at IS NULL ORDER BY id DESC LIMIT 1)`)
      .run(Date.now(), guildId, userId).changes === 1;
  }

  /** الدعوات الفعلية = من دخل ولم يغادر ولم يكن حسابه وهميًا. */
  stats(guildId, inviterId, sinceMs = 0) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN left_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS left,
                COALESCE(SUM(CASE WHEN left_at IS NULL AND fake = 1 THEN 1 ELSE 0 END), 0) AS fake,
                COALESCE(SUM(CASE WHEN left_at IS NULL AND fake = 0 THEN 1 ELSE 0 END), 0) AS real
         FROM invite_joins WHERE guild_id = ? AND inviter_id = ? AND joined_at >= ?`
      )
      .get(guildId, inviterId, sinceMs);
  }

  inviterOf(guildId, userId) {
    return this.db.prepare("SELECT * FROM invite_joins WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1").get(guildId, userId) || null;
  }

  recentInvited(guildId, inviterId, limit = 10) {
    return this.db
      .prepare("SELECT user_id, joined_at, left_at, fake FROM invite_joins WHERE guild_id = ? AND inviter_id = ? ORDER BY id DESC LIMIT ?")
      .all(guildId, inviterId, limit);
  }
}

module.exports = InviteRepository;
