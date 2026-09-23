class TicketTypeRepository {
  constructor(db) {
    this.db = db;
  }

  _hydrate(row) {
    if (!row) return null;
    return { ...row, questions: JSON.parse(row.questions || "[]") };
  }

  create({ id, guildId, name, label, description, emoji, categoryId, staffRoleId, nameTemplate, maxOpen }) {
    this.db
      .prepare(
        `INSERT INTO ticket_types
           (id, guild_id, name, label, description, emoji, category_id, staff_role_id, name_template, questions, max_open, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
      )
      .run(
        id, guildId, name, label, description || null, emoji || null,
        categoryId || null, staffRoleId || null, nameTemplate || null,
        maxOpen || 1, Date.now()
      );
    return this.get(id);
  }

  get(id) {
    return this._hydrate(this.db.prepare("SELECT * FROM ticket_types WHERE id = ?").get(id));
  }

  getByName(guildId, name) {
    return this._hydrate(this.db.prepare("SELECT * FROM ticket_types WHERE guild_id = ? AND name = ?").get(guildId, name));
  }

  list(guildId) {
    return this.db
      .prepare("SELECT * FROM ticket_types WHERE guild_id = ? ORDER BY created_at ASC")
      .all(guildId)
      .map((r) => this._hydrate(r));
  }

  count(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM ticket_types WHERE guild_id = ?").get(guildId).c;
  }

  /** تعديل حقل واحد. أسماء الأعمدة على قائمة بيضاء صارمة. */
  update(id, field, value) {
    const statements = {
      label: "UPDATE ticket_types SET label = ? WHERE id = ?",
      description: "UPDATE ticket_types SET description = ? WHERE id = ?",
      emoji: "UPDATE ticket_types SET emoji = ? WHERE id = ?",
      category_id: "UPDATE ticket_types SET category_id = ? WHERE id = ?",
      staff_role_id: "UPDATE ticket_types SET staff_role_id = ? WHERE id = ?",
      welcome_embed_id: "UPDATE ticket_types SET welcome_embed_id = ? WHERE id = ?",
      name_template: "UPDATE ticket_types SET name_template = ? WHERE id = ?",
      max_open: "UPDATE ticket_types SET max_open = ? WHERE id = ?"
    };
    if (!statements[field]) throw new Error(`حقل غير مسموح: ${field}`);
    this.db.prepare(statements[field]).run(value, id);
    return this.get(id);
  }

  setQuestions(id, questions) {
    this.db.prepare("UPDATE ticket_types SET questions = ? WHERE id = ?").run(JSON.stringify(questions || []), id);
    return this.get(id);
  }

  delete(guildId, name) {
    return this.db.prepare("DELETE FROM ticket_types WHERE guild_id = ? AND name = ?").run(guildId, name).changes === 1;
  }

  openCountForType(guildId, typeId, userId) {
    return this.db
      .prepare("SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND type_id = ? AND owner_id = ? AND status = 'open'")
      .get(guildId, typeId, userId).c;
  }
}

module.exports = TicketTypeRepository;
