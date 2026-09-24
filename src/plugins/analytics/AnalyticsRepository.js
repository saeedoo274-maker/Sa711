/** تجميعات يومية للقراءة فقط من جداول الأنظمة. كل استعلام محدود بالسيرفر والفترة. */
const DAY_EXPR = (col) => `strftime('%Y-%m-%d', ${col} / 1000, 'unixepoch')`;

class AnalyticsRepository {
  constructor(db) {
    this.db = db;
  }

  _hasTable(name) {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  }

  _byDay(sql, params) {
    const out = {};
    for (const r of this.db.prepare(sql).all(...params)) out[r.day] = r.v;
    return out;
  }

  messagesByDay(guildId, sinceDay) {
    return this._byDay("SELECT day, SUM(messages) AS v FROM member_activity_daily WHERE guild_id = ? AND day >= ? GROUP BY day", [guildId, sinceDay]);
  }

  voiceByDay(guildId, sinceDay) {
    return this._byDay("SELECT day, SUM(voice_seconds) AS v FROM member_activity_daily WHERE guild_id = ? AND day >= ? GROUP BY day", [guildId, sinceDay]);
  }

  activeByDay(guildId, sinceDay) {
    return this._byDay("SELECT day, COUNT(DISTINCT user_id) AS v FROM member_activity_daily WHERE guild_id = ? AND day >= ? GROUP BY day", [guildId, sinceDay]);
  }

  presenceByDay(guildId, sinceMs, action) {
    return this._byDay(`SELECT ${DAY_EXPR("at")} AS day, COUNT(*) AS v FROM member_presence_log WHERE guild_id = ? AND at >= ? AND action = ? GROUP BY day`, [guildId, sinceMs, action]);
  }

  countByDay(table, column, guildId, sinceMs, extra = "") {
    const allowed = { tickets: ["created_at", "closed_at"], applications: ["created_at"], transactions: ["created_at"], giveaways: ["created_at"], suggestions: ["created_at"] };
    if (!allowed[table]?.includes(column) || !this._hasTable(table)) return {};
    return this._byDay(`SELECT ${DAY_EXPR(column)} AS day, COUNT(*) AS v FROM ${table} WHERE guild_id = ? AND ${column} >= ? ${extra} GROUP BY day`, [guildId, sinceMs]);
  }

  economyVolumeByDay(guildId, sinceMs) {
    return this._byDay(
      `SELECT ${DAY_EXPR("created_at")} AS day, SUM(ABS(amount)) AS v FROM transactions WHERE guild_id = ? AND created_at >= ? AND type IN ('transfer_out', 'charge', 'deposit', 'withdraw', 'admin_add', 'admin_remove') GROUP BY day`,
      [guildId, sinceMs]
    );
  }

  activeMembers(guildId, sinceDay) {
    return this.db.prepare("SELECT COUNT(DISTINCT user_id) AS c FROM member_activity_daily WHERE guild_id = ? AND day >= ?").get(guildId, sinceDay).c;
  }

  ticketTimes(guildId, sinceMs) {
    return this.db
      .prepare(
        `SELECT AVG(CASE WHEN claimed_at IS NOT NULL THEN claimed_at - created_at END) AS avgResponse,
                AVG(CASE WHEN closed_at IS NOT NULL THEN closed_at - created_at END) AS avgClose,
                COUNT(*) AS opened, COALESCE(SUM(status != 'open'), 0) AS closed
         FROM tickets WHERE guild_id = ? AND created_at >= ?`
      )
      .get(guildId, sinceMs);
  }

  /** أداء الطاقم: النشاط اليومي + التذاكر + التقديمات المراجَعة + متوسط زمن الاستجابة. */
  staff(guildId, sinceDay, sinceMs) {
    const activity = this.db
      .prepare(
        `SELECT user_id, SUM(messages) AS messages, SUM(voice_seconds) AS voice, SUM(tickets_claimed) AS claimed, SUM(tickets_closed) AS closed, COUNT(*) AS days
         FROM staff_activity WHERE guild_id = ? AND day >= ? GROUP BY user_id`
      )
      .all(guildId, sinceDay);
    const response = this.db
      .prepare("SELECT claimed_by AS user_id, AVG(claimed_at - created_at) AS avgResponse, COUNT(*) AS n FROM tickets WHERE guild_id = ? AND created_at >= ? AND claimed_by IS NOT NULL GROUP BY claimed_by")
      .all(guildId, sinceMs);
    const reviews = this.db
      .prepare("SELECT reviewer_id AS user_id, COUNT(*) AS n FROM applications WHERE guild_id = ? AND reviewed_at >= ? AND reviewer_id IS NOT NULL GROUP BY reviewer_id")
      .all(guildId, sinceMs);
    const map = new Map();
    const get = (id) => {
      if (!map.has(id)) map.set(id, { userId: id, messages: 0, voice: 0, claimed: 0, closed: 0, days: 0, avgResponse: null, reviews: 0 });
      return map.get(id);
    };
    for (const a of activity) Object.assign(get(a.user_id), { messages: a.messages, voice: a.voice, claimed: a.claimed, closed: a.closed, days: a.days });
    for (const r of response) get(r.user_id).avgResponse = r.avgResponse;
    for (const r of reviews) get(r.user_id).reviews = r.n;
    return [...map.values()];
  }
}

module.exports = AnalyticsRepository;
