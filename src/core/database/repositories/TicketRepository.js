class TicketRepository {
  constructor(db) {
    this.db = db;

    /** رقم تذكرة متسلسل مستقل لكل سيرفر، داخل معاملة واحدة. */
    this._nextNumber = db.transaction((guildId) => {
      db.prepare("INSERT INTO ticket_counters (guild_id, last_number) VALUES (?, 0) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
      db.prepare("UPDATE ticket_counters SET last_number = last_number + 1 WHERE guild_id = ?").run(guildId);
      return db.prepare("SELECT last_number FROM ticket_counters WHERE guild_id = ?").get(guildId).last_number;
    });
  }

  nextNumber(guildId) {
    return this._nextNumber(guildId);
  }

  create({ guildId, channelId, ownerId, panelId, typeId = null, answers = null, attachmentsAllowed = 0, number = null }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO tickets (guild_id, channel_id, panel_id, type_id, answers, owner_id, status,
                              attachments_allowed, number, last_activity_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`
      )
      .run(
        guildId, channelId, panelId || null, typeId,
        answers ? JSON.stringify(answers) : null,
        ownerId, attachmentsAllowed ? 1 : 0, number, now, now
      );
    return this.getByChannel(channelId);
  }

  /** يُحدَّث مع كل رسالة داخل التذكرة، ويُصفّر تحذير الخمول. */
  touch(channelId) {
    this.db
      .prepare("UPDATE tickets SET last_activity_at = ?, warned_at = NULL WHERE channel_id = ? AND status = 'open'")
      .run(Date.now(), channelId);
  }

  markWarned(channelId) {
    return this.db
      .prepare("UPDATE tickets SET warned_at = ? WHERE channel_id = ? AND status = 'open' AND warned_at IS NULL")
      .run(Date.now(), channelId).changes === 1;
  }

  /** التذاكر المفتوحة الخاملة منذ مدة، لم تُنبَّه بعد. */
  idleUnwarned(idleMs) {
    return this.db
      .prepare(
        `SELECT * FROM tickets WHERE status = 'open' AND warned_at IS NULL
         AND COALESCE(last_activity_at, created_at) <= ?`
      )
      .all(Date.now() - idleMs);
  }

  /** التذاكر التي نُبّهت ولم تعد للنشاط خلال المهلة. */
  idleWarned(graceMs) {
    return this.db
      .prepare("SELECT * FROM tickets WHERE status = 'open' AND warned_at IS NOT NULL AND warned_at <= ?")
      .all(Date.now() - graceMs);
  }

  /** عدد التذاكر المستلمة حاليًا من موظف — لتطبيق حد الاستلام المتزامن. */
  activeClaims(guildId, staffId) {
    return this.db
      .prepare("SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND claimed_by = ? AND status = 'open'")
      .get(guildId, staffId).c;
  }

  // ---------------- التقييمات ----------------

  /** تقييم واحد لكل عضو لكل تذكرة — المفتاح الفريد يمنع التكرار. */
  addRating({ guildId, ticketId, ticketNumber, userId, staffId, stars, note }) {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO ticket_ratings
           (guild_id, ticket_id, ticket_number, user_id, staff_id, stars, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(guildId, ticketId || null, ticketNumber || null, userId, staffId || null, stars, note || null, Date.now());
    return res.changes === 1;
  }

  updateRatingNote(guildId, ticketId, userId, note) {
    return this.db
      .prepare("UPDATE ticket_ratings SET note = ? WHERE guild_id = ? AND ticket_id = ? AND user_id = ?")
      .run(note, guildId, ticketId, userId).changes === 1;
  }

  hasRated(guildId, ticketId, userId) {
    return !!this.db
      .prepare("SELECT 1 FROM ticket_ratings WHERE guild_id = ? AND ticket_id = ? AND user_id = ?")
      .get(guildId, ticketId, userId);
  }

  staffRating(guildId, staffId) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(AVG(stars), 0) AS average,
           COALESCE(SUM(CASE WHEN stars = 5 THEN 1 ELSE 0 END), 0) AS five,
           COALESCE(SUM(CASE WHEN stars <= 2 THEN 1 ELSE 0 END), 0) AS low
         FROM ticket_ratings WHERE guild_id = ? AND staff_id = ?`
      )
      .get(guildId, staffId);
  }

  ratingLeaderboard(guildId, limit = 10, minRatings = 3) {
    return this.db
      .prepare(
        `SELECT staff_id, COUNT(*) AS count, AVG(stars) AS average
         FROM ticket_ratings WHERE guild_id = ? AND staff_id IS NOT NULL
         GROUP BY staff_id HAVING COUNT(*) >= ?
         ORDER BY average DESC, count DESC LIMIT ?`
      )
      .all(guildId, minRatings, limit);
  }

  guildRatingStats(guildId) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(AVG(stars), 0) AS average
         FROM ticket_ratings WHERE guild_id = ?`
      )
      .get(guildId);
  }

  getByChannel(channelId) {
    return this.db.prepare("SELECT * FROM tickets WHERE channel_id = ?").get(channelId) || null;
  }

  /**
   * استلام التذكرة — عملية ذرية.
   * الشرط `claimed_by IS NULL` داخل جملة UPDATE نفسها يضمن أن إداريًا واحدًا فقط
   * ينجح حتى لو ضغط عشرة أشخاص في نفس الجزء من الثانية. لا حاجة لقفل خارجي.
   * @returns {boolean} true إذا نجح هذا المستدعي بالذات في الاستلام
   */
  claim(channelId, userId) {
    const res = this.db
      .prepare(
        `UPDATE tickets SET claimed_by = ?, claimed_at = ?
         WHERE channel_id = ? AND status = 'open' AND claimed_by IS NULL`
      )
      .run(userId, Date.now(), channelId);
    return res.changes === 1;
  }

  /** إلغاء الاستلام — ينجح فقط إذا كان المستدعي هو المستلم الحالي. */
  unclaim(channelId, userId, force = false) {
    const sql = force
      ? "UPDATE tickets SET claimed_by = NULL, claimed_at = NULL WHERE channel_id = ? AND claimed_by IS NOT NULL"
      : "UPDATE tickets SET claimed_by = NULL, claimed_at = NULL WHERE channel_id = ? AND claimed_by = ?";
    const res = force
      ? this.db.prepare(sql).run(channelId)
      : this.db.prepare(sql).run(channelId, userId);
    return res.changes === 1;
  }

  /** الإغلاق ذرّي أيضًا: لا يمكن إغلاق تذكرة مغلقة مرتين. */
  close(channelId, userId) {
    const res = this.db
      .prepare("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE channel_id = ? AND status = 'open'")
      .run(Date.now(), userId, channelId);
    return res.changes === 1;
  }

  reopen(channelId) {
    const res = this.db
      .prepare("UPDATE tickets SET status = 'open', closed_at = NULL, closed_by = NULL WHERE channel_id = ? AND status = 'closed'")
      .run(channelId);
    return res.changes === 1;
  }

  setAttachments(channelId, allowed) {
    this.db.prepare("UPDATE tickets SET attachments_allowed = ? WHERE channel_id = ?").run(allowed ? 1 : 0, channelId);
  }

  delete(channelId) {
    const ticket = this.getByChannel(channelId);
    if (!ticket) return false;
    const wipe = this.db.transaction(() => {
      this.db.prepare("DELETE FROM ticket_members WHERE ticket_id = ?").run(ticket.id);
      this.db.prepare("DELETE FROM tickets WHERE id = ?").run(ticket.id);
    });
    wipe();
    return true;
  }

  addMember(ticketId, userId, addedBy) {
    this.db
      .prepare("INSERT OR IGNORE INTO ticket_members (ticket_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)")
      .run(ticketId, userId, addedBy, Date.now());
  }

  removeMember(ticketId, userId) {
    const res = this.db.prepare("DELETE FROM ticket_members WHERE ticket_id = ? AND user_id = ?").run(ticketId, userId);
    return res.changes === 1;
  }

  members(ticketId) {
    return this.db.prepare("SELECT * FROM ticket_members WHERE ticket_id = ?").all(ticketId);
  }

  openCountForUser(guildId, userId) {
    return this.db
      .prepare("SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND owner_id = ? AND status = 'open'")
      .get(guildId, userId).c;
  }

  stats(guildId) {
    return {
      open: this.db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND status = 'open'").get(guildId).c,
      closed: this.db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND status = 'closed'").get(guildId).c
    };
  }

  // ---- لوحات التذاكر ----
  savePanel({ id, guildId, channelId, messageId, config }) {
    this.db
      .prepare(
        `INSERT INTO ticket_panels (id, guild_id, channel_id, message_id, config, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id,
           message_id = excluded.message_id, config = excluded.config`
      )
      .run(id, guildId, channelId || null, messageId || null, JSON.stringify(config || {}), Date.now());
  }

  getPanel(id) {
    const row = this.db.prepare("SELECT * FROM ticket_panels WHERE id = ?").get(id);
    if (!row) return null;
    return { ...row, config: JSON.parse(row.config || "{}") };
  }

  listPanels(guildId) {
    return this.db
      .prepare("SELECT * FROM ticket_panels WHERE guild_id = ?")
      .all(guildId)
      .map((r) => ({ ...r, config: JSON.parse(r.config || "{}") }));
  }

  deletePanel(id) {
    return this.db.prepare("DELETE FROM ticket_panels WHERE id = ?").run(id).changes === 1;
  }
}

module.exports = TicketRepository;
