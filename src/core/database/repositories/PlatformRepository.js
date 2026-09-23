/**
 * مستودع البنية التحتية للمنصة: حالة النظام، سجل الصيانة، المجدول، الطابور،
 * تفضيلات الإشعارات، وإعدادات المستخدم.
 *
 * كل عملية "استلام" لمهمة تستخدم شرطًا داخل جملة UPDATE نفسها
 * (`WHERE status = 'pending'`)، فلا تُنفَّذ مهمة مرتين حتى لو تزامن مؤقّتان.
 */
class PlatformRepository {
  constructor(db) {
    this.db = db;
  }

  // ---------------- حالة النظام (مفتاح/قيمة) ----------------

  getState(key, fallback = null) {
    const row = this.db.prepare("SELECT value FROM system_state WHERE key = ?").get(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return fallback;
    }
  }

  setState(key, value) {
    this.db
      .prepare(
        `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), Date.now());
    return value;
  }

  deleteState(key) {
    return this.db.prepare("DELETE FROM system_state WHERE key = ?").run(key).changes > 0;
  }

  // ---------------- سجل الصيانة ----------------

  logMaintenance({ scope, target = null, action, message = null, actorId = null, startsAt = null, endsAt = null }) {
    this.db
      .prepare(
        `INSERT INTO maintenance_log (scope, target, action, message, actor_id, starts_at, ends_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(scope, target, action, message, actorId, startsAt, endsAt, Date.now());
  }

  maintenanceLog(limit = 20) {
    return this.db.prepare("SELECT * FROM maintenance_log ORDER BY id DESC LIMIT ?").all(Math.min(limit, 100));
  }

  // ---------------- المجدول ----------------

  _job(row) {
    if (!row) return null;
    return {
      ...row,
      payload: safeJson(row.payload, {}),
      repeat: row.repeat ? safeJson(row.repeat, null) : null
    };
  }

  createJob({ guildId = null, type, uniqueKey = null, payload = {}, runAt, repeat = null, maxAttempts = 3, createdBy = null }) {
    const now = Date.now();
    const info = this.db
      .prepare(
        `INSERT INTO scheduled_jobs (guild_id, type, unique_key, payload, run_at, repeat, max_attempts, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(unique_key) DO UPDATE SET
           payload = excluded.payload, run_at = excluded.run_at, repeat = excluded.repeat,
           status = 'pending', attempts = 0, last_error = NULL, updated_at = excluded.updated_at`
      )
      .run(guildId, type, uniqueKey, JSON.stringify(payload), runAt, repeat ? JSON.stringify(repeat) : null, maxAttempts, createdBy, now, now);
    if (uniqueKey) return this.jobByKey(uniqueKey);
    return this.job(info.lastInsertRowid);
  }

  job(id) {
    return this._job(this.db.prepare("SELECT * FROM scheduled_jobs WHERE id = ?").get(id));
  }

  jobByKey(uniqueKey) {
    return this._job(this.db.prepare("SELECT * FROM scheduled_jobs WHERE unique_key = ?").get(uniqueKey));
  }

  /** المهام المستحقة من الأنواع المعرّفة فقط — نوع إضافة معطّلة يبقى منتظرًا بدل أن يفشل. */
  dueJobs(types, now = Date.now(), limit = 25) {
    if (!types.length) return [];
    const placeholders = types.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT * FROM scheduled_jobs
         WHERE status = 'pending' AND run_at <= ? AND type IN (${placeholders})
         ORDER BY run_at ASC LIMIT ?`
      )
      .all(now, ...types, limit)
      .map((r) => this._job(r));
  }

  claimJob(id) {
    return (
      this.db
        .prepare("UPDATE scheduled_jobs SET status = 'running', attempts = attempts + 1, last_run_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
        .run(Date.now(), Date.now(), id).changes === 1
    );
  }

  finishJob(id, { status, runAt = null, error = null, resetAttempts = false }) {
    this.db
      .prepare(
        `UPDATE scheduled_jobs SET status = ?, run_at = COALESCE(?, run_at), last_error = ?,
           attempts = CASE WHEN ? THEN 0 ELSE attempts END, updated_at = ?
         WHERE id = ?`
      )
      .run(status, runAt, error, resetAttempts ? 1 : 0, Date.now(), id);
  }

  updateJobPayload(id, payload) {
    this.db.prepare("UPDATE scheduled_jobs SET payload = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(payload), Date.now(), id);
  }

  rescheduleJob(id, runAt, repeat) {
    return (
      this.db
        .prepare(
          `UPDATE scheduled_jobs SET run_at = ?, repeat = ?, status = 'pending', attempts = 0, updated_at = ?
           WHERE id = ? AND status IN ('pending', 'failed')`
        )
        .run(runAt, repeat ? JSON.stringify(repeat) : null, Date.now(), id).changes === 1
    );
  }

  cancelJob(id) {
    return this.db.prepare("UPDATE scheduled_jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending', 'failed')").run(Date.now(), id).changes === 1;
  }

  cancelJobByKey(uniqueKey) {
    return this.db.prepare("UPDATE scheduled_jobs SET status = 'cancelled', updated_at = ? WHERE unique_key = ? AND status IN ('pending', 'failed')").run(Date.now(), uniqueKey).changes === 1;
  }

  listJobs({ guildId = null, type = null, status = null, limit = 25, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (guildId) { where.push("guild_id = ?"); params.push(guildId); }
    if (type) { where.push("type = ?"); params.push(type); }
    if (status) { where.push("status = ?"); params.push(status); }
    const sql = `SELECT * FROM scheduled_jobs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY run_at ASC LIMIT ? OFFSET ?`;
    return this.db.prepare(sql).all(...params, Math.min(limit, 100), offset).map((r) => this._job(r));
  }

  jobCounts() {
    return this.db.prepare("SELECT status, COUNT(*) AS c FROM scheduled_jobs GROUP BY status").all();
  }

  /** مهام علقت في حالة التشغيل (توقف البوت أثناءها) تعود للانتظار. */
  recoverStuckJobs() {
    return this.db.prepare("UPDATE scheduled_jobs SET status = 'pending', updated_at = ? WHERE status = 'running'").run(Date.now()).changes;
  }

  purgeFinishedJobs(olderThanMs) {
    return this.db
      .prepare("DELETE FROM scheduled_jobs WHERE status IN ('done', 'cancelled', 'failed') AND updated_at < ?")
      .run(Date.now() - olderThanMs).changes;
  }

  // ---------------- الطابور ----------------

  _queueJob(row) {
    if (!row) return null;
    return { ...row, payload: safeJson(row.payload, {}), result: row.result ? safeJson(row.result, null) : null };
  }

  enqueue({ queue, guildId = null, payload = {}, maxAttempts = 3, availableAt = Date.now(), createdBy = null }) {
    const info = this.db
      .prepare(
        `INSERT INTO queue_jobs (queue, guild_id, payload, max_attempts, available_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(queue, guildId, JSON.stringify(payload), maxAttempts, availableAt, createdBy, Date.now());
    return this.queueJob(info.lastInsertRowid);
  }

  queueJob(id) {
    return this._queueJob(this.db.prepare("SELECT * FROM queue_jobs WHERE id = ?").get(id));
  }

  nextQueueJob(queue, now = Date.now()) {
    return this._queueJob(
      this.db
        .prepare("SELECT * FROM queue_jobs WHERE queue = ? AND status = 'pending' AND available_at <= ? ORDER BY id ASC LIMIT 1")
        .get(queue, now)
    );
  }

  claimQueueJob(id) {
    return (
      this.db
        .prepare("UPDATE queue_jobs SET status = 'running', attempts = attempts + 1, started_at = ? WHERE id = ? AND status = 'pending'")
        .run(Date.now(), id).changes === 1
    );
  }

  queueProgress(id, progress, total) {
    this.db.prepare("UPDATE queue_jobs SET progress = ?, total = ? WHERE id = ?").run(progress, total, id);
  }

  finishQueueJob(id, { status, result = null, error = null, availableAt = null }) {
    this.db
      .prepare(
        `UPDATE queue_jobs SET status = ?, result = ?, error = ?, available_at = COALESCE(?, available_at),
           finished_at = CASE WHEN ? IN ('done', 'failed', 'cancelled') THEN ? ELSE finished_at END
         WHERE id = ?`
      )
      .run(status, result == null ? null : JSON.stringify(result), error, availableAt, status, Date.now(), id);
  }

  cancelQueueJob(id) {
    return this.db.prepare("UPDATE queue_jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('pending', 'running')").run(Date.now(), id).changes === 1;
  }

  isQueueJobCancelled(id) {
    return this.db.prepare("SELECT status FROM queue_jobs WHERE id = ?").get(id)?.status === "cancelled";
  }

  runningCount(queue) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM queue_jobs WHERE queue = ? AND status = 'running'").get(queue).c;
  }

  listQueue({ guildId = null, queue = null, limit = 20 } = {}) {
    const where = [];
    const params = [];
    if (guildId) { where.push("guild_id = ?"); params.push(guildId); }
    if (queue) { where.push("queue = ?"); params.push(queue); }
    return this.db
      .prepare(`SELECT * FROM queue_jobs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`)
      .all(...params, Math.min(limit, 100))
      .map((r) => this._queueJob(r));
  }

  queueCounts() {
    return this.db.prepare("SELECT queue, status, COUNT(*) AS c FROM queue_jobs GROUP BY queue, status").all();
  }

  recoverStuckQueue() {
    return this.db.prepare("UPDATE queue_jobs SET status = 'pending', available_at = ? WHERE status = 'running'").run(Date.now()).changes;
  }

  purgeFinishedQueue(olderThanMs) {
    return this.db
      .prepare("DELETE FROM queue_jobs WHERE status IN ('done', 'failed', 'cancelled') AND finished_at < ?")
      .run(Date.now() - olderThanMs).changes;
  }

  // ---------------- تفضيلات الإشعارات ----------------

  notificationPref(guildId, userId, category) {
    const row = this.db
      .prepare("SELECT dm FROM notification_prefs WHERE guild_id = ? AND user_id = ? AND category = ?")
      .get(guildId, userId, category);
    return row ? !!row.dm : null;
  }

  setNotificationPref(guildId, userId, category, dm) {
    this.db
      .prepare(
        `INSERT INTO notification_prefs (guild_id, user_id, category, dm, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id, category) DO UPDATE SET dm = excluded.dm, updated_at = excluded.updated_at`
      )
      .run(guildId, userId, category, dm ? 1 : 0, Date.now());
  }

  notificationPrefs(guildId, userId) {
    return this.db.prepare("SELECT category, dm FROM notification_prefs WHERE guild_id = ? AND user_id = ?").all(guildId, userId);
  }

  // ---------------- إعدادات المستخدم ----------------

  userTimezone(userId) {
    return this.db.prepare("SELECT timezone FROM user_settings WHERE user_id = ?").get(userId)?.timezone || null;
  }

  setUserTimezone(userId, timezone) {
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, timezone, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET timezone = excluded.timezone, updated_at = excluded.updated_at`
      )
      .run(userId, timezone, Date.now());
  }
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

module.exports = PlatformRepository;
