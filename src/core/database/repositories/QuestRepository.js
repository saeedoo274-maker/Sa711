/**
 * مهام الإدارة: التعريف، النشر كدورات، الاستلام، والإنجاز.
 *
 * نقطة الحماية الأهم: `claim` يفحص السعة ويُدرج داخل معاملة واحدة،
 * فلو ضغط عشرة على مهمة سعتها ثلاثة لا يستلمها إلا ثلاثة بالضبط.
 */
class QuestRepository {
  constructor(db) {
    this.db = db;

    this._claim = db.transaction(({ cycleId, questId, guildId, userId, baseline, deadlineAt, maxClaims }) => {
      const cycle = db.prepare("SELECT * FROM quest_cycles WHERE id = ?").get(cycleId);
      if (!cycle) return { ok: false, reason: "noCycle" };
      if (cycle.closed_at) return { ok: false, reason: "closed" };

      const mine = db
        .prepare("SELECT * FROM quest_claims WHERE cycle_id = ? AND user_id = ?")
        .get(cycleId, userId);
      if (mine) return { ok: false, reason: mine.status === "completed" ? "alreadyDone" : "alreadyClaimed", claim: mine };

      // السعة تُحسب على المستلمين والمنجزين معًا: الخانة تبقى محجوزة بعد الإنجاز
      if (maxClaims > 0) {
        const taken = db
          .prepare("SELECT COUNT(*) AS c FROM quest_claims WHERE cycle_id = ? AND status IN ('claimed','completed')")
          .get(cycleId).c;
        if (taken >= maxClaims) return { ok: false, reason: "full", taken };
      }

      const info = db
        .prepare(
          `INSERT INTO quest_claims (guild_id, cycle_id, quest_id, user_id, baseline, claimed_at, deadline_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(guildId, cycleId, questId, userId, baseline, Date.now(), deadlineAt || null);

      return { ok: true, claim: db.prepare("SELECT * FROM quest_claims WHERE id = ?").get(info.lastInsertRowid) };
    });
  }

  // ---------------- تعريف المهام ----------------

  create(d) {
    this.db
      .prepare(
        `INSERT INTO quests (guild_id, key, title, description, kind, verify_type, verify_target,
           max_claims, reward_points, reward_money, difficulty, emoji, timeout_ms, created_by, created_at)
         VALUES (@guildId, @key, @title, @description, @kind, @verifyType, @verifyTarget,
           @maxClaims, @rewardPoints, @rewardMoney, @difficulty, @emoji, @timeoutMs, @createdBy, @createdAt)`
      )
      .run({
        guildId: d.guildId, key: d.key, title: d.title, description: d.description || null,
        kind: d.kind || "daily", verifyType: d.verifyType || "manual", verifyTarget: d.verifyTarget ?? 1,
        maxClaims: d.maxClaims ?? 1, rewardPoints: d.rewardPoints ?? 0, rewardMoney: d.rewardMoney ?? 0,
        difficulty: d.difficulty || "normal", emoji: d.emoji || null, timeoutMs: d.timeoutMs ?? null,
        createdBy: d.createdBy || null, createdAt: Date.now()
      });
    return this.get(d.guildId, d.key);
  }

  get(guildId, key) {
    return this.db.prepare("SELECT * FROM quests WHERE guild_id = ? AND key = ?").get(guildId, key) || null;
  }

  getById(id) {
    return this.db.prepare("SELECT * FROM quests WHERE id = ?").get(id) || null;
  }

  list(guildId, { kind = null, enabledOnly = true } = {}) {
    let sql = "SELECT * FROM quests WHERE guild_id = ?";
    const args = [guildId];
    if (kind) { sql += " AND kind = ?"; args.push(kind); }
    if (enabledOnly) sql += " AND enabled = 1";
    return this.db.prepare(sql + " ORDER BY kind ASC, id ASC").all(...args);
  }

  /** تعديل حقل واحد. أسماء الأعمدة على قائمة بيضاء صارمة. */
  update(guildId, key, field, value) {
    const allowed = {
      title: "title", description: "description", kind: "kind",
      verify_type: "verify_type", verify_target: "verify_target",
      max_claims: "max_claims", reward_points: "reward_points", reward_money: "reward_money",
      difficulty: "difficulty", emoji: "emoji", timeout_ms: "timeout_ms", enabled: "enabled"
    };
    const col = allowed[field];
    if (!col) throw new Error(`حقل غير مسموح: ${field}`);
    this.db.prepare(`UPDATE quests SET ${col} = ? WHERE guild_id = ? AND key = ?`).run(value, guildId, key);
    return this.get(guildId, key);
  }

  remove(guildId, key) {
    return this.db.prepare("DELETE FROM quests WHERE guild_id = ? AND key = ?").run(guildId, key).changes === 1;
  }

  // ---------------- دورات النشر ----------------

  openCycle({ guildId, questId, channelId, messageId, closesAt }) {
    const info = this.db
      .prepare(
        `INSERT INTO quest_cycles (guild_id, quest_id, channel_id, message_id, opened_at, closes_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(guildId, questId, channelId || null, messageId || null, Date.now(), closesAt || null);
    return this.getCycle(info.lastInsertRowid);
  }

  getCycle(id) {
    return this.db.prepare("SELECT * FROM quest_cycles WHERE id = ?").get(id) || null;
  }

  cycleByMessage(messageId) {
    return this.db.prepare("SELECT * FROM quest_cycles WHERE message_id = ?").get(messageId) || null;
  }

  setCycleMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE quest_cycles SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  /** آخر دورة مفتوحة لمهمة. */
  openCycleFor(guildId, questId) {
    return this.db
      .prepare("SELECT * FROM quest_cycles WHERE guild_id = ? AND quest_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(guildId, questId) || null;
  }

  closeCycle(id) {
    return this.db
      .prepare("UPDATE quest_cycles SET closed_at = ? WHERE id = ? AND closed_at IS NULL")
      .run(Date.now(), id).changes === 1;
  }

  /** الدورات التي انتهى وقتها ولم تُغلق بعد. */
  dueCycles(now = Date.now()) {
    return this.db
      .prepare("SELECT * FROM quest_cycles WHERE closed_at IS NULL AND closes_at IS NOT NULL AND closes_at <= ?")
      .all(now);
  }

  // ---------------- الاستلام ----------------

  claim(args) { return this._claim(args); }

  getClaim(cycleId, userId) {
    return this.db.prepare("SELECT * FROM quest_claims WHERE cycle_id = ? AND user_id = ?").get(cycleId, userId) || null;
  }

  claimsFor(cycleId) {
    return this.db.prepare("SELECT * FROM quest_claims WHERE cycle_id = ? ORDER BY claimed_at ASC").all(cycleId);
  }

  /** عدد الخانات المشغولة (مستلمة أو منجزة). */
  takenSlots(cycleId) {
    return this.db
      .prepare("SELECT COUNT(*) AS c FROM quest_claims WHERE cycle_id = ? AND status IN ('claimed','completed')")
      .get(cycleId).c;
  }

  setProgress(claimId, progress) {
    this.db.prepare("UPDATE quest_claims SET progress = ? WHERE id = ?").run(progress, claimId);
  }

  /** يتخلّى عن المهمة فتعود الخانة متاحة. */
  abandon(claimId, userId) {
    return this.db
      .prepare("UPDATE quest_claims SET status = 'abandoned' WHERE id = ? AND user_id = ? AND status = 'claimed'")
      .run(claimId, userId).changes === 1;
  }

  /** الاستلامات التي تجاوزت مهلتها ولم تكتمل. */
  expiredClaims(now = Date.now()) {
    return this.db
      .prepare("SELECT * FROM quest_claims WHERE status = 'claimed' AND deadline_at IS NOT NULL AND deadline_at <= ?")
      .all(now);
  }

  expire(claimId) {
    return this.db
      .prepare("UPDATE quest_claims SET status = 'expired' WHERE id = ? AND status = 'claimed'")
      .run(claimId).changes === 1;
  }

  /**
   * الإنجاز ذرّي: ينجح مرة واحدة فقط ويُسجّل في سجل الإنجاز بنفس المعاملة،
   * فلا يمكن أن تُصرف المكافأة مرتين بضغطتين متزامنتين.
   */
  complete({ claimId, progress, verifiedBy, note }) {
    const apply = this.db.transaction(() => {
      const res = this.db
        .prepare(
          `UPDATE quest_claims SET status = 'completed', completed_at = ?, progress = ?, verified_by = ?, note = ?
           WHERE id = ? AND status = 'claimed'`
        )
        .run(Date.now(), progress ?? 0, verifiedBy || null, note || null, claimId);
      if (res.changes !== 1) return { ok: false };

      const claim = this.db.prepare("SELECT * FROM quest_claims WHERE id = ?").get(claimId);
      const quest = this.db.prepare("SELECT * FROM quests WHERE id = ?").get(claim.quest_id);

      this.db
        .prepare(
          `INSERT INTO quest_completions (guild_id, quest_id, user_id, points, money, verify_type, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(claim.guild_id, claim.quest_id, claim.user_id,
             quest?.reward_points || 0, quest?.reward_money || 0, quest?.verify_type || null, Date.now());

      return { ok: true, claim, quest };
    });
    return apply();
  }

  // ---------------- الإحصاءات ----------------

  userStats(guildId, userId, days = 30) {
    const since = Date.now() - days * 86_400_000;
    return this.db
      .prepare(
        `SELECT COUNT(*) AS completed, COALESCE(SUM(points),0) AS points, COALESCE(SUM(money),0) AS money
         FROM quest_completions WHERE guild_id = ? AND user_id = ? AND completed_at >= ?`
      )
      .get(guildId, userId, since);
  }

  leaderboard(guildId, days = 30, limit = 10) {
    const since = Date.now() - days * 86_400_000;
    return this.db
      .prepare(
        `SELECT user_id, COUNT(*) AS completed, COALESCE(SUM(points),0) AS points
         FROM quest_completions WHERE guild_id = ? AND completed_at >= ?
         GROUP BY user_id ORDER BY points DESC, completed DESC LIMIT ?`
      )
      .all(guildId, since, limit);
  }

  /** المهام المستلمة حاليًا لعضو. */
  activeClaims(guildId, userId) {
    return this.db
      .prepare(
        `SELECT c.*, q.title, q.key, q.verify_type, q.verify_target, q.emoji
         FROM quest_claims c JOIN quests q ON q.id = c.quest_id
         WHERE c.guild_id = ? AND c.user_id = ? AND c.status = 'claimed'
         ORDER BY c.claimed_at ASC`
      )
      .all(guildId, userId);
  }

  guildStats(guildId, days = 30) {
    const since = Date.now() - days * 86_400_000;
    return this.db
      .prepare(
        `SELECT COUNT(*) AS completions, COUNT(DISTINCT user_id) AS participants,
                COALESCE(SUM(points),0) AS points
         FROM quest_completions WHERE guild_id = ? AND completed_at >= ?`
      )
      .get(guildId, since);
  }
}

module.exports = QuestRepository;
