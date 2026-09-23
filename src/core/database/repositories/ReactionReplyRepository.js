class ReactionReplyRepository {
  constructor(db) {
    this.db = db;
    this.onChange = null;
  }

  invalidate(guildId) {
    if (typeof this.onChange === "function") this.onChange(guildId);
  }

  _hydrate(row) {
    return row ? { ...row, channels: JSON.parse(row.channels || "[]") } : null;
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
