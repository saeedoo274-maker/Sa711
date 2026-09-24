class TicketsPlusRepository {
  constructor(db) {
    this.db = db;
  }

  _t(row) {
    if (!row) return null;
    let tags;
    try {
      tags = JSON.parse(row.tags || "[]");
    } catch {
      tags = [];
    }
    return { ...row, tags };
  }

  byChannel(channelId) {
    return this._t(this.db.prepare("SELECT * FROM tickets WHERE channel_id = ?").get(channelId));
  }

  byId(id) {
    return this._t(this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id));
  }

  event(ticket, action, actorId = null, data = null) {
    this.db
      .prepare("INSERT INTO ticket_events (ticket_id, guild_id, action, actor_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(ticket.id, ticket.guild_id, action, actorId, data ? JSON.stringify(data) : null, Date.now());
  }

  timeline(ticketId, limit = 20) {
    return this.db.prepare("SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY id DESC LIMIT ?").all(ticketId, limit);
  }

  /** نقل الاستلام ذرّيًا: فقط إن كان المستلم الحالي هو من نتوقعه. */
  transfer(ticketId, fromId, toId) {
    return this.db
      .prepare("UPDATE tickets SET claimed_by = ?, claimed_at = ? WHERE id = ? AND status = 'open' AND COALESCE(claimed_by, '') = COALESCE(?, '')")
      .run(toId, Date.now(), ticketId, fromId).changes === 1;
  }

  setPriority(ticketId, priority, slaDueAt) {
    this.db.prepare("UPDATE tickets SET priority = ?, sla_due_at = COALESCE(?, sla_due_at) WHERE id = ?").run(priority, slaDueAt, ticketId);
  }

  setSla(ticketId, dueAt) {
    this.db.prepare("UPDATE tickets SET sla_due_at = ? WHERE id = ?").run(dueAt, ticketId);
  }

  /** يعلّم خرق SLA مرة واحدة فقط، وفقط إن لم يأتِ أول رد بعد. */
  markBreached(ticketId) {
    return this.db
      .prepare("UPDATE tickets SET sla_breached = 1 WHERE id = ? AND status = 'open' AND first_response_at IS NULL AND sla_breached = 0")
      .run(ticketId).changes === 1;
  }

  setTags(ticketId, tags) {
    this.db.prepare("UPDATE tickets SET tags = ? WHERE id = ?").run(JSON.stringify(tags), ticketId);
  }

  setLocked(ticketId, locked) {
    return this.db.prepare("UPDATE tickets SET locked = ? WHERE id = ? AND locked != ?").run(locked ? 1 : 0, ticketId, locked ? 1 : 0).changes === 1;
  }

  escalate(ticketId, actorId) {
    return this.db
      .prepare("UPDATE tickets SET escalated_at = ?, escalated_by = ?, priority = 'urgent' WHERE id = ? AND status = 'open' AND escalated_at IS NULL")
      .run(Date.now(), actorId, ticketId).changes === 1;
  }

  /** أول رد من الطاقم — ذرّي: يُسجَّل مرة واحدة فقط. */
  firstResponse(ticketId, userId, at = Date.now()) {
    return this.db
      .prepare("UPDATE tickets SET first_response_at = ?, first_responder = ? WHERE id = ? AND first_response_at IS NULL")
      .run(at, userId, ticketId).changes === 1;
  }

  scheduleClose(ticketId, at) {
    this.db.prepare("UPDATE tickets SET close_scheduled_at = ? WHERE id = ?").run(at, ticketId);
  }

  setType(ticketId, typeId) {
    this.db.prepare("UPDATE tickets SET type_id = ? WHERE id = ?").run(typeId, ticketId);
  }

  assign(ticketId, userId, actorId) {
    return this.db
      .prepare("INSERT OR IGNORE INTO ticket_assignees (ticket_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)")
      .run(ticketId, userId, actorId, Date.now()).changes === 1;
  }

  unassign(ticketId, userId) {
    return this.db.prepare("DELETE FROM ticket_assignees WHERE ticket_id = ? AND user_id = ?").run(ticketId, userId).changes > 0;
  }

  assignees(ticketId) {
    return this.db.prepare("SELECT * FROM ticket_assignees WHERE ticket_id = ? ORDER BY assigned_at").all(ticketId).map((r) => r.user_id);
  }

  awaitingResponse() {
    return this.db.prepare("SELECT id, channel_id, guild_id, owner_id FROM tickets WHERE status = 'open' AND first_response_at IS NULL").all();
  }

  /** إحصاءات الطاقم: الاستلام، الإغلاق، متوسط الاستجابة الأولى والإغلاق، خرق SLA، التقييمات. */
  staffStats(guildId, sinceMs, userId = null) {
    const where = userId ? "AND u = ?" : "";
    const params = userId ? [guildId, sinceMs, guildId, sinceMs, guildId, sinceMs, guildId, sinceMs, userId] : [guildId, sinceMs, guildId, sinceMs, guildId, sinceMs, guildId, sinceMs];
    return this.db
      .prepare(
        `WITH
          resp AS (SELECT first_responder AS u, COUNT(*) AS responded, AVG(first_response_at - created_at) AS avgResponse, SUM(sla_breached) AS breaches
                   FROM tickets WHERE guild_id = ? AND created_at >= ? AND first_responder IS NOT NULL GROUP BY first_responder),
          closed AS (SELECT closed_by AS u, COUNT(*) AS closed, AVG(closed_at - created_at) AS avgClose
                     FROM tickets WHERE guild_id = ? AND closed_at >= ? AND closed_by IS NOT NULL GROUP BY closed_by),
          claimed AS (SELECT claimed_by AS u, COUNT(*) AS claimed FROM tickets WHERE guild_id = ? AND created_at >= ? AND claimed_by IS NOT NULL GROUP BY claimed_by),
          rated AS (SELECT staff_id AS u, AVG(stars) AS rating, COUNT(*) AS ratings FROM ticket_ratings WHERE guild_id = ? AND created_at >= ? AND staff_id IS NOT NULL GROUP BY staff_id),
          users AS (SELECT u FROM resp UNION SELECT u FROM closed UNION SELECT u FROM claimed UNION SELECT u FROM rated)
        SELECT users.u AS user_id, COALESCE(claimed.claimed, 0) AS claimed, COALESCE(closed.closed, 0) AS closed,
               COALESCE(resp.responded, 0) AS responded, resp.avgResponse, closed.avgClose, COALESCE(resp.breaches, 0) AS breaches,
               rated.rating, COALESCE(rated.ratings, 0) AS ratings
        FROM users LEFT JOIN resp ON resp.u = users.u LEFT JOIN closed ON closed.u = users.u
             LEFT JOIN claimed ON claimed.u = users.u LEFT JOIN rated ON rated.u = users.u
        WHERE users.u IS NOT NULL ${where}
        ORDER BY closed DESC, claimed DESC LIMIT 25`
      )
      .all(...params);
  }

  overview(guildId, sinceMs) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS opened, COALESCE(SUM(status = 'open'), 0) AS open, AVG(first_response_at - created_at) AS avgResponse,
                AVG(CASE WHEN closed_at IS NOT NULL THEN closed_at - created_at END) AS avgClose,
                COALESCE(SUM(sla_breached), 0) AS breaches, COALESCE(SUM(escalated_at IS NOT NULL), 0) AS escalated
         FROM tickets WHERE guild_id = ? AND created_at >= ?`
      )
      .get(guildId, sinceMs);
  }

  byPriority(guildId) {
    return this.db.prepare("SELECT priority, COUNT(*) AS c FROM tickets WHERE guild_id = ? AND status = 'open' GROUP BY priority").all(guildId);
  }
}

module.exports = TicketsPlusRepository;
