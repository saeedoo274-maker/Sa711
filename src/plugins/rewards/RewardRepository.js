/** مستودع المكافآت — الطبقة الوحيدة في الإضافة التي تكتب SQL. */
class RewardRepository {
  constructor(db) {
    this.db = db;
  }

  log({ guildId, userId, source, sourceRef = null, money = 0, xp = 0, roleId = null, itemKey = null, itemQty = 0, badge = null, actorId = null }) {
    this.db
      .prepare(
        `INSERT INTO reward_log (guild_id, user_id, source, source_ref, money, xp, role_id, item_key, item_qty, badge, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(guildId, userId, source, sourceRef, money, xp, roleId, itemKey, itemQty, badge, actorId, Date.now());
  }

  history(guildId, userId, limit = 20) {
    return this.db
      .prepare("SELECT * FROM reward_log WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?")
      .all(guildId, userId, Math.min(limit, 100));
  }

  totals(guildId, userId) {
    return this.db
      .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(money), 0) AS money, COALESCE(SUM(xp), 0) AS xp FROM reward_log WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId);
  }

  /** مطالبة ذرّية: true في المرة الأولى فقط لنفس (العضو، النوع، الفترة). */
  claim(guildId, userId, kind, periodKey) {
    return (
      this.db
        .prepare("INSERT OR IGNORE INTO reward_claims (guild_id, user_id, kind, period_key, claimed_at) VALUES (?, ?, ?, ?, ?)")
        .run(guildId, userId, kind, periodKey, Date.now()).changes === 1
    );
  }

  hasClaimed(guildId, userId, kind, periodKey) {
    return !!this.db
      .prepare("SELECT 1 FROM reward_claims WHERE guild_id = ? AND user_id = ? AND kind = ? AND period_key = ?")
      .get(guildId, userId, kind, periodKey);
  }

  // ---------------- الشارات ----------------

  upsertBadge(guildId, { key, name, emoji = null, description = null }) {
    this.db
      .prepare(
        `INSERT INTO badges (guild_id, key, name, emoji, description, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, key) DO UPDATE SET name = excluded.name, emoji = excluded.emoji, description = excluded.description`
      )
      .run(guildId, key, name, emoji, description, Date.now());
    return this.badge(guildId, key);
  }

  badge(guildId, key) {
    return this.db.prepare("SELECT * FROM badges WHERE guild_id = ? AND key = ?").get(guildId, key) || null;
  }

  badgeCatalog(guildId) {
    return this.db.prepare("SELECT * FROM badges WHERE guild_id = ? ORDER BY name").all(guildId);
  }

  deleteBadge(guildId, key) {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM member_badges WHERE guild_id = ? AND badge = ?").run(guildId, key);
      return this.db.prepare("DELETE FROM badges WHERE guild_id = ? AND key = ?").run(guildId, key).changes > 0;
    });
    return tx();
  }

  /** يمنح شارة مرة واحدة فقط — true إن كانت جديدة. */
  awardBadge(guildId, userId, badge, source = null) {
    return (
      this.db
        .prepare("INSERT OR IGNORE INTO member_badges (guild_id, user_id, badge, source, awarded_at) VALUES (?, ?, ?, ?, ?)")
        .run(guildId, userId, badge, source, Date.now()).changes === 1
    );
  }

  revokeBadge(guildId, userId, badge) {
    return this.db.prepare("DELETE FROM member_badges WHERE guild_id = ? AND user_id = ? AND badge = ?").run(guildId, userId, badge).changes > 0;
  }

  memberBadges(guildId, userId) {
    return this.db
      .prepare(
        `SELECT mb.badge, mb.source, mb.awarded_at, b.name, b.emoji, b.description
         FROM member_badges mb LEFT JOIN badges b ON b.guild_id = mb.guild_id AND b.key = mb.badge
         WHERE mb.guild_id = ? AND mb.user_id = ? ORDER BY mb.awarded_at ASC`
      )
      .all(guildId, userId);
  }

  badgeCount(guildId, userId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM member_badges WHERE guild_id = ? AND user_id = ?").get(guildId, userId).c;
  }

  purgeOldClaims(olderThanMs) {
    return this.db.prepare("DELETE FROM reward_claims WHERE claimed_at < ?").run(Date.now() - olderThanMs).changes;
  }
}

module.exports = RewardRepository;
