const STATUSES = ["pending", "review", "accepted", "rejected"];

class SuggestionRepository {
  constructor(db) {
    this.db = db;

    this._create = db.transaction(({ guildId, authorId, content, anonymous }) => {
      db.prepare("INSERT INTO suggestion_counters (guild_id, last_number) VALUES (?, 0) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
      db.prepare("UPDATE suggestion_counters SET last_number = last_number + 1 WHERE guild_id = ?").run(guildId);
      const number = db.prepare("SELECT last_number FROM suggestion_counters WHERE guild_id = ?").get(guildId).last_number;
      const now = Date.now();
      const info = db
        .prepare("INSERT INTO suggestions (guild_id, number, author_id, content, anonymous, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(guildId, number, authorId, content, anonymous ? 1 : 0, now, now);
      db.prepare("INSERT INTO suggestion_history (suggestion_id, status, staff_id, created_at) VALUES (?, 'pending', NULL, ?)").run(info.lastInsertRowid, now);
      return this.get(info.lastInsertRowid);
    });

    /**
     * التصويت: نفس الصوت مرة ثانية يسحبه، والصوت المعاكس يغيّره (إن سُمح).
     * العدّادات تُعاد حسابها داخل نفس المعاملة فلا تنحرف أبدًا.
     */
    this._vote = db.transaction(({ suggestionId, userId, vote, allowChange }) => {
      const s = this.get(suggestionId);
      if (!s) return { ok: false, reason: "notFound" };
      if (s.status === "accepted" || s.status === "rejected") return { ok: false, reason: "closed" };
      const existing = db.prepare("SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?").get(suggestionId, userId);
      let action;
      if (!existing) {
        db.prepare("INSERT INTO suggestion_votes (suggestion_id, user_id, vote, voted_at) VALUES (?, ?, ?, ?)").run(suggestionId, userId, vote, Date.now());
        action = "added";
      } else if (existing.vote === vote) {
        db.prepare("DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?").run(suggestionId, userId);
        action = "removed";
      } else {
        if (!allowChange) return { ok: false, reason: "noChange" };
        db.prepare("UPDATE suggestion_votes SET vote = ?, voted_at = ? WHERE suggestion_id = ? AND user_id = ?").run(vote, Date.now(), suggestionId, userId);
        action = "changed";
      }
      const counts = db
        .prepare("SELECT COALESCE(SUM(vote = 1), 0) AS up, COALESCE(SUM(vote = -1), 0) AS down FROM suggestion_votes WHERE suggestion_id = ?")
        .get(suggestionId);
      db.prepare("UPDATE suggestions SET upvotes = ?, downvotes = ?, updated_at = ? WHERE id = ?").run(counts.up, counts.down, Date.now(), suggestionId);
      return { ok: true, action, up: counts.up, down: counts.down };
    });
  }

  static get STATUSES() {
    return STATUSES;
  }

  create(args) { return this._create(args); }
  vote(args) { return this._vote(args); }

  get(id) {
    return this.db.prepare("SELECT * FROM suggestions WHERE id = ?").get(id) || null;
  }

  byNumber(guildId, number) {
    return this.db.prepare("SELECT * FROM suggestions WHERE guild_id = ? AND number = ?").get(guildId, number) || null;
  }

  setMessage(id, { channelId, messageId, threadId = null }) {
    this.db.prepare("UPDATE suggestions SET channel_id = ?, message_id = ?, thread_id = COALESCE(?, thread_id), updated_at = ? WHERE id = ?")
      .run(channelId, messageId, threadId, Date.now(), id);
  }

  /** تغيير الحالة ذرّيًا — القرار النهائي لا يُتخذ مرتين. */
  setStatus(id, { status, staffId, reason }) {
    if (!STATUSES.includes(status)) return { ok: false, reason: "invalidStatus" };
    const tx = this.db.transaction(() => {
      const s = this.get(id);
      if (!s) return { ok: false, reason: "notFound" };
      if (s.status === status) return { ok: false, reason: "same" };
      const final = status === "accepted" || status === "rejected";
      this.db
        .prepare("UPDATE suggestions SET status = ?, staff_id = ?, response = ?, decided_at = CASE WHEN ? THEN ? ELSE decided_at END, updated_at = ? WHERE id = ?")
        .run(status, staffId, reason || null, final ? 1 : 0, Date.now(), Date.now(), id);
      this.db.prepare("INSERT INTO suggestion_history (suggestion_id, status, staff_id, reason, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, status, staffId, reason || null, Date.now());
      return { ok: true, previous: s.status, suggestion: this.get(id) };
    });
    return tx();
  }

  markArchived(id, { channelId, messageId }) {
    this.db.prepare("UPDATE suggestions SET archived = 1, channel_id = ?, message_id = ?, thread_id = NULL, updated_at = ? WHERE id = ?")
      .run(channelId, messageId, Date.now(), id);
  }

  delete(id) {
    return this.db.prepare("DELETE FROM suggestions WHERE id = ?").run(id).changes > 0;
  }

  lastByAuthor(guildId, authorId) {
    return this.db.prepare("SELECT created_at FROM suggestions WHERE guild_id = ? AND author_id = ? ORDER BY id DESC LIMIT 1").get(guildId, authorId) || null;
  }

  history(id) {
    return this.db.prepare("SELECT * FROM suggestion_history WHERE suggestion_id = ? ORDER BY id ASC").all(id);
  }

  voteOf(id, userId) {
    return this.db.prepare("SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?").get(id, userId)?.vote || 0;
  }

  top(guildId, { status = null, limit = 10 } = {}) {
    const where = status ? "AND status = ?" : "";
    const params = status ? [guildId, status, limit] : [guildId, limit];
    return this.db
      .prepare(`SELECT *, (upvotes - downvotes) AS score FROM suggestions WHERE guild_id = ? ${where} ORDER BY score DESC, upvotes DESC LIMIT ?`)
      .all(...params);
  }

  list(guildId, { status = null, authorId = null, limit = 10, offset = 0 } = {}) {
    const where = ["guild_id = ?"];
    const params = [guildId];
    if (status) { where.push("status = ?"); params.push(status); }
    if (authorId) { where.push("author_id = ?"); params.push(authorId); }
    return this.db.prepare(`SELECT * FROM suggestions WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  }

  stats(guildId, sinceMs = 0) {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS c, COALESCE(SUM(upvotes), 0) AS up, COALESCE(SUM(downvotes), 0) AS down FROM suggestions WHERE guild_id = ? AND created_at >= ? GROUP BY status")
      .all(guildId, sinceMs);
    const out = { total: 0, pending: 0, review: 0, accepted: 0, rejected: 0, votes: 0 };
    for (const r of rows) {
      out[r.status] = r.c;
      out.total += r.c;
      out.votes += r.up + r.down;
    }
    return out;
  }

  countSince(guildId, sinceMs) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM suggestions WHERE guild_id = ? AND created_at >= ?").get(guildId, sinceMs).c;
  }
}

module.exports = SuggestionRepository;
