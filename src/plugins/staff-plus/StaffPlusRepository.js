class StaffPlusRepository {
  constructor(db) {
    this.db = db;
  }

  // ---------- الأقسام ----------
  createDepartment(guildId, name, roleId, leadId) {
    const info = this.db.prepare("INSERT OR IGNORE INTO staff_departments (guild_id, name, role_id, lead_id, created_at) VALUES (?, ?, ?, ?, ?)").run(guildId, name, roleId, leadId, Date.now());
    return info.changes === 1 ? this.department(guildId, name) : null;
  }

  department(guildId, name) {
    return this.db.prepare("SELECT * FROM staff_departments WHERE guild_id = ? AND name = ?").get(guildId, name) || null;
  }

  departmentById(id) {
    return this.db.prepare("SELECT * FROM staff_departments WHERE id = ?").get(id) || null;
  }

  departments(guildId) {
    return this.db.prepare(
      `SELECT d.*, (SELECT COUNT(*) FROM staff_department_members m WHERE m.department_id = d.id) AS members
       FROM staff_departments d WHERE d.guild_id = ? ORDER BY d.name`
    ).all(guildId);
  }

  countDepartments(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM staff_departments WHERE guild_id = ?").get(guildId).c;
  }

  deleteDepartment(guildId, name) {
    const d = this.department(guildId, name);
    if (!d) return false;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM staff_department_members WHERE department_id = ?").run(d.id);
      this.db.prepare("DELETE FROM staff_departments WHERE id = ?").run(d.id);
    })();
    return true;
  }

  setMemberDepartment(guildId, userId, departmentId) {
    const prev = this.memberDepartment(guildId, userId);
    if (departmentId === null) this.db.prepare("DELETE FROM staff_department_members WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
    else {
      this.db.prepare(
        `INSERT INTO staff_department_members (guild_id, user_id, department_id, joined_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET department_id = excluded.department_id, joined_at = excluded.joined_at`
      ).run(guildId, userId, departmentId, Date.now());
    }
    return prev;
  }

  memberDepartment(guildId, userId) {
    return this.db.prepare(
      "SELECT d.* FROM staff_department_members m JOIN staff_departments d ON d.id = m.department_id WHERE m.guild_id = ? AND m.user_id = ?"
    ).get(guildId, userId) || null;
  }

  departmentMembers(departmentId, limit = 50) {
    return this.db.prepare("SELECT user_id FROM staff_department_members WHERE department_id = ? LIMIT ?").all(departmentId, limit).map((r) => r.user_id);
  }

  // ---------- المناوبات ----------
  openShift(guildId, userId) {
    return this.db.prepare("SELECT * FROM staff_shifts WHERE guild_id = ? AND user_id = ? AND status != 'ended'").get(guildId, userId) || null;
  }

  startShift(guildId, userId) {
    const info = this.db.prepare("INSERT OR IGNORE INTO staff_shifts (guild_id, user_id, status, started_at) VALUES (?, ?, 'active', ?)").run(guildId, userId, Date.now());
    return info.changes === 1 ? this.shift(info.lastInsertRowid) : null;
  }

  shift(id) {
    return this.db.prepare("SELECT * FROM staff_shifts WHERE id = ?").get(id) || null;
  }

  startBreak(id) {
    return this.db.prepare("UPDATE staff_shifts SET status = 'break', break_started_at = ? WHERE id = ? AND status = 'active'").run(Date.now(), id).changes === 1;
  }

  endBreak(id) {
    return this.db.prepare(
      "UPDATE staff_shifts SET status = 'active', break_ms = break_ms + (? - break_started_at), break_started_at = NULL WHERE id = ? AND status = 'break'"
    ).run(Date.now(), id).changes === 1;
  }

  /** إنهاء ذرّي؛ الاستراحة الجارية تُحتسب قبل الإغلاق. */
  endShift(id, endedBy) {
    const now = Date.now();
    return this.db.prepare(
      `UPDATE staff_shifts SET status = 'ended', ended_at = ?, ended_by = ?,
         break_ms = break_ms + CASE WHEN break_started_at IS NOT NULL THEN ? - break_started_at ELSE 0 END, break_started_at = NULL
       WHERE id = ? AND status != 'ended'`
    ).run(now, endedBy, now, id).changes === 1;
  }

  shiftStats(guildId, userId, sinceMs) {
    return this.db.prepare(
      `SELECT COUNT(*) AS shifts, COALESCE(SUM(ended_at - started_at - break_ms), 0) AS workedMs, COALESCE(SUM(break_ms), 0) AS breakMs
       FROM staff_shifts WHERE guild_id = ? AND user_id = ? AND status = 'ended' AND started_at >= ?`
    ).get(guildId, userId, sinceMs);
  }

  onShift(guildId) {
    return this.db.prepare("SELECT * FROM staff_shifts WHERE guild_id = ? AND status != 'ended' ORDER BY started_at").all(guildId);
  }

  // ---------- السجل والتقييمات ----------
  recordRank(guildId, userId, actorId, direction, details) {
    this.db.prepare("INSERT INTO staff_rank_history (guild_id, user_id, actor_id, direction, details, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(guildId, userId, actorId, direction, details, Date.now());
  }

  rankHistory(guildId, userId, limit = 10) {
    return this.db.prepare("SELECT * FROM staff_rank_history WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?").all(guildId, userId, limit);
  }

  addEvaluation(guildId, userId, evaluatorId, score, notes) {
    this.db.prepare("INSERT INTO staff_evaluations (guild_id, user_id, evaluator_id, score, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(guildId, userId, evaluatorId, score, notes, Date.now());
  }

  evaluations(guildId, userId, limit = 5) {
    return this.db.prepare("SELECT * FROM staff_evaluations WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?").all(guildId, userId, limit);
  }

  evaluationStats(guildId, userId, sinceMs) {
    return this.db.prepare("SELECT COUNT(*) AS count, AVG(score) AS avg FROM staff_evaluations WHERE guild_id = ? AND user_id = ? AND created_at >= ?").get(guildId, userId, sinceMs);
  }

  lastEvaluationBy(guildId, userId, evaluatorId) {
    return this.db.prepare("SELECT created_at FROM staff_evaluations WHERE guild_id = ? AND user_id = ? AND evaluator_id = ? ORDER BY id DESC LIMIT 1").get(guildId, userId, evaluatorId)?.created_at || 0;
  }
}

module.exports = StaffPlusRepository;
