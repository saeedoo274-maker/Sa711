/** صيغة المستويات: XP المطلوب للانتقال من المستوى L إلى L+1. */
function xpToNext(level) {
  return 5 * level * level + 50 * level + 100;
}

function levelFromXp(xp) {
  let level = 0;
  let remaining = Math.max(0, xp);
  while (remaining >= xpToNext(level) && level < 1000) {
    remaining -= xpToNext(level);
    level++;
  }
  return level;
}

/** مستودع المستويات — كل كتابة على XP ذرّية داخل معاملة واحدة. */
class LevelRepository {
  constructor(db) {
    this.db = db;
    this._ensure = db.prepare(
      "INSERT OR IGNORE INTO level_members (guild_id, user_id, updated_at) VALUES (?, ?, ?)"
    );
    this._get = db.prepare("SELECT * FROM level_members WHERE guild_id = ? AND user_id = ?");

    /**
     * يمنح XP رسالة مع كل فحوصات منع الاستغلال داخل نفس المعاملة:
     * التبريد، تكرار نفس النص، والسقف اليومي. يُرجع null إن لم يُمنح شيء.
     */
    this._awardMessage = db.transaction(({ guildId, userId, amount, cooldownMs, hash, now, dayKey, weekKey, dailyCap }) => {
      this._ensure.run(guildId, userId, now);
      const row = this._get.get(guildId, userId);
      if (row.last_xp_at > now - cooldownMs) return null;
      if (hash && row.last_content_hash === hash) return null;

      const dailyBase = row.day_key === dayKey ? row.daily_xp : 0;
      const weeklyBase = row.week_key === weekKey ? row.weekly_xp : 0;
      let grant = amount;
      if (dailyCap > 0) {
        if (dailyBase >= dailyCap) return null;
        grant = Math.min(grant, dailyCap - dailyBase);
      }
      const xp = row.xp + grant;
      const level = levelFromXp(xp);
      db.prepare(
        `UPDATE level_members SET xp = ?, level = ?, messages = messages + 1, last_xp_at = ?, last_content_hash = ?,
           day_key = ?, daily_xp = ?, week_key = ?, weekly_xp = ?, updated_at = ?
         WHERE guild_id = ? AND user_id = ?`
      ).run(xp, level, now, hash, dayKey, dailyBase + grant, weekKey, weeklyBase + grant, now, guildId, userId);
      return { granted: grant, xp, oldLevel: row.level, newLevel: level };
    });

    /** تعديل XP عام (إداري/صوت/مكافأة). لا ينزل تحت الصفر. */
    this._add = db.transaction(({ guildId, userId, delta, now, dayKey, weekKey, voiceSeconds, log }) => {
      this._ensure.run(guildId, userId, now);
      const row = this._get.get(guildId, userId);
      const xp = Math.max(0, row.xp + delta);
      const applied = xp - row.xp;
      const level = levelFromXp(xp);
      const positive = Math.max(0, applied);
      const daily = (row.day_key === dayKey ? row.daily_xp : 0) + positive;
      const weekly = (row.week_key === weekKey ? row.weekly_xp : 0) + positive;
      db.prepare(
        `UPDATE level_members SET xp = ?, level = ?, voice_seconds = voice_seconds + ?, day_key = ?, daily_xp = ?,
           week_key = ?, weekly_xp = ?, updated_at = ?
         WHERE guild_id = ? AND user_id = ?`
      ).run(xp, level, voiceSeconds || 0, dayKey, daily, weekKey, weekly, now, guildId, userId);
      if (log) {
        db.prepare("INSERT INTO level_xp_log (guild_id, user_id, delta, reason, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(guildId, userId, applied, log.reason || null, log.actorId || null, now);
      }
      return { applied, xp, oldLevel: row.level, newLevel: level };
    });

    this._transfer = db.transaction(({ guildId, fromId, toId, amount, actorId, now }) => {
      this._ensure.run(guildId, fromId, now);
      this._ensure.run(guildId, toId, now);
      const from = this._get.get(guildId, fromId);
      if (from.xp < amount) return { ok: false, reason: "insufficient", available: from.xp };
      const to = this._get.get(guildId, toId);
      const fromXp = from.xp - amount;
      const toXp = to.xp + amount;
      db.prepare("UPDATE level_members SET xp = ?, level = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?")
        .run(fromXp, levelFromXp(fromXp), now, guildId, fromId);
      db.prepare("UPDATE level_members SET xp = ?, level = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?")
        .run(toXp, levelFromXp(toXp), now, guildId, toId);
      const log = db.prepare("INSERT INTO level_xp_log (guild_id, user_id, delta, reason, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)");
      log.run(guildId, fromId, -amount, `transfer→${toId}`, actorId, now);
      log.run(guildId, toId, amount, `transfer←${fromId}`, actorId, now);
      return {
        ok: true,
        from: { oldLevel: from.level, newLevel: levelFromXp(fromXp), xp: fromXp },
        to: { oldLevel: to.level, newLevel: levelFromXp(toXp), xp: toXp }
      };
    });
  }

  static xpToNext(level) { return xpToNext(level); }
  static levelFromXp(xp) { return levelFromXp(xp); }

  get(guildId, userId) {
    return this._get.get(guildId, userId) || null;
  }

  awardMessage(args) { return this._awardMessage(args); }
  add(args) { return this._add(args); }
  transfer(args) { return this._transfer(args); }

  resetUser(guildId, userId, actorId) {
    const tx = this.db.transaction(() => {
      const row = this.get(guildId, userId);
      if (!row) return false;
      this.db.prepare("DELETE FROM level_members WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
      this.db.prepare("INSERT INTO level_xp_log (guild_id, user_id, delta, reason, actor_id, created_at) VALUES (?, ?, ?, 'reset', ?, ?)")
        .run(guildId, userId, -row.xp, actorId, Date.now());
      return true;
    });
    return tx();
  }

  resetGuild(guildId) {
    return this.db.prepare("DELETE FROM level_members WHERE guild_id = ?").run(guildId).changes;
  }

  /** ترتيب العضو (المتساوون في XP يتشاركون الترتيب). */
  rankOf(guildId, userId) {
    const row = this.get(guildId, userId);
    if (!row) return null;
    return this.db.prepare("SELECT COUNT(*) + 1 AS r FROM level_members WHERE guild_id = ? AND xp > ?").get(guildId, row.xp).r;
  }

  leaderboard(guildId, { period = "all", dayKey = null, weekKey = null, limit = 10, offset = 0 } = {}) {
    const lim = Math.min(Math.max(1, limit), 100);
    if (period === "weekly") {
      return this.db
        .prepare("SELECT *, weekly_xp AS score FROM level_members WHERE guild_id = ? AND week_key = ? AND weekly_xp > 0 ORDER BY weekly_xp DESC LIMIT ? OFFSET ?")
        .all(guildId, weekKey, lim, offset);
    }
    if (period === "daily") {
      return this.db
        .prepare("SELECT *, daily_xp AS score FROM level_members WHERE guild_id = ? AND day_key = ? AND daily_xp > 0 ORDER BY daily_xp DESC LIMIT ? OFFSET ?")
        .all(guildId, dayKey, lim, offset);
    }
    if (period === "voice") {
      return this.db
        .prepare("SELECT *, voice_seconds AS score FROM level_members WHERE guild_id = ? AND voice_seconds > 0 ORDER BY voice_seconds DESC LIMIT ? OFFSET ?")
        .all(guildId, lim, offset);
    }
    if (period === "messages") {
      return this.db
        .prepare("SELECT *, messages AS score FROM level_members WHERE guild_id = ? AND messages > 0 ORDER BY messages DESC LIMIT ? OFFSET ?")
        .all(guildId, lim, offset);
    }
    return this.db
      .prepare("SELECT *, xp AS score FROM level_members WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC LIMIT ? OFFSET ?")
      .all(guildId, lim, offset);
  }

  count(guildId, { period = "all", dayKey = null, weekKey = null } = {}) {
    if (period === "weekly") return this.db.prepare("SELECT COUNT(*) AS c FROM level_members WHERE guild_id = ? AND week_key = ? AND weekly_xp > 0").get(guildId, weekKey).c;
    if (period === "daily") return this.db.prepare("SELECT COUNT(*) AS c FROM level_members WHERE guild_id = ? AND day_key = ? AND daily_xp > 0").get(guildId, dayKey).c;
    if (period === "voice") return this.db.prepare("SELECT COUNT(*) AS c FROM level_members WHERE guild_id = ? AND voice_seconds > 0").get(guildId).c;
    if (period === "messages") return this.db.prepare("SELECT COUNT(*) AS c FROM level_members WHERE guild_id = ? AND messages > 0").get(guildId).c;
    return this.db.prepare("SELECT COUNT(*) AS c FROM level_members WHERE guild_id = ? AND xp > 0").get(guildId).c;
  }

  stats(guildId) {
    return this.db
      .prepare("SELECT COUNT(*) AS members, COALESCE(SUM(xp), 0) AS totalXp, COALESCE(MAX(level), 0) AS maxLevel, COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(voice_seconds), 0) AS voiceSeconds FROM level_members WHERE guild_id = ?")
      .get(guildId);
  }

  xpLog(guildId, userId, limit = 10) {
    return this.db.prepare("SELECT * FROM level_xp_log WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?").all(guildId, userId, limit);
  }

  // ---------------- المكافآت ----------------

  addReward(guildId, { level, roleId = null, money = 0 }) {
    const info = this.db
      .prepare("INSERT INTO level_rewards (guild_id, level, role_id, money, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, level, roleId, money, Date.now());
    return info.lastInsertRowid;
  }

  removeRewards(guildId, level, roleId = null) {
    if (roleId) return this.db.prepare("DELETE FROM level_rewards WHERE guild_id = ? AND level = ? AND role_id = ?").run(guildId, level, roleId).changes;
    return this.db.prepare("DELETE FROM level_rewards WHERE guild_id = ? AND level = ?").run(guildId, level).changes;
  }

  rewards(guildId) {
    return this.db.prepare("SELECT * FROM level_rewards WHERE guild_id = ? ORDER BY level ASC, id ASC").all(guildId);
  }

  rewardsBetween(guildId, fromExclusive, toInclusive) {
    return this.db
      .prepare("SELECT * FROM level_rewards WHERE guild_id = ? AND level > ? AND level <= ? ORDER BY level ASC")
      .all(guildId, fromExclusive, toInclusive);
  }

  // ---------------- المضاعفات ----------------

  setMultiplier(guildId, type, targetId, multiplier) {
    if (!multiplier || multiplier === 1) {
      return this.db.prepare("DELETE FROM level_multipliers WHERE guild_id = ? AND target_type = ? AND target_id = ?").run(guildId, type, targetId).changes;
    }
    this.db
      .prepare(
        `INSERT INTO level_multipliers (guild_id, target_type, target_id, multiplier) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, target_type, target_id) DO UPDATE SET multiplier = excluded.multiplier`
      )
      .run(guildId, type, targetId, multiplier);
    return 1;
  }

  multipliers(guildId) {
    return this.db.prepare("SELECT * FROM level_multipliers WHERE guild_id = ?").all(guildId);
  }

  // ---------------- القائمة السوداء ----------------

  toggleBlacklist(guildId, userId, { reason = null, actorId = null } = {}) {
    const exists = this.db.prepare("SELECT 1 FROM level_blacklist WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
    if (exists) {
      this.db.prepare("DELETE FROM level_blacklist WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
      return false;
    }
    this.db.prepare("INSERT INTO level_blacklist (guild_id, user_id, reason, actor_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, userId, reason, actorId, Date.now());
    return true;
  }

  blacklist(guildId) {
    return this.db.prepare("SELECT * FROM level_blacklist WHERE guild_id = ? ORDER BY created_at DESC").all(guildId);
  }

  blacklistSet(guildId) {
    return new Set(this.blacklist(guildId).map((r) => r.user_id));
  }
}

module.exports = LevelRepository;
