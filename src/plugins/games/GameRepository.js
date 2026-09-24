class GameRepository {
  constructor(db, economy) {
    this.db = db;
    this.economy = economy;
  }

  _session(row) {
    if (!row) return null;
    return { ...row, players: JSON.parse(row.players || "[]"), state: JSON.parse(row.state || "{}") };
  }

  /** يفتح جلسة ويحجز رهان صاحبها في نفس المعاملة. */
  openSession({ guildId, channelId, hostId, game, bet, state = {}, expiresAt }) {
    const tx = this.db.transaction(() => {
      if (bet > 0) {
        const res = this.economy.adjustWallet({ guildId, userId: hostId, delta: -bet, type: "game_bet", reason: game, refType: "game" });
        if (!res.ok) return { ok: false, reason: res.reason };
      }
      const info = this.db
        .prepare("INSERT INTO game_sessions (guild_id, channel_id, host_id, game, bet, players, state, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(guildId, channelId, hostId, game, bet, JSON.stringify([hostId]), JSON.stringify(state), expiresAt, Date.now());
      return { ok: true, session: this.get(info.lastInsertRowid) };
    });
    return tx();
  }

  get(id) {
    return this._session(this.db.prepare("SELECT * FROM game_sessions WHERE id = ?").get(id));
  }

  activeFor(guildId, userId) {
    return this.db
      .prepare("SELECT id, game FROM game_sessions WHERE guild_id = ? AND status = 'active' AND players LIKE ? LIMIT 1")
      .get(guildId, `%"${userId}"%`) || null;
  }

  saveState(id, state) {
    this.db.prepare("UPDATE game_sessions SET state = ? WHERE id = ? AND status = 'active'").run(JSON.stringify(state), id);
  }

  /** انضمام لاعب لجولة جماعية مع حجز رهانه — مرة واحدة لكل لاعب. */
  join(id, userId) {
    const tx = this.db.transaction(() => {
      const s = this.get(id);
      if (!s || s.status !== "active") return { ok: false, reason: "closed" };
      if (s.players.includes(userId)) return { ok: false, reason: "alreadyJoined" };
      if (s.state.startedAt) return { ok: false, reason: "started" };
      if (s.bet > 0) {
        const res = this.economy.adjustWallet({ guildId: s.guild_id, userId, delta: -s.bet, type: "game_bet", reason: s.game, refType: "game", refId: id });
        if (!res.ok) return { ok: false, reason: res.reason };
      }
      const players = [...s.players, userId];
      this.db.prepare("UPDATE game_sessions SET players = ? WHERE id = ? AND status = 'active'").run(JSON.stringify(players), id);
      return { ok: true, players };
    });
    return tx();
  }

  /**
   * إنهاء الجلسة ودفع النتائج — ذرّيًا ومرة واحدة فقط (`WHERE status = 'active'`).
   * results: [{ userId, payout, outcome: 'won'|'lost'|'draw' }]
   */
  finish(id, results, status = "finished") {
    const tx = this.db.transaction(() => {
      const s = this.get(id);
      if (!s) return { ok: false, reason: "notFound" };
      const res = this.db.prepare("UPDATE game_sessions SET status = ?, finished_at = ? WHERE id = ? AND status = 'active'").run(status, Date.now(), id);
      if (res.changes !== 1) return { ok: false, reason: "closed" };
      for (const r of results) {
        if (r.payout > 0) {
          this.economy.adjustWallet({ guildId: s.guild_id, userId: r.userId, delta: r.payout, type: status === "refunded" ? "game_refund" : "game_win", reason: s.game, refType: "game", refId: id });
        }
        if (status === "finished") this.recordStat(s.guild_id, r.userId, s.game, { bet: s.bet, payout: r.payout, outcome: r.outcome });
      }
      return { ok: true, session: s };
    });
    return tx();
  }

  recordStat(guildId, userId, game, { bet, payout, outcome }) {
    const profit = payout - bet;
    this.db
      .prepare(
        `INSERT INTO game_stats (guild_id, user_id, game, played, won, lost, draw, wagered, profit, best_win)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id, game) DO UPDATE SET played = played + 1, won = won + excluded.won, lost = lost + excluded.lost,
           draw = draw + excluded.draw, wagered = wagered + excluded.wagered, profit = profit + excluded.profit,
           best_win = MAX(best_win, excluded.best_win)`
      )
      .run(guildId, userId, game, outcome === "won" ? 1 : 0, outcome === "lost" ? 1 : 0, outcome === "draw" ? 1 : 0, bet, profit, Math.max(0, profit));
  }

  /** جلسات عالقة (توقف البوت أو انتهت المهلة): يُعاد رهان كل لاعب. */
  staleSessions(now = Date.now(), { includeUnexpired = false } = {}) {
    return this.db
      .prepare(`SELECT * FROM game_sessions WHERE status = 'active' ${includeUnexpired ? "" : "AND expires_at <= ?"}`)
      .all(...(includeUnexpired ? [] : [now]))
      .map((r) => this._session(r));
  }

  stats(guildId, userId) {
    return this.db.prepare("SELECT * FROM game_stats WHERE guild_id = ? AND user_id = ? ORDER BY played DESC").all(guildId, userId);
  }

  leaderboard(guildId, { game = null, by = "profit", limit = 10 } = {}) {
    const col = { profit: "SUM(profit)", won: "SUM(won)", played: "SUM(played)" }[by] || "SUM(profit)";
    const where = game ? "AND game = ?" : "";
    const params = game ? [guildId, game, limit] : [guildId, limit];
    return this.db
      .prepare(`SELECT user_id, ${col} AS score, SUM(played) AS played, SUM(won) AS won FROM game_stats WHERE guild_id = ? ${where} GROUP BY user_id ORDER BY score DESC LIMIT ?`)
      .all(...params);
  }
}

module.exports = GameRepository;
