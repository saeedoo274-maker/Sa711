class OversightRepository {
  constructor(db) {
    this.db = db;
  }

  // ---------------- سجل السيرفرات ----------------

  /** يسجّل السيرفر أو يحدّث بياناته عند كل إقلاع أو انضمام. */
  track({ guildId, name, ownerId, memberCount, iconUrl }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO guild_registry (guild_id, name, owner_id, member_count, icon_url, joined_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')
         ON CONFLICT(guild_id) DO UPDATE SET
           name = excluded.name,
           owner_id = excluded.owner_id,
           member_count = excluded.member_count,
           icon_url = excluded.icon_url,
           left_at = NULL,
           status = CASE WHEN guild_registry.status = 'blacklisted' THEN 'blacklisted' ELSE 'active' END`
      )
      .run(guildId, name || null, ownerId || null, memberCount || 0, iconUrl || null, now);
    return this.get(guildId);
  }

  markLeft(guildId) {
    this.db
      .prepare(
        `UPDATE guild_registry SET left_at = ?, status = CASE WHEN status = 'blacklisted' THEN 'blacklisted' ELSE 'left' END
         WHERE guild_id = ?`
      )
      .run(Date.now(), guildId);
  }

  get(guildId) {
    return this.db.prepare("SELECT * FROM guild_registry WHERE guild_id = ?").get(guildId) || null;
  }

  list({ status = null, limit = 25, offset = 0, sort = "members" } = {}) {
    // الترتيب من قائمة بيضاء ثابتة، لا من مدخلات المستخدم
    const order = {
      members: "member_count DESC",
      newest: "joined_at DESC",
      oldest: "joined_at ASC",
      active: "last_used_at DESC",
      usage: "commands_used DESC"
    }[sort] || "member_count DESC";

    if (status) {
      return this.db
        .prepare(`SELECT * FROM guild_registry WHERE status = ? ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(status, limit, offset);
    }
    return this.db.prepare(`SELECT * FROM guild_registry ORDER BY ${order} LIMIT ? OFFSET ?`).all(limit, offset);
  }

  count(status = null) {
    return status
      ? this.db.prepare("SELECT COUNT(*) AS c FROM guild_registry WHERE status = ?").get(status).c
      : this.db.prepare("SELECT COUNT(*) AS c FROM guild_registry").get().c;
  }

  totals() {
    return this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) AS active,
           COALESCE(SUM(CASE WHEN status='left' THEN 1 ELSE 0 END),0) AS left_count,
           COALESCE(SUM(CASE WHEN status='blacklisted' THEN 1 ELSE 0 END),0) AS blacklisted,
           COALESCE(SUM(CASE WHEN status='active' THEN member_count ELSE 0 END),0) AS members,
           COALESCE(SUM(commands_used),0) AS commands
         FROM guild_registry`
      )
      .get();
  }

  recordUsage(guildId) {
    this.db
      .prepare("UPDATE guild_registry SET commands_used = commands_used + 1, last_used_at = ? WHERE guild_id = ?")
      .run(Date.now(), guildId);
  }

  /** القائمة السوداء ذرّية: تنجح مرة واحدة فقط. */
  blacklist(guildId, { reason, by }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO guild_registry (guild_id, joined_at, status, blacklist_reason, blacklisted_by, blacklisted_at)
         VALUES (?, ?, 'blacklisted', ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           status = 'blacklisted', blacklist_reason = excluded.blacklist_reason,
           blacklisted_by = excluded.blacklisted_by, blacklisted_at = excluded.blacklisted_at`
      )
      .run(guildId, now, reason || null, by || null, now);
    return this.get(guildId);
  }

  unblacklist(guildId) {
    return this.db
      .prepare(
        `UPDATE guild_registry SET status = CASE WHEN left_at IS NULL THEN 'active' ELSE 'left' END,
           blacklist_reason = NULL, blacklisted_by = NULL, blacklisted_at = NULL
         WHERE guild_id = ? AND status = 'blacklisted'`
      )
      .run(guildId).changes === 1;
  }

  isBlacklisted(guildId) {
    const row = this.db.prepare("SELECT status FROM guild_registry WHERE guild_id = ?").get(guildId);
    return row?.status === "blacklisted";
  }

  setNotes(guildId, notes) {
    this.db.prepare("UPDATE guild_registry SET notes = ? WHERE guild_id = ?").run(notes || null, guildId);
  }

  // ---------------- أحداث الإساءة ----------------

  recordAbuse({ guildId, userId, kind, detail }) {
    this.db
      .prepare("INSERT INTO abuse_events (guild_id, user_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, userId || null, kind, detail || null, Date.now());
  }

  abuseCount(guildId, sinceMs) {
    return this.db
      .prepare("SELECT COUNT(*) AS c FROM abuse_events WHERE guild_id = ? AND created_at >= ?")
      .get(guildId, Date.now() - sinceMs).c;
  }

  recentAbuse(limit = 15) {
    return this.db.prepare("SELECT * FROM abuse_events ORDER BY created_at DESC LIMIT ?").all(limit);
  }

  // ---------------- الإغلاق الطارئ ----------------

  saveLockdown({ guildId, startedBy, reason, channels }) {
    this.db
      .prepare(
        `INSERT INTO lockdowns (guild_id, started_by, started_at, reason, channels) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           started_by = excluded.started_by, started_at = excluded.started_at,
           reason = excluded.reason, channels = excluded.channels`
      )
      .run(guildId, startedBy, Date.now(), reason || null, JSON.stringify(channels || []));
  }

  getLockdown(guildId) {
    const row = this.db.prepare("SELECT * FROM lockdowns WHERE guild_id = ?").get(guildId);
    return row ? { ...row, channels: JSON.parse(row.channels || "[]") } : null;
  }

  clearLockdown(guildId) {
    return this.db.prepare("DELETE FROM lockdowns WHERE guild_id = ?").run(guildId).changes === 1;
  }
}

module.exports = OversightRepository;
