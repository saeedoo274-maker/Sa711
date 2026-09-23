class CaseRepository {
  constructor(db) {
    this.db = db;

    /**
     * إنشاء قضية جديدة برقم متسلسل.
     * كل شيء داخل معاملة واحدة: زيادة العدّاد وإدراج القضية.
     * هذا يمنع حصول إداريَّين على نفس رقم القضية عند التنفيذ المتزامن.
     */
    this._create = db.transaction((data) => {
      db.prepare(
        `INSERT INTO case_counters (guild_id, last_number) VALUES (?, 0)
         ON CONFLICT(guild_id) DO NOTHING`
      ).run(data.guildId);

      db.prepare("UPDATE case_counters SET last_number = last_number + 1 WHERE guild_id = ?").run(data.guildId);
      const { last_number: caseNumber } = db
        .prepare("SELECT last_number FROM case_counters WHERE guild_id = ?")
        .get(data.guildId);

      db.prepare(
        `INSERT INTO cases
          (guild_id, case_number, type, target_id, target_tag, moderator_id, moderator_tag,
           reason, duration_ms, expires_at, active, created_at)
         VALUES (@guildId, @caseNumber, @type, @targetId, @targetTag, @moderatorId, @moderatorTag,
                 @reason, @durationMs, @expiresAt, 1, @createdAt)`
      ).run({
        guildId: data.guildId,
        caseNumber,
        type: data.type,
        targetId: data.targetId,
        targetTag: data.targetTag || null,
        moderatorId: data.moderatorId,
        moderatorTag: data.moderatorTag || null,
        reason: data.reason || null,
        durationMs: data.durationMs || null,
        expiresAt: data.durationMs ? Date.now() + data.durationMs : null,
        createdAt: Date.now()
      });

      return caseNumber;
    });
  }

  create(data) {
    const caseNumber = this._create(data);
    return this.getByNumber(data.guildId, caseNumber);
  }

  getByNumber(guildId, caseNumber) {
    return this.db.prepare("SELECT * FROM cases WHERE guild_id = ? AND case_number = ?").get(guildId, caseNumber) || null;
  }

  listByTarget(guildId, targetId, { type = null, activeOnly = false, limit = 25 } = {}) {
    let sql = "SELECT * FROM cases WHERE guild_id = ? AND target_id = ?";
    const params = [guildId, targetId];
    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }
    if (activeOnly) sql += " AND active = 1";
    sql += " ORDER BY case_number DESC LIMIT ?";
    params.push(limit);
    return this.db.prepare(sql).all(...params);
  }

  countByTarget(guildId, targetId, type = null) {
    let sql = "SELECT COUNT(*) AS c FROM cases WHERE guild_id = ? AND target_id = ? AND active = 1";
    const params = [guildId, targetId];
    if (type) {
      sql += " AND type = ?";
      params.push(type);
    }
    return this.db.prepare(sql).get(...params).c;
  }

  /** إلغاء تفعيل قضية. يُرجع true فقط إن كانت فعّالة قبل الاستدعاء (عملية ذرية). */
  deactivate(guildId, caseNumber) {
    const res = this.db
      .prepare("UPDATE cases SET active = 0 WHERE guild_id = ? AND case_number = ? AND active = 1")
      .run(guildId, caseNumber);
    return res.changes === 1;
  }

  /** القضايا المؤقتة المنتهية (للإفراج التلقائي مستقبلًا). */
  listExpired(now = Date.now()) {
    return this.db.prepare("SELECT * FROM cases WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?").all(now);
  }

  recent(guildId, limit = 10) {
    return this.db.prepare("SELECT * FROM cases WHERE guild_id = ? ORDER BY case_number DESC LIMIT ?").all(guildId, limit);
  }
}

module.exports = CaseRepository;
