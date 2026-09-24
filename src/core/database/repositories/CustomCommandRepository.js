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

  /**
   * تحديث عدة أعمدة من التوسعة دفعة واحدة (قائمة بيضاء ثابتة).
   * القيم المصفوفية/الكائنات تُحفظ JSON.
   */
  updateExtras(id, fields) {
    const allowed = [
      "responses", "response_mode", "required_roles", "allowed_channels", "dm", "reply", "min_args", "usage",
      "components", "attachments", "webhook_name", "webhook_avatar", "api_url", "enabled", "cooldown_ms",
      "content", "embed_id", "prefix", "min_level", "ephemeral", "delete_trigger", "allow_mentions"
    ];
    const cols = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!cols.length) return this.getById(id);
    const values = Object.fromEntries(cols.map((c) => [c, fields[c] !== null && typeof fields[c] === "object" ? JSON.stringify(fields[c]) : fields[c]]));
    this.db.prepare(`UPDATE custom_commands SET ${cols.map((c) => `${c} = @${c}`).join(", ")}, updated_at = @now WHERE id = @id`).run({ ...values, now: Date.now(), id });
    return this.getById(id);
  }

  // ---------- الأسماء البديلة (جدول custom_command_aliases) ----------

  aliases(guildId) {
    return this.db.prepare("SELECT alias, command_id FROM custom_command_aliases WHERE guild_id = ?").all(guildId);
  }

  aliasesOf(commandId) {
    return this.db.prepare("SELECT alias FROM custom_command_aliases WHERE command_id = ? ORDER BY alias").all(commandId).map((r) => r.alias);
  }

  addAlias(guildId, commandId, alias) {
    return this.db.prepare("INSERT OR IGNORE INTO custom_command_aliases (guild_id, command_id, alias, created_at) VALUES (?, ?, ?, ?)").run(guildId, commandId, alias, Date.now()).changes === 1;
  }

  removeAlias(guildId, alias) {
    return this.db.prepare("DELETE FROM custom_command_aliases WHERE guild_id = ? AND alias = ?").run(guildId, alias).changes === 1;
  }

  aliasOwner(guildId, alias) {
    return this.db.prepare("SELECT command_id FROM custom_command_aliases WHERE guild_id = ? AND alias = ?").get(guildId, alias)?.command_id || null;
  }

  recordUse(id) {
    this.db.prepare("UPDATE custom_commands SET uses = uses + 1 WHERE id = ?").run(id);
  }

  delete(guildId, name) {
    const record = this.getByName(guildId, name);
    if (!record) return false;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM custom_command_aliases WHERE command_id = ?").run(record.id);
      this.db.prepare("DELETE FROM custom_commands WHERE id = ?").run(record.id);
    })();
    return true;
  }

  count(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM custom_commands WHERE guild_id = ?").get(guildId).c;
  }
}

module.exports = CustomCommandRepository;
