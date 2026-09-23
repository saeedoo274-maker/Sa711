class CustomCommandRepository {
  constructor(db) {
    this.db = db;
    this.onChange = null; // تُربط بخدمة الكاش عند الإقلاع
  }

  /** يُبطل كاش الخدمة بعد أي تعديل، فتظهر التغييرات فورًا. */
  invalidate(guildId) {
    if (typeof this.onChange === "function") this.onChange(guildId);
  }

  create(data) {
    const info = this.db
      .prepare(
        `INSERT INTO custom_commands
           (guild_id, name, prefix, embed_id, content, ephemeral, delete_trigger, min_level, allow_mentions, created_by, created_at)
         VALUES (@guildId, @name, @prefix, @embedId, @content, @ephemeral, @deleteTrigger, @minLevel, @allowMentions, @createdBy, @createdAt)`
      )
      .run({
        guildId: data.guildId,
        name: data.name,
        prefix: data.prefix || null,
        embedId: data.embedId || null,
        content: data.content || null,
        ephemeral: data.ephemeral ? 1 : 0,
        deleteTrigger: data.deleteTrigger ? 1 : 0,
        minLevel: data.minLevel || 0,
        allowMentions: data.allowMentions ? 1 : 0,
        createdBy: data.createdBy || null,
        createdAt: Date.now()
      });
    return this.getById(info.lastInsertRowid);
  }

  getById(id) {
    return this.db.prepare("SELECT * FROM custom_commands WHERE id = ?").get(id) || null;
  }

  getByName(guildId, name) {
    return this.db.prepare("SELECT * FROM custom_commands WHERE guild_id = ? AND name = ?").get(guildId, name) || null;
  }

  list(guildId) {
    return this.db.prepare("SELECT * FROM custom_commands WHERE guild_id = ? ORDER BY name ASC").all(guildId);
  }

  /**
   * تحديث حقل واحد.
   * أسماء الأعمدة على قائمة بيضاء صارمة، فلا يمكن تمرير اسم عمود من مدخلات المستخدم.
   */
  update(id, field, value) {
    const allowed = ["prefix", "embed_id", "content", "ephemeral", "delete_trigger", "min_level", "allow_mentions", "name"];
    if (!allowed.includes(field)) throw new Error(`حقل غير مسموح: ${field}`);
    const statements = {
      prefix: "UPDATE custom_commands SET prefix = ? WHERE id = ?",
      embed_id: "UPDATE custom_commands SET embed_id = ? WHERE id = ?",
      content: "UPDATE custom_commands SET content = ? WHERE id = ?",
      ephemeral: "UPDATE custom_commands SET ephemeral = ? WHERE id = ?",
      delete_trigger: "UPDATE custom_commands SET delete_trigger = ? WHERE id = ?",
      min_level: "UPDATE custom_commands SET min_level = ? WHERE id = ?",
      allow_mentions: "UPDATE custom_commands SET allow_mentions = ? WHERE id = ?",
      name: "UPDATE custom_commands SET name = ? WHERE id = ?"
    };
    this.db.prepare(statements[field]).run(value, id);
    return this.getById(id);
  }

  recordUse(id) {
    this.db.prepare("UPDATE custom_commands SET uses = uses + 1 WHERE id = ?").run(id);
  }

  delete(guildId, name) {
    return this.db.prepare("DELETE FROM custom_commands WHERE guild_id = ? AND name = ?").run(guildId, name).changes === 1;
  }

  count(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM custom_commands WHERE guild_id = ?").get(guildId).c;
  }
}

module.exports = CustomCommandRepository;
