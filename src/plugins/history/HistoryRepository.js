/**
 * مستودع سجل الأعضاء. يقرأ أيضًا (للقراءة فقط) من جداول الأنظمة الأخرى
 * (القضايا، التذاكر، التقديمات) لبناء ملف العضو الموحّد.
 */
class HistoryRepository {
  constructor(db) {
    this.db = db;
    this._activity = db.prepare(
      `INSERT INTO member_activity_daily (guild_id, user_id, day, messages, voice_seconds) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id, day) DO UPDATE SET messages = messages + excluded.messages, voice_seconds = voice_seconds + excluded.voice_seconds`
    );
    this._seenMsg = db.prepare(
      `INSERT INTO member_last_seen (guild_id, user_id, last_message_at, last_channel_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET last_message_at = MAX(COALESCE(last_message_at, 0), excluded.last_message_at), last_channel_id = excluded.last_channel_id`
    );
    this._seenVoice = db.prepare(
      `INSERT INTO member_last_seen (guild_id, user_id, last_voice_at) VALUES (?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET last_voice_at = MAX(COALESCE(last_voice_at, 0), excluded.last_voice_at)`
    );
    this._flush = db.transaction((activity, seen) => {
      for (const a of activity) this._activity.run(a.guildId, a.userId, a.day, a.messages, a.voiceSeconds);
      for (const s of seen) {
        if (s.lastMessageAt) this._seenMsg.run(s.guildId, s.userId, s.lastMessageAt, s.channelId);
        if (s.lastVoiceAt) this._seenVoice.run(s.guildId, s.userId, s.lastVoiceAt);
      }
    });
  }

  flush(activity, seen) {
    this._flush(activity, seen);
  }

  addName(guildId, userId, kind, oldValue, newValue) {
    this.db
      .prepare("INSERT INTO member_name_history (guild_id, user_id, kind, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(guildId, userId, kind, oldValue, newValue, Date.now());
  }

  addRole(guildId, userId, roleId, action, actorId = null) {
    this.db
      .prepare("INSERT INTO member_role_history (guild_id, user_id, role_id, action, actor_id, changed_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(guildId, userId, roleId, action, actorId, Date.now());
  }

  addPresence(guildId, userId, action, username) {
    this.db.prepare("INSERT INTO member_presence_log (guild_id, user_id, action, username, at) VALUES (?, ?, ?, ?, ?)").run(guildId, userId, action, username, Date.now());
  }

  names(guildId, userId, limit = 25) {
    return this.db
      .prepare("SELECT * FROM member_name_history WHERE user_id = ? AND (guild_id = ? OR guild_id = '*') ORDER BY changed_at DESC LIMIT ?")
      .all(userId, guildId, limit);
  }

  roles(guildId, userId, limit = 25) {
    return this.db.prepare("SELECT * FROM member_role_history WHERE guild_id = ? AND user_id = ? ORDER BY changed_at DESC LIMIT ?").all(guildId, userId, limit);
  }

  presence(guildId, userId, limit = 25) {
    return this.db.prepare("SELECT * FROM member_presence_log WHERE guild_id = ? AND user_id = ? ORDER BY at DESC LIMIT ?").all(guildId, userId, limit);
  }

  presenceCounts(guildId, userId) {
    return this.db
      .prepare("SELECT COALESCE(SUM(action = 'join'), 0) AS joins, COALESCE(SUM(action = 'leave'), 0) AS leaves, MIN(CASE WHEN action = 'join' THEN at END) AS firstJoin FROM member_presence_log WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId);
  }

  activity(guildId, userId, sinceDay) {
    return this.db
      .prepare("SELECT COALESCE(SUM(messages), 0) AS messages, COALESCE(SUM(voice_seconds), 0) AS voiceSeconds, COUNT(*) AS activeDays FROM member_activity_daily WHERE guild_id = ? AND user_id = ? AND day >= ?")
      .get(guildId, userId, sinceDay);
  }

  activitySeries(guildId, userId, sinceDay) {
    return this.db
      .prepare("SELECT day, messages, voice_seconds FROM member_activity_daily WHERE guild_id = ? AND user_id = ? AND day >= ? ORDER BY day ASC")
      .all(guildId, userId, sinceDay);
  }

  lastSeen(guildId, userId) {
    return this.db.prepare("SELECT * FROM member_last_seen WHERE guild_id = ? AND user_id = ?").get(guildId, userId) || null;
  }

  /** البحث بالاسم الحالي أو القديم (جزئيًا) — يُرجع آيديات مميّزة. */
  searchByName(guildId, query, limit = 25) {
    const like = `%${String(query).replace(/[%_]/g, "\\$&")}%`;
    return this.db
      .prepare(
        `SELECT user_id, MAX(changed_at) AS last, GROUP_CONCAT(DISTINCT new_value) AS names FROM member_name_history
         WHERE (guild_id = ? OR guild_id = '*') AND (new_value LIKE ? ESCAPE '\\' OR old_value LIKE ? ESCAPE '\\')
         GROUP BY user_id ORDER BY last DESC LIMIT ?`
      )
      .all(guildId, like, like, limit);
  }

  topActive(guildId, sinceDay, field = "messages", limit = 10) {
    const col = field === "voice" ? "voice_seconds" : "messages";
    return this.db
      .prepare(`SELECT user_id, SUM(${col}) AS score FROM member_activity_daily WHERE guild_id = ? AND day >= ? GROUP BY user_id HAVING score > 0 ORDER BY score DESC LIMIT ?`)
      .all(guildId, sinceDay, limit);
  }

  activeMembersCount(guildId, sinceDay) {
    return this.db.prepare("SELECT COUNT(DISTINCT user_id) AS c FROM member_activity_daily WHERE guild_id = ? AND day >= ?").get(guildId, sinceDay).c;
  }

  // ---- قراءة من أنظمة أخرى (للقراءة فقط) ----

  moderationSummary(guildId, userId) {
    return this.db.prepare("SELECT type, COUNT(*) AS c FROM cases WHERE guild_id = ? AND target_id = ? GROUP BY type").all(guildId, userId);
  }

  ticketSummary(guildId, userId) {
    return this.db
      .prepare("SELECT COUNT(*) AS opened, COALESCE(SUM(status = 'open'), 0) AS open, MAX(created_at) AS last FROM tickets WHERE guild_id = ? AND owner_id = ?")
      .get(guildId, userId);
  }

  ticketsHandled(guildId, userId) {
    return this.db
      .prepare("SELECT COALESCE(SUM(claimed_by = ?), 0) AS claimed, COALESCE(SUM(closed_by = ?), 0) AS closed FROM tickets WHERE guild_id = ?")
      .get(userId, userId, guildId);
  }

  applicationSummary(guildId, userId) {
    return this.db.prepare("SELECT status, COUNT(*) AS c FROM applications WHERE guild_id = ? AND user_id = ? GROUP BY status").all(guildId, userId);
  }

  purgeOlderThan(ms) {
    const cutoffDay = new Date(Date.now() - ms).toISOString().slice(0, 10);
    const cutoff = Date.now() - ms;
    const tx = this.db.transaction(() => ({
      activity: this.db.prepare("DELETE FROM member_activity_daily WHERE day < ?").run(cutoffDay).changes,
      roles: this.db.prepare("DELETE FROM member_role_history WHERE changed_at < ?").run(cutoff).changes
    }));
    return tx();
  }
}

module.exports = HistoryRepository;
