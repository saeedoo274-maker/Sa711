class PollRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const info = this.db
      .prepare(
        `INSERT INTO polls (guild_id, channel_id, message_id, question, options, multiple, anonymous, author_id, ends_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(
        data.guildId,
        data.channelId,
        data.messageId || null,
        data.question,
        JSON.stringify(data.options),
        data.multiple ? 1 : 0,
        data.anonymous === false ? 0 : 1,
        data.authorId,
        data.endsAt || null,
        Date.now()
      );
    return this.getById(info.lastInsertRowid);
  }

  _hydrate(row) {
    if (!row) return null;
    return { ...row, options: JSON.parse(row.options) };
  }

  getById(id) {
    return this._hydrate(this.db.prepare("SELECT * FROM polls WHERE id = ?").get(id));
  }

  getByMessage(messageId) {
    return this._hydrate(this.db.prepare("SELECT * FROM polls WHERE message_id = ?").get(messageId));
  }

  setMessage(id, messageId) {
    this.db.prepare("UPDATE polls SET message_id = ? WHERE id = ?").run(messageId, id);
  }

  /** تصويت أحادي: يُستبدل الاختيار السابق داخل معاملة واحدة. */
  voteSingle(pollId, userId, optionIndex) {
    const apply = this.db.transaction(() => {
      this.db.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?").run(pollId, userId);
      this.db
        .prepare("INSERT INTO poll_votes (poll_id, user_id, option_index, voted_at) VALUES (?, ?, ?, ?)")
        .run(pollId, userId, optionIndex, Date.now());
    });
    apply();
  }

  /** تصويت متعدد: الضغط مرة أخرى يلغي الاختيار. يُرجع true إذا أُضيف. */
  toggleVote(pollId, userId, optionIndex) {
    const existing = this.db
      .prepare("SELECT 1 FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?")
      .get(pollId, userId, optionIndex);
    if (existing) {
      this.db.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?").run(pollId, userId, optionIndex);
      return false;
    }
    this.db
      .prepare("INSERT INTO poll_votes (poll_id, user_id, option_index, voted_at) VALUES (?, ?, ?, ?)")
      .run(pollId, userId, optionIndex, Date.now());
    return true;
  }

  results(pollId) {
    const rows = this.db
      .prepare("SELECT option_index, COUNT(*) AS votes FROM poll_votes WHERE poll_id = ? GROUP BY option_index")
      .all(pollId);
    const map = {};
    for (const r of rows) map[r.option_index] = r.votes;
    return map;
  }

  voters(pollId, optionIndex) {
    return this.db.prepare("SELECT user_id FROM poll_votes WHERE poll_id = ? AND option_index = ?").all(pollId, optionIndex);
  }

  totalVoters(pollId) {
    return this.db.prepare("SELECT COUNT(DISTINCT user_id) AS c FROM poll_votes WHERE poll_id = ?").get(pollId).c;
  }

  close(id) {
    return this.db.prepare("UPDATE polls SET status = 'closed' WHERE id = ? AND status = 'active'").run(id).changes === 1;
  }

  listDue(now = Date.now()) {
    return this.db
      .prepare("SELECT * FROM polls WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ?")
      .all(now)
      .map((r) => this._hydrate(r));
  }
}

module.exports = PollRepository;
