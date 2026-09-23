/**
 * الأنظمة الحكومية: مجلس الشورى، التعميمات الإدارية، والتقاعد.
 *
 * مجلس الشورى يختلف عن `/انتخابات`: هناك تختار بين مرشحين، وهنا تصوّت
 * بموافقة أو رفض على **مشروع قرار** مقترح، ثم تُتخذ نتيجة رسمية.
 */
class GovernmentRepository {
  constructor(db) {
    this.db = db;

    this._nextNumber = db.transaction((table, guildId) => {
      const counters = { shura: "shura_counters", circular: "circular_counters", retirement: "retirement_counters" };
      const t = counters[table];
      if (!t) throw new Error(`جدول عدّاد غير مسموح: ${table}`);
      db.prepare(`INSERT INTO ${t} (guild_id, last_number) VALUES (?, 0) ON CONFLICT(guild_id) DO NOTHING`).run(guildId);
      db.prepare(`UPDATE ${t} SET last_number = last_number + 1 WHERE guild_id = ?`).run(guildId);
      return db.prepare(`SELECT last_number FROM ${t} WHERE guild_id = ?`).get(guildId).last_number;
    });
  }

  // ---------------- مجلس الشورى ----------------

  createProject(data) {
    const create = this.db.transaction(() => {
      const number = this._nextNumber("shura", data.guildId);
      this.db
        .prepare(
          `INSERT INTO shura_projects (guild_id, number, title, goal, details, proposer_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(data.guildId, number, data.title, data.goal, data.details || null, data.proposerId, Date.now());
      return number;
    });
    return this.getProject(data.guildId, create());
  }

  getProject(guildId, number) {
    return this.db.prepare("SELECT * FROM shura_projects WHERE guild_id = ? AND number = ?").get(guildId, number) || null;
  }

  getProjectById(id) {
    return this.db.prepare("SELECT * FROM shura_projects WHERE id = ?").get(id) || null;
  }

  setProjectMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE shura_projects SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  /** تصويت عضو المجلس. يستبدل صوته السابق داخل معاملة واحدة. */
  vote(projectId, voterId, choice) {
    const apply = this.db.transaction(() => {
      const project = this.db.prepare("SELECT status FROM shura_projects WHERE id = ?").get(projectId);
      if (!project || project.status !== "open") return { ok: false, reason: "closed" };

      this.db
        .prepare(
          `INSERT INTO shura_votes (project_id, voter_id, vote, voted_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(project_id, voter_id) DO UPDATE SET vote = excluded.vote, voted_at = excluded.voted_at`
        )
        .run(projectId, voterId, choice, Date.now());
      return { ok: true };
    });
    return apply();
  }

  voteCounts(projectId) {
    const rows = this.db
      .prepare("SELECT vote, COUNT(*) AS c FROM shura_votes WHERE project_id = ? GROUP BY vote")
      .all(projectId);
    const counts = { yes: 0, no: 0, abstain: 0 };
    for (const r of rows) counts[r.vote] = r.c;
    return counts;
  }

  voterChoice(projectId, voterId) {
    const row = this.db.prepare("SELECT vote FROM shura_votes WHERE project_id = ? AND voter_id = ?").get(projectId, voterId);
    return row?.vote || null;
  }

  /** قرار نهائي على المشروع. ذرّي: لا يُبت مرتين. */
  decideProject(id, status, deciderId, reason, sessionTime) {
    return this.db
      .prepare(
        `UPDATE shura_projects SET status = ?, decided_by = ?, decided_at = ?, reason = ?, session_time = COALESCE(?, session_time)
         WHERE id = ? AND status = 'open'`
      )
      .run(status, deciderId, Date.now(), reason || null, sessionTime || null, id).changes === 1;
  }

  listProjects(guildId, { status = null, limit = 15 } = {}) {
    const sql = status
      ? "SELECT * FROM shura_projects WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT ?"
      : "SELECT * FROM shura_projects WHERE guild_id = ? ORDER BY id DESC LIMIT ?";
    return status ? this.db.prepare(sql).all(guildId, status, limit) : this.db.prepare(sql).all(guildId, limit);
  }

  // ---------------- التعميمات ----------------

  createCircular(data) {
    const create = this.db.transaction(() => {
      const number = this._nextNumber("circular", data.guildId);
      this.db
        .prepare(
          `INSERT INTO circulars (guild_id, number, title, body, issuer_id, authority, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(data.guildId, number, data.title, data.body, data.issuerId, data.authority || null, Date.now());
      return number;
    });
    return this.getCircular(data.guildId, create());
  }

  getCircular(guildId, number) {
    return this.db.prepare("SELECT * FROM circulars WHERE guild_id = ? AND number = ?").get(guildId, number) || null;
  }

  setCircularMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE circulars SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  listCirculars(guildId, limit = 15) {
    return this.db.prepare("SELECT * FROM circulars WHERE guild_id = ? ORDER BY id DESC LIMIT ?").all(guildId, limit);
  }

  deleteCircular(guildId, number) {
    return this.db.prepare("DELETE FROM circulars WHERE guild_id = ? AND number = ?").run(guildId, number).changes === 1;
  }

  // ---------------- التقاعد ----------------

  createRetirement(data) {
    const create = this.db.transaction(() => {
      const number = this._nextNumber("retirement", data.guildId);
      this.db
        .prepare(
          `INSERT INTO retirements (guild_id, number, user_id, reason, honor, saved_roles, service_ms, retired_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          data.guildId, number, data.userId, data.reason || null, data.honor || null,
          JSON.stringify(data.savedRoles || []), data.serviceMs || null, data.retiredBy, Date.now()
        );
      return number;
    });
    return this.getRetirement(data.guildId, create());
  }

  _hydrateRetirement(row) {
    return row ? { ...row, saved_roles: JSON.parse(row.saved_roles || "[]") } : null;
  }

  getRetirement(guildId, number) {
    return this._hydrateRetirement(
      this.db.prepare("SELECT * FROM retirements WHERE guild_id = ? AND number = ?").get(guildId, number)
    );
  }

  setRetirementMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE retirements SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  listRetirements(guildId, limit = 15) {
    return this.db
      .prepare("SELECT * FROM retirements WHERE guild_id = ? ORDER BY id DESC LIMIT ?")
      .all(guildId, limit)
      .map((r) => this._hydrateRetirement(r));
  }

  retirementsFor(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM retirements WHERE guild_id = ? AND user_id = ? ORDER BY id DESC")
      .all(guildId, userId)
      .map((r) => this._hydrateRetirement(r));
  }
}

module.exports = GovernmentRepository;
