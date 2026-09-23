class ReportRepository {
  constructor(db) {
    this.db = db;

    this._nextEvidence = db.transaction((guildId) => {
      db.prepare("INSERT INTO lifecycle_counters (guild_id, kind, last_number) VALUES (?, 'evidence', 0) ON CONFLICT(guild_id, kind) DO NOTHING")
        .run(guildId);
      db.prepare("UPDATE lifecycle_counters SET last_number = last_number + 1 WHERE guild_id = ? AND kind = 'evidence'").run(guildId);
      return db.prepare("SELECT last_number FROM lifecycle_counters WHERE guild_id = ? AND kind = 'evidence'").get(guildId).last_number;
    });
  }

  // ---------------- جدولة التقارير ----------------

  getSchedule(guildId) {
    const row = this.db.prepare("SELECT * FROM report_schedules WHERE guild_id = ?").get(guildId);
    return row ? { ...row, sections: JSON.parse(row.sections || "[]") } : null;
  }

  saveSchedule(guildId, patch) {
    const current = this.getSchedule(guildId) || {
      channel_id: null, frequency: "weekly", hour: 12, weekday: 6,
      mention_role_id: null, sections: [], enabled: 0
    };
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `INSERT INTO report_schedules (guild_id, channel_id, frequency, hour, weekday, mention_role_id, sections, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           channel_id = excluded.channel_id, frequency = excluded.frequency, hour = excluded.hour,
           weekday = excluded.weekday, mention_role_id = excluded.mention_role_id,
           sections = excluded.sections, enabled = excluded.enabled`
      )
      .run(
        guildId, next.channel_id, next.frequency, next.hour, next.weekday,
        next.mention_role_id, JSON.stringify(next.sections || []), next.enabled ? 1 : 0
      );
    return this.getSchedule(guildId);
  }

  /** يسجّل التشغيل بمفتاح اليوم، فلا يتكرر التقرير في نفس اليوم. */
  markRun(guildId, dayKey) {
    return this.db
      .prepare("UPDATE report_schedules SET last_run_at = ?, last_run_day = ? WHERE guild_id = ? AND (last_run_day IS NULL OR last_run_day != ?)")
      .run(Date.now(), dayKey, guildId, dayKey).changes === 1;
  }

  dueSchedules() {
    return this.db
      .prepare("SELECT * FROM report_schedules WHERE enabled = 1 AND channel_id IS NOT NULL")
      .all()
      .map((r) => ({ ...r, sections: JSON.parse(r.sections || "[]") }));
  }

  // ---------------- الدلائل ----------------

  createEvidence(data) {
    const create = this.db.transaction(() => {
      const number = this._nextEvidence(data.guildId);
      this.db
        .prepare(
          `INSERT INTO evidence (guild_id, number, case_number, target_id, officer_id, kind, reason, place, duration, links, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          data.guildId, number, data.caseNumber || null, data.targetId, data.officerId,
          data.kind, data.reason || null, data.place || null, data.duration || null,
          JSON.stringify(data.links || []), data.note || null, Date.now()
        );
      return number;
    });
    return this.getEvidence(data.guildId, create());
  }

  _hydrate(row) {
    return row ? { ...row, links: JSON.parse(row.links || "[]") } : null;
  }

  getEvidence(guildId, number) {
    return this._hydrate(this.db.prepare("SELECT * FROM evidence WHERE guild_id = ? AND number = ?").get(guildId, number));
  }

  setEvidenceMessage(guildId, number, channelId, messageId) {
    this.db
      .prepare("UPDATE evidence SET channel_id = ?, message_id = ? WHERE guild_id = ? AND number = ?")
      .run(channelId, messageId, guildId, number);
  }

  evidenceForTarget(guildId, targetId, limit = 15) {
    return this.db
      .prepare("SELECT * FROM evidence WHERE guild_id = ? AND target_id = ? ORDER BY number DESC LIMIT ?")
      .all(guildId, targetId, limit)
      .map((r) => this._hydrate(r));
  }

  evidenceForCase(guildId, caseNumber) {
    return this.db
      .prepare("SELECT * FROM evidence WHERE guild_id = ? AND case_number = ? ORDER BY number ASC")
      .all(guildId, caseNumber)
      .map((r) => this._hydrate(r));
  }

  evidenceByOfficer(guildId, officerId, sinceMs) {
    return this.db
      .prepare("SELECT COUNT(*) AS c FROM evidence WHERE guild_id = ? AND officer_id = ? AND created_at >= ?")
      .get(guildId, officerId, Date.now() - sinceMs).c;
  }

  deleteEvidence(guildId, number) {
    return this.db.prepare("DELETE FROM evidence WHERE guild_id = ? AND number = ?").run(guildId, number).changes === 1;
  }
}

module.exports = ReportRepository;
