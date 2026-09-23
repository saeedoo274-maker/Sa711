const { dayKey } = require("../../utils/common");

/** نشاط الطاقم الإداري، مُجمَّع يوميًا لتفادي تضخم الجدول. */
class ActivityRepository {
  constructor(db) {
    this.db = db;
    this._ensure = db.prepare(
      `INSERT OR IGNORE INTO staff_activity (guild_id, user_id, day, messages, voice_seconds, tickets_claimed, tickets_closed, last_active_at)
       VALUES (?, ?, ?, 0, 0, 0, 0, ?)`
    );
  }

  _touch(guildId, userId, day) {
    this._ensure.run(guildId, userId, day, Date.now());
  }

  increment(guildId, userId, field, amount = 1) {
    const allowed = ["messages", "voice_seconds", "tickets_claimed", "tickets_closed"];
    if (!allowed.includes(field)) throw new Error(`حقل نشاط غير مسموح: ${field}`);
    const day = dayKey();
    const bump = this.db.transaction(() => {
      this._touch(guildId, userId, day);
      this.db
        .prepare(`UPDATE staff_activity SET ${field} = ${field} + ?, last_active_at = ? WHERE guild_id = ? AND user_id = ? AND day = ?`)
        .run(amount, Date.now(), guildId, userId, day);
    });
    bump();
  }

  /** ملخص عضو خلال آخر N يومًا. */
  summary(guildId, userId, days = 30) {
    const since = dayKey(new Date(Date.now() - days * 86_400_000));
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(messages),0) AS messages,
                COALESCE(SUM(voice_seconds),0) AS voice_seconds,
                COALESCE(SUM(tickets_claimed),0) AS tickets_claimed,
                COALESCE(SUM(tickets_closed),0) AS tickets_closed,
                MAX(last_active_at) AS last_active_at
         FROM staff_activity WHERE guild_id = ? AND user_id = ? AND day >= ?`
      )
      .get(guildId, userId, since);
    const today = this.db
      .prepare("SELECT messages, voice_seconds FROM staff_activity WHERE guild_id = ? AND user_id = ? AND day = ?")
      .get(guildId, userId, dayKey()) || { messages: 0, voice_seconds: 0 };
    return { ...row, today };
  }

  /**
   * نقاط الطاقم: مقياس واحد يجمع كل أوجه النشاط.
   *
   * الفكرة مقتبسة من مشروع مرجعي كان يخزّنها في ملف JSON منفصل؛
   * هنا تُحسب من `staff_activity` و`ticket_ratings` الموجودين أصلًا،
   * فلا جدول جديد ولا بيانات مكرّرة — ولا تحتاج هجرة.
   *
   * الأوزان قابلة للتعديل من إعدادات السيرفر (`staff.points`).
   */
  points(guildId, userId, days = 30, weights = {}) {
    const w = {
      perMessages: 50,      // كل 50 رسالة = نقطة
      claim: 1,             // استلام تذكرة
      close: 1,             // إغلاق تذكرة
      voiceHour: 1,         // كل ساعة صوت
      rating: { 1: 0.25, 2: 0.5, 3: 0.75, 4: 1, 5: 1.5 },
      ...weights
    };

    const act = this.summary(guildId, userId, days);
    const since = Date.now() - days * 86_400_000;

    const ratings = this.db
      .prepare(
        `SELECT stars, COUNT(*) AS c FROM ticket_ratings
         WHERE guild_id = ? AND staff_id = ? AND created_at >= ? GROUP BY stars`
      )
      .all(guildId, userId, since);

    let ratingPoints = 0;
    let ratingCount = 0;
    let starSum = 0;
    for (const r of ratings) {
      ratingPoints += (w.rating[r.stars] || 0) * r.c;
      ratingCount += r.c;
      starSum += r.stars * r.c;
    }

    const messagePoints = Math.floor((act.messages || 0) / w.perMessages);
    const claimPoints = (act.tickets_claimed || 0) * w.claim;
    const closePoints = (act.tickets_closed || 0) * w.close;
    const voicePoints = Math.floor((act.voice_seconds || 0) / 3600) * w.voiceHour;

    const total = messagePoints + claimPoints + closePoints + voicePoints + ratingPoints;

    return {
      total: Math.round(total * 100) / 100,
      breakdown: {
        messages: messagePoints,
        claims: claimPoints,
        closes: closePoints,
        voice: voicePoints,
        ratings: Math.round(ratingPoints * 100) / 100
      },
      raw: {
        messages: act.messages || 0,
        ticketsClaimed: act.tickets_claimed || 0,
        ticketsClosed: act.tickets_closed || 0,
        voiceSeconds: act.voice_seconds || 0,
        ratingCount,
        averageStars: ratingCount ? Math.round((starSum / ratingCount) * 100) / 100 : 0
      }
    };
  }

  /** ترتيب الطاقم بالنقاط. يعتمد على من له نشاط فعلي في الفترة. */
  pointsLeaderboard(guildId, days = 30, limit = 10, weights = {}) {
    const since = dayKey(new Date(Date.now() - days * 86_400_000));
    const users = this.db
      .prepare("SELECT DISTINCT user_id FROM staff_activity WHERE guild_id = ? AND day >= ?")
      .all(guildId, since)
      .map((r) => r.user_id);

    // نضمّ من قُيّم ولو لم يكن له نشاط مسجّل في الفترة
    const rated = this.db
      .prepare("SELECT DISTINCT staff_id FROM ticket_ratings WHERE guild_id = ? AND staff_id IS NOT NULL AND created_at >= ?")
      .all(guildId, Date.now() - days * 86_400_000)
      .map((r) => r.staff_id);

    const all = [...new Set([...users, ...rated])];

    return all
      .map((userId) => ({ userId, ...this.points(guildId, userId, days, weights) }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }

  leaderboard(guildId, field = "messages", days = 7, limit = 10) {
    const allowed = ["messages", "voice_seconds", "tickets_claimed", "tickets_closed"];
    if (!allowed.includes(field)) field = "messages";
    const since = dayKey(new Date(Date.now() - days * 86_400_000));
    return this.db
      .prepare(
        `SELECT user_id, SUM(${field}) AS total FROM staff_activity
         WHERE guild_id = ? AND day >= ? GROUP BY user_id ORDER BY total DESC LIMIT ?`
      )
      .all(guildId, since, limit);
  }

  // ---------------- تسجيل الدخول اليومي ----------------

  /**
   * يسجّل حضور الإداري ليوم واحد.
   * `INSERT OR IGNORE` يجعل أول تسجيل في اليوم هو المعتمد، وأي رسالة
   * لاحقة لا تغيّر وقت الحضور — فيبقى الوقت المسجّل هو أول ظهور فعلي.
   * @returns {boolean} true إن كان هذا أول تسجيل اليوم
   */
  checkIn(guildId, userId, source = "message") {
    const day = dayKey();
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO staff_checkins (guild_id, user_id, day, checked_at, source)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(guildId, userId, day, Date.now(), source);
    return res.changes === 1;
  }

  /** هل سجّل اليوم؟ */
  checkedInToday(guildId, userId) {
    return !!this.db
      .prepare("SELECT 1 FROM staff_checkins WHERE guild_id = ? AND user_id = ? AND day = ?")
      .get(guildId, userId, dayKey());
  }

  lastCheckIn(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM staff_checkins WHERE guild_id = ? AND user_id = ? ORDER BY day DESC LIMIT 1")
      .get(guildId, userId) || null;
  }

  /** عدد أيام الحضور خلال فترة. */
  checkInCount(guildId, userId, days = 30) {
    const since = dayKey(new Date(Date.now() - days * 86_400_000));
    return this.db
      .prepare("SELECT COUNT(*) AS c FROM staff_checkins WHERE guild_id = ? AND user_id = ? AND day >= ?")
      .get(guildId, userId, since).c;
  }

  /**
   * سلسلة الأيام المتتالية حتى اليوم (أو أمس إن لم يسجّل اليوم بعد).
   * تُحسب بالمشي للخلف يومًا بيوم، فأي فجوة تقطع السلسلة.
   */
  checkInStreak(guildId, userId) {
    const rows = this.db
      .prepare("SELECT day FROM staff_checkins WHERE guild_id = ? AND user_id = ? ORDER BY day DESC LIMIT 400")
      .all(guildId, userId)
      .map((r) => r.day);
    if (!rows.length) return 0;

    const set = new Set(rows);
    let streak = 0;
    let cursor = new Date();
    // لو ما سجّل اليوم نبدأ من أمس حتى لا تُقطع سلسلته قبل انتهاء اليوم
    if (!set.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - 86_400_000);
    while (set.has(dayKey(cursor))) {
      streak++;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    return streak;
  }

  /** حضور اليوم لكل السيرفر. */
  todayCheckIns(guildId) {
    return this.db
      .prepare("SELECT * FROM staff_checkins WHERE guild_id = ? AND day = ? ORDER BY checked_at ASC")
      .all(guildId, dayKey());
  }

  /** كم يومًا مضى منذ آخر حضور. null إن لم يسجّل قط. */
  daysSinceCheckIn(guildId, userId) {
    const last = this.lastCheckIn(guildId, userId);
    if (!last) return null;
    const lastDate = new Date(`${last.day}T00:00:00Z`);
    const today = new Date(`${dayKey()}T00:00:00Z`);
    return Math.max(0, Math.round((today - lastDate) / 86_400_000));
  }

  // ---------------- تحذيرات الغياب ----------------

  /** يسجّل تحذيرًا. يفشل بهدوء لو أُرسل تحذير لنفس العضو اليوم. */
  recordWarning(guildId, userId, missedDays, delivered) {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO staff_absence_warnings (guild_id, user_id, day, missed_days, sent_at, delivered)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(guildId, userId, dayKey(), missedDays, Date.now(), delivered ? 1 : 0);
    return res.changes === 1;
  }

  warnedToday(guildId, userId) {
    return !!this.db
      .prepare("SELECT 1 FROM staff_absence_warnings WHERE guild_id = ? AND user_id = ? AND day = ?")
      .get(guildId, userId, dayKey());
  }

  recentWarnings(guildId, limit = 15) {
    return this.db
      .prepare("SELECT * FROM staff_absence_warnings WHERE guild_id = ? ORDER BY id DESC LIMIT ?")
      .all(guildId, limit);
  }
}

module.exports = ActivityRepository;
