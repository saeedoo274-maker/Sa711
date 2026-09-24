class AnnouncementRepository {
  constructor(db) {
    this.db = db;
  }

  _row(row) {
    if (!row) return null;
    const parse = (v, d) => {
      try {
        return v ? JSON.parse(v) : d;
      } catch {
        return d;
      }
    };
    return { ...row, spec: parse(row.spec, {}), repeat: parse(row.repeat, null) };
  }

  create({ guildId, status, name = null, target = "channel", channelId = null, dmRoleId = null, spec, runAt = null, repeat = null, createdBy = null }) {
    const info = this.db
      .prepare(
        `INSERT INTO announcements (guild_id, status, name, target, channel_id, dm_role_id, spec, run_at, repeat, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(guildId, status, name, target, channelId, dmRoleId, JSON.stringify(spec), runAt, repeat ? JSON.stringify(repeat) : null, createdBy, Date.now());
    return this.get(info.lastInsertRowid);
  }

  get(id) {
    return this._row(this.db.prepare("SELECT * FROM announcements WHERE id = ?").get(id));
  }

  /** انتقال حالة ذرّي: ينجح فقط إن كانت الحالة الحالية كما نتوقع. */
  transition(id, from, to, extra = {}) {
    const cols = Object.keys(extra);
    const set = [`status = @to`, ...cols.map((c) => `${c} = @${c}`)].join(", ");
    return this.db.prepare(`UPDATE announcements SET ${set} WHERE id = @id AND status = @from`).run({ ...extra, id, from, to }).changes === 1;
  }

  recordSend(id, { messageId = null, result = null, nextRunAt = null, status }) {
    this.db
      .prepare("UPDATE announcements SET sent_count = sent_count + 1, last_sent_at = ?, last_message_id = COALESCE(?, last_message_id), last_result = ?, run_at = COALESCE(?, run_at), status = ? WHERE id = ?")
      .run(Date.now(), messageId, result ? JSON.stringify(result) : null, nextRunAt, status, id);
  }

  setResult(id, result, status) {
    this.db.prepare("UPDATE announcements SET last_result = ?, status = ? WHERE id = ?").run(JSON.stringify(result), status, id);
  }

  list(guildId, statuses, limit = 25) {
    const marks = statuses.map(() => "?").join(", ");
    return this.db
      .prepare(`SELECT * FROM announcements WHERE guild_id = ? AND status IN (${marks}) ORDER BY COALESCE(run_at, created_at) ASC LIMIT ?`)
      .all(guildId, ...statuses, limit)
      .map((r) => this._row(r));
  }

  count(guildId, status) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM announcements WHERE guild_id = ? AND status = ?").get(guildId, status).c;
  }

  template(guildId, name) {
    return this._row(this.db.prepare("SELECT * FROM announcements WHERE guild_id = ? AND status = 'template' AND name = ?").get(guildId, name));
  }

  saveTemplate(guildId, name, spec, userId) {
    const existing = this.template(guildId, name);
    if (existing) {
      this.db.prepare("UPDATE announcements SET spec = ?, created_by = ?, created_at = ? WHERE id = ?").run(JSON.stringify(spec), userId, Date.now(), existing.id);
      return this.get(existing.id);
    }
    return this.create({ guildId, status: "template", name, spec, createdBy: userId });
  }

  deleteTemplate(guildId, name) {
    return this.db.prepare("DELETE FROM announcements WHERE guild_id = ? AND status = 'template' AND name = ?").run(guildId, name).changes === 1;
  }

  /** حذف المسودات المنتهية (لم تُؤكَّد خلال المهلة). */
  purgeDrafts(olderThan) {
    return this.db.prepare("DELETE FROM announcements WHERE status = 'draft' AND created_at < ?").run(olderThan).changes;
  }
}

module.exports = AnnouncementRepository;
