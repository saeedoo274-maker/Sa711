class EmbedRepository {
  constructor(db) {
    this.db = db;
  }

  _hydrate(row) {
    if (!row) return null;
    return {
      ...row,
      data: JSON.parse(row.data || "{}"),
      components: JSON.parse(row.components || "[]")
    };
  }

  create({ id, guildId, name, createdBy }) {
    const now = Date.now();
    // الإمبيدات الجديدة تبدأ بالشكل الحديث (الأزرار داخل الحاوية).
    // الإمبيدات القديمة تبقى على شكلها حتى لا تنكسر رسائلها المنشورة أصلًا.
    this.db
      .prepare(
        `INSERT INTO embeds (id, guild_id, name, content, data, components, use_v2, created_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, '{}', '[]', 1, ?, ?, ?)`
      )
      .run(id, guildId, name, createdBy || null, now, now);
    return this.get(id);
  }

  get(id) {
    return this._hydrate(this.db.prepare("SELECT * FROM embeds WHERE id = ?").get(id));
  }

  getByName(guildId, name) {
    return this._hydrate(this.db.prepare("SELECT * FROM embeds WHERE guild_id = ? AND name = ?").get(guildId, name));
  }

  list(guildId) {
    return this.db
      .prepare("SELECT * FROM embeds WHERE guild_id = ? ORDER BY updated_at DESC")
      .all(guildId)
      .map((r) => this._hydrate(r));
  }

  count(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM embeds WHERE guild_id = ?").get(guildId).c;
  }

  /** يحفظ الإمبيد كاملًا. أي تعديل يمر من هنا حتى يبقى updated_at صادقًا. */
  save(id, { content, data, components }) {
    this.db
      .prepare("UPDATE embeds SET content = ?, data = ?, components = ?, updated_at = ? WHERE id = ?")
      .run(
        content ?? null,
        JSON.stringify(data || {}),
        JSON.stringify(components || []),
        Date.now(),
        id
      );
    return this.get(id);
  }

  /** يبدّل الشكل بين التقليدي والحديث (Components v2). */
  setV2(id, enabled) {
    this.db.prepare("UPDATE embeds SET use_v2 = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, Date.now(), id);
    return this.get(id);
  }

  rename(id, name) {
    this.db.prepare("UPDATE embeds SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
    return this.get(id);
  }

  delete(id) {
    const wipe = this.db.transaction(() => {
      this.db.prepare("DELETE FROM embed_messages WHERE embed_id = ?").run(id);
      this.db.prepare("UPDATE custom_commands SET embed_id = NULL WHERE embed_id = ?").run(id);
      this.db.prepare("DELETE FROM embeds WHERE id = ?").run(id);
    });
    wipe();
    return true;
  }

  // ---- تتبّع الرسائل المنشورة ----

  trackMessage({ embedId, guildId, channelId, messageId }) {
    this.db
      .prepare(
        `INSERT INTO embed_messages (embed_id, guild_id, channel_id, message_id, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET embed_id = excluded.embed_id`
      )
      .run(embedId, guildId, channelId, messageId, Date.now());
  }

  messages(embedId) {
    return this.db.prepare("SELECT * FROM embed_messages WHERE embed_id = ?").all(embedId);
  }

  untrackMessage(messageId) {
    return this.db.prepare("DELETE FROM embed_messages WHERE message_id = ?").run(messageId).changes === 1;
  }

  // ---------------- القوالب ----------------

  /**
   * يحفظ الإمبيد الحالي كقالب بالاسم.
   * الحفظ باسم موجود يستبدله، فالمستخدم يقدر يحدّث قالبه بلا حذف.
   */
  saveTemplate({ guildId, name, content, data, components, createdBy }) {
    this.db
      .prepare(
        `INSERT INTO embed_templates (guild_id, name, content, data, components, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, name) DO UPDATE SET
           content = excluded.content, data = excluded.data, components = excluded.components`
      )
      .run(guildId, name, content || null,
           JSON.stringify(data || {}), JSON.stringify(components || []),
           createdBy || null, Date.now());
    return this.getTemplate(guildId, name);
  }

  getTemplate(guildId, name) {
    const row = this.db
      .prepare("SELECT * FROM embed_templates WHERE guild_id = ? AND name = ?")
      .get(guildId, name);
    return row ? this._hydrateTemplate(row) : null;
  }

  listTemplates(guildId) {
    return this.db
      .prepare("SELECT * FROM embed_templates WHERE guild_id = ? ORDER BY name ASC")
      .all(guildId)
      .map((r) => this._hydrateTemplate(r));
  }

  deleteTemplate(guildId, name) {
    return this.db
      .prepare("DELETE FROM embed_templates WHERE guild_id = ? AND name = ?")
      .run(guildId, name).changes === 1;
  }

  /** يطبّق قالبًا على إمبيد موجود. لا يغيّر اسم الإمبيد ولا معرّفه. */
  applyTemplate(guildId, templateName, embedId) {
    const tpl = this.getTemplate(guildId, templateName);
    if (!tpl) return null;

    this.db
      .prepare("UPDATE embeds SET content = ?, data = ?, components = ?, updated_at = ? WHERE id = ?")
      .run(tpl.content, JSON.stringify(tpl.data), JSON.stringify(tpl.components), Date.now(), embedId);

    this.db.prepare("UPDATE embed_templates SET uses = uses + 1 WHERE guild_id = ? AND name = ?")
      .run(guildId, templateName);

    return this.get(embedId);
  }

  _hydrateTemplate(row) {
    return {
      ...row,
      data: JSON.parse(row.data || "{}"),
      components: JSON.parse(row.components || "[]")
    };
  }
}

module.exports = EmbedRepository;
