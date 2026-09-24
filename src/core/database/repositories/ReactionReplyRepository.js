class ReactionReplyRepository {
  constructor(db) {
    this.db = db;
    this.onChange = null;
  }

  invalidate(guildId) {
    if (typeof this.onChange === "function") this.onChange(guildId);
  }

  _hydrate(row) {
    if (!row) return null;
    const list = (v) => {
      try {
        const x = JSON.parse(v || "[]");
        return Array.isArray(x) ? x : [];
      } catch {
        return [];
      }
    };
    return { ...row, channels: list(row.channels), required_roles: list(row.required_roles), blocked_roles: list(row.blocked_roles) };
  }

  /** تحديث أعمدة الأتمتة دفعة واحدة (قائمة بيضاء ثابتة). */
  updateMany(id, fields) {
    const allowed = [
      "message_id", "role_mode", "remove_role_id", "required_roles", "blocked_roles", "min_account_days", "min_level",
      "cooldown_ms", "log_channel_id", "open_ticket", "target_channel_id", "channel_action", "button_label", "button_url", "remove_reaction"
    ];
    const cols = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!cols.length) return this.getById(id);
    const values = Object.fromEntries(cols.map((c) => [c, Array.isArray(fields[c]) ? JSON.stringify(fields[c]) : fields[c]]));
    this.db.prepare(`UPDATE reaction_replies SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id`).run({ ...values, id });
    return this.getById(id);
  }

  create(d) {
    const info = this.db
      .prepare(
        `INSERT INTO reaction_replies (guild_id, name, emoji, reply_text, embed_id, role_id, channels, dm, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 1, ?)`
      )
      .run(d.guildId, d.name, d.emoji, d.replyText || null, d.embedId || null, d.roleId || null, d.dm ? 1 : 0, Date.now());
    return this.getById(info.lastInsertRowid);
  }

  getById(id) {
    return this._hydrate(this.db.prepare("SELECT * FROM reaction_replies WHERE id = ?").get(id));
  }

  getByName(guildId, name) {
    return this._hydrate(this.db.prepare("SELECT * FROM reaction_replies WHERE guild_id = ? AND name = ?").get(guildId, name));
  }

  list(guildId) {
    return this.db.prepare("SELECT * FROM reaction_replies WHERE guild_id = ?").all(guildId).map((r) => this._hydrate(r));
  }

  listEnabled(guildId) {
    return this.db.prepare("SELECT * FROM reaction_replies WHERE guild_id = ? AND enabled = 1").all(guildId).map((r) => this._hydrate(r));
  }

  count(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM reaction_replies WHERE guild_id = ?").get(guildId).c;
  }

  update(id, field, value) {
    const statements = {
      reply_text: "UPDATE reaction_replies SET reply_text = ? WHERE id = ?",
      embed_id: "UPDATE reaction_replies SET embed_id = ? WHERE id = ?",
      role_id: "UPDATE reaction_replies SET role_id = ? WHERE id = ?",
      channels: "UPDATE reaction_replies SET channels = ? WHERE id = ?",
      dm: "UPDATE reaction_replies SET dm = ? WHERE id = ?",
      enabled: "UPDATE reaction_replies SET enabled = ? WHERE id = ?"
    };
    if (!statements[field]) throw new Error(`حقل غير مسموح: ${field}`);
    const stored = field === "channels" ? JSON.stringify(value || []) : value;
    this.db.prepare(statements[field]).run(stored, id);
    return this.getById(id);
  }

  recordUse(id) {
    this.db.prepare("UPDATE reaction_replies SET uses = uses + 1 WHERE id = ?").run(id);
  }

  delete(guildId, name) {
    return this.db.prepare("DELETE FROM reaction_replies WHERE guild_id = ? AND name = ?").run(guildId, name).changes === 1;
  }
}

module.exports = ReactionReplyRepository;
