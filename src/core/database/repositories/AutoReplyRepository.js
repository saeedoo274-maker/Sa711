class AutoReplyRepository {
  constructor(db) {
    this.db = db;
    this.onChange = null; // تُربط بكاش الخدمة عند الإقلاع
  }

  invalidate(guildId) {
    if (typeof this.onChange === "function") this.onChange(guildId);
  }

  _hydrate(row) {
    if (!row) return null;
    return {
      ...row,
      triggers: JSON.parse(row.triggers || "[]"),
      channels: JSON.parse(row.channels || "[]"),
      ignored_channels: JSON.parse(row.ignored_channels || "[]"),
      role_ids: JSON.parse(row.role_ids || "[]")
    };
  }

  create(d) {
    const info = this.db
      .prepare(
        `INSERT INTO auto_replies
           (guild_id, name, triggers, match_type, reply_text, embed_id, reply_to, delete_trigger,
            channels, ignored_channels, role_ids, cooldown_ms, chance, enabled, created_by, created_at)
         VALUES (@guildId, @name, @triggers, @matchType, @replyText, @embedId, @replyTo, @deleteTrigger,
                 '[]', '[]', '[]', @cooldownMs, @chance, 1, @createdBy, @createdAt)`
      )
      .run({
        guildId: d.guildId,
        name: d.name,
        triggers: JSON.stringify(d.triggers || []),
        matchType: d.matchType || "contains",
        replyText: d.replyText || null,
        embedId: d.embedId || null,
        replyTo: d.replyTo === false ? 0 : 1,
        deleteTrigger: d.deleteTrigger ? 1 : 0,
        cooldownMs: d.cooldownMs || 0,
        chance: d.chance ?? 100,
        createdBy: d.createdBy || null,
        createdAt: Date.now()
      });
    return this.getById(info.lastInsertRowid);
  }

  getById(id) {
    return this._hydrate(this.db.prepare("SELECT * FROM auto_replies WHERE id = ?").get(id));
  }

  getByName(guildId, name) {
    return this._hydrate(this.db.prepare("SELECT * FROM auto_replies WHERE guild_id = ? AND name = ?").get(guildId, name));
  }

  list(guildId) {
    return this.db
      .prepare("SELECT * FROM auto_replies WHERE guild_id = ? ORDER BY created_at ASC")
      .all(guildId)
      .map((r) => this._hydrate(r));
  }

  listEnabled(guildId) {
    return this.db
      .prepare("SELECT * FROM auto_replies WHERE guild_id = ? AND enabled = 1")
      .all(guildId)
      .map((r) => this._hydrate(r));
  }

  count(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM auto_replies WHERE guild_id = ?").get(guildId).c;
  }

  /** تعديل حقل واحد. أسماء الأعمدة على قائمة بيضاء صارمة. */
  update(id, field, value) {
    const statements = {
      triggers: "UPDATE auto_replies SET triggers = ? WHERE id = ?",
      match_type: "UPDATE auto_replies SET match_type = ? WHERE id = ?",
      reply_text: "UPDATE auto_replies SET reply_text = ? WHERE id = ?",
      embed_id: "UPDATE auto_replies SET embed_id = ? WHERE id = ?",
      reply_to: "UPDATE auto_replies SET reply_to = ? WHERE id = ?",
      delete_trigger: "UPDATE auto_replies SET delete_trigger = ? WHERE id = ?",
      channels: "UPDATE auto_replies SET channels = ? WHERE id = ?",
      ignored_channels: "UPDATE auto_replies SET ignored_channels = ? WHERE id = ?",
      role_ids: "UPDATE auto_replies SET role_ids = ? WHERE id = ?",
      cooldown_ms: "UPDATE auto_replies SET cooldown_ms = ? WHERE id = ?",
      chance: "UPDATE auto_replies SET chance = ? WHERE id = ?",
      enabled: "UPDATE auto_replies SET enabled = ? WHERE id = ?"
    };
    if (!statements[field]) throw new Error(`حقل غير مسموح: ${field}`);
    const stored = ["triggers", "channels", "ignored_channels", "role_ids"].includes(field)
      ? JSON.stringify(value || [])
      : value;
    this.db.prepare(statements[field]).run(stored, id);
    return this.getById(id);
  }

  recordUse(id) {
    this.db.prepare("UPDATE auto_replies SET uses = uses + 1 WHERE id = ?").run(id);
  }

  delete(guildId, name) {
    return this.db.prepare("DELETE FROM auto_replies WHERE guild_id = ? AND name = ?").run(guildId, name).changes === 1;
  }
}

module.exports = AutoReplyRepository;
