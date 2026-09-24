const parse = (v) => {
  try {
    const x = JSON.parse(v || "[]");
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
};

class StarboardPlusRepository {
  constructor(db) {
    this.db = db;
  }

  _board(row) {
    return row ? { ...row, ignored_channels: parse(row.ignored_channels), ignored_roles: parse(row.ignored_roles) } : null;
  }

  boards(guildId) {
    return this.db.prepare("SELECT * FROM starboard_boards WHERE guild_id = ? ORDER BY id").all(guildId).map((r) => this._board(r));
  }

  board(guildId, name) {
    return this._board(this.db.prepare("SELECT * FROM starboard_boards WHERE guild_id = ? AND name = ?").get(guildId, name));
  }

  createBoard({ guildId, name, channelId, emoji, threshold, selfStar, allowBots }) {
    const info = this.db
      .prepare("INSERT OR IGNORE INTO starboard_boards (guild_id, name, channel_id, emoji, threshold, self_star, allow_bots, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(guildId, name, channelId, emoji || "⭐", threshold || 3, selfStar ? 1 : 0, allowBots ? 1 : 0, Date.now());
    return info.changes === 1 ? this.board(guildId, name) : null;
  }

  updateBoard(id, fields) {
    const allowed = ["channel_id", "emoji", "threshold", "self_star", "allow_bots", "ignored_channels", "ignored_roles", "enabled"];
    const cols = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!cols.length) return;
    const values = Object.fromEntries(cols.map((c) => [c, Array.isArray(fields[c]) ? JSON.stringify(fields[c]) : fields[c]]));
    this.db.prepare(`UPDATE starboard_boards SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id`).run({ ...values, id });
  }

  deleteBoard(guildId, name) {
    const board = this.board(guildId, name);
    if (!board) return false;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM starboard_votes WHERE board_id = ?").run(board.id);
      this.db.prepare("DELETE FROM starboard_board_entries WHERE board_id = ?").run(board.id);
      this.db.prepare("DELETE FROM starboard_boards WHERE id = ?").run(board.id);
    })();
    return true;
  }

  countBoards(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM starboard_boards WHERE guild_id = ?").get(guildId).c;
  }

  // ---------- الأصوات ----------

  addVote(boardId, messageId, userId) {
    return this.db.prepare("INSERT OR IGNORE INTO starboard_votes (board_id, message_id, user_id, created_at) VALUES (?, ?, ?, ?)").run(boardId, messageId, userId, Date.now()).changes === 1;
  }

  removeVote(boardId, messageId, userId) {
    return this.db.prepare("DELETE FROM starboard_votes WHERE board_id = ? AND message_id = ? AND user_id = ?").run(boardId, messageId, userId).changes === 1;
  }

  votes(boardId, messageId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM starboard_votes WHERE board_id = ? AND message_id = ?").get(boardId, messageId).c;
  }

  hasAnyVote(boardId, messageId) {
    return !!this.db.prepare("SELECT 1 FROM starboard_votes WHERE board_id = ? AND message_id = ? LIMIT 1").get(boardId, messageId);
  }

  // ---------- المدخلات ----------

  entry(boardId, messageId) {
    return this.db.prepare("SELECT * FROM starboard_board_entries WHERE board_id = ? AND source_message_id = ?").get(boardId, messageId) || null;
  }

  upsertEntry({ boardId, guildId, messageId, channelId, authorId, stars, boardMessageId }) {
    this.db
      .prepare(
        `INSERT INTO starboard_board_entries (board_id, guild_id, source_message_id, source_channel_id, board_message_id, author_id, stars, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(board_id, source_message_id) DO UPDATE SET stars = excluded.stars,
           board_message_id = COALESCE(excluded.board_message_id, starboard_board_entries.board_message_id)`
      )
      .run(boardId, guildId, messageId, channelId, boardMessageId || null, authorId || null, stars, Date.now());
  }

  removeEntry(boardId, messageId) {
    this.db.prepare("DELETE FROM starboard_board_entries WHERE board_id = ? AND source_message_id = ?").run(boardId, messageId);
  }

  top(boardId, limit = 10) {
    return this.db.prepare("SELECT * FROM starboard_board_entries WHERE board_id = ? AND board_message_id IS NOT NULL ORDER BY stars DESC LIMIT ?").all(boardId, limit);
  }

  /** مجموع النجوم التي حصل عليها كل كاتب عبر كل اللوحات (الأصلية والإضافية). */
  authors(guildId, sinceMs = 0, limit = 10) {
    return this.db
      .prepare(
        `SELECT author_id AS user_id, SUM(stars) AS score, COUNT(*) AS posts FROM (
           SELECT author_id, stars, created_at FROM starboard_entries WHERE guild_id = ? AND board_message_id IS NOT NULL
           UNION ALL
           SELECT author_id, stars, created_at FROM starboard_board_entries WHERE guild_id = ? AND board_message_id IS NOT NULL
         ) WHERE author_id IS NOT NULL AND created_at >= ? GROUP BY author_id ORDER BY score DESC LIMIT ?`
      )
      .all(guildId, guildId, sinceMs, limit);
  }
}

module.exports = StarboardPlusRepository;
