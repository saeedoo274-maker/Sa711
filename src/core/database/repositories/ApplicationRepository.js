class ApplicationRepository {
  constructor(db) {
    this.db = db;

    /** ترقيم متسلسل مستقل لكل سيرفر داخل معاملة واحدة. */
    this._submit = db.transaction((data) => {
      db.prepare("INSERT INTO application_counters (guild_id, last_number) VALUES (?, 0) ON CONFLICT(guild_id) DO NOTHING")
        .run(data.guildId);
      db.prepare("UPDATE application_counters SET last_number = last_number + 1 WHERE guild_id = ?").run(data.guildId);
      const { last_number: number } = db
        .prepare("SELECT last_number FROM application_counters WHERE guild_id = ?")
        .get(data.guildId);

      db.prepare(
        `INSERT INTO applications (guild_id, number, type_id, user_id, answers, image_url, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).run(
        data.guildId, number, data.typeId, data.userId,
        JSON.stringify(data.answers || {}), data.imageUrl || null, Date.now()
      );
      return number;
    });
  }

  // ---------------- الأنواع ----------------

  createType(d) {
    this.db
      .prepare(
        `INSERT INTO application_types
           (id, guild_id, name, label, description, emoji, questions, review_channel_id,
            accept_role_id, remove_role_id, collect_mode, cooldown_ms, enabled, category, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        d.id, d.guildId, d.name, d.label, d.description || null, d.emoji || null,
        d.reviewChannelId || null, d.acceptRoleId || null, d.removeRoleId || null,
        d.collectMode || "modal", d.cooldownMs || 0, d.category || null, Date.now()
      );
    return this.getType(d.id);
  }

  _hydrateType(row) {
    if (!row) return null;
    return {
      ...row,
      questions: JSON.parse(row.questions || "[]"),
      mentions: JSON.parse(row.mention_ids || "[]"),
      style: JSON.parse(row.style || "{}")
    };
  }

  setStyle(id, style) {
    this.db.prepare("UPDATE application_types SET style = ? WHERE id = ?").run(JSON.stringify(style || {}), id);
    return this.getType(id);
  }

  setMentions(id, mentions) {
    this.db.prepare("UPDATE application_types SET mention_ids = ? WHERE id = ?").run(JSON.stringify(mentions || []), id);
    return this.getType(id);
  }

  // ---- تعديل الأسئلة واحدًا واحدًا ----

  addQuestion(id, question) {
    const type = this.getType(id);
    if (!type) return null;
    const questions = [...type.questions, question];
    return this.setQuestions(id, questions);
  }

  updateQuestion(id, index, patch) {
    const type = this.getType(id);
    if (!type || !type.questions[index]) return null;
    const questions = [...type.questions];
    questions[index] = { ...questions[index], ...patch };
    return this.setQuestions(id, questions);
  }

  removeQuestion(id, index) {
    const type = this.getType(id);
    if (!type || !type.questions[index]) return null;
    const questions = type.questions.filter((_, i) => i !== index);
    return this.setQuestions(id, questions);
  }

  /** ينقل سؤالاً إلى موضع جديد مع الحفاظ على ترتيب البقية. */
  moveQuestion(id, from, to) {
    const type = this.getType(id);
    if (!type || !type.questions[from] || to < 0 || to >= type.questions.length) return null;
    const questions = [...type.questions];
    const [item] = questions.splice(from, 1);
    questions.splice(to, 0, item);
    return this.setQuestions(id, questions);
  }

  getType(id) {
    return this._hydrateType(this.db.prepare("SELECT * FROM application_types WHERE id = ?").get(id));
  }

  getTypeByName(guildId, name) {
    return this._hydrateType(
      this.db.prepare("SELECT * FROM application_types WHERE guild_id = ? AND name = ?").get(guildId, name)
    );
  }

  listTypes(guildId) {
    return this.db
      .prepare("SELECT * FROM application_types WHERE guild_id = ? ORDER BY rowid ASC")
      .all(guildId)
      .map((r) => this._hydrateType(r));
  }

  /** الفئات المستخدمة فعليًا في السيرفر، بترتيب أول ظهور. */
  listCategories(guildId) {
    // نرتّب بـ MIN(rowid) لا بالطابع الزمني: عدة أنواع قد تُنشأ خلال نفس المللي ثانية
    // فيتساوى created_at بينها، بينما rowid دائمًا متسلسل وحصري بلا تعادل ممكن.
    const rows = this.db
      .prepare(
        `SELECT category, MIN(rowid) AS first_row FROM application_types
         WHERE guild_id = ? AND category IS NOT NULL AND enabled = 1
         GROUP BY category ORDER BY first_row ASC`
      )
      .all(guildId);
    return rows.map((r) => r.category);
  }

  /** أنواع التقديم ضمن فئة معيّنة، أو الأنواع بلا فئة إن مُرِّر null. */
  listByCategory(guildId, category) {
    const sql = category === null
      ? "SELECT * FROM application_types WHERE guild_id = ? AND category IS NULL ORDER BY rowid ASC"
      : "SELECT * FROM application_types WHERE guild_id = ? AND category = ? ORDER BY rowid ASC";
    const rows = category === null
      ? this.db.prepare(sql).all(guildId)
      : this.db.prepare(sql).all(guildId, category);
    return rows.map((r) => this._hydrateType(r));
  }

  countTypes(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM application_types WHERE guild_id = ?").get(guildId).c;
  }

  /** تعديل حقل واحد. أسماء الأعمدة على قائمة بيضاء صارمة. */
  updateType(id, field, value) {
    const statements = {
      label: "UPDATE application_types SET label = ? WHERE id = ?",
      description: "UPDATE application_types SET description = ? WHERE id = ?",
      emoji: "UPDATE application_types SET emoji = ? WHERE id = ?",
      review_channel_id: "UPDATE application_types SET review_channel_id = ? WHERE id = ?",
      accept_role_id: "UPDATE application_types SET accept_role_id = ? WHERE id = ?",
      remove_role_id: "UPDATE application_types SET remove_role_id = ? WHERE id = ?",
      accept_message: "UPDATE application_types SET accept_message = ? WHERE id = ?",
      reject_message: "UPDATE application_types SET reject_message = ? WHERE id = ?",
      collect_mode: "UPDATE application_types SET collect_mode = ? WHERE id = ?",
      cooldown_ms: "UPDATE application_types SET cooldown_ms = ? WHERE id = ?",
      enabled: "UPDATE application_types SET enabled = ? WHERE id = ?",
      category: "UPDATE application_types SET category = ? WHERE id = ?"
    };
    if (!statements[field]) throw new Error(`حقل غير مسموح: ${field}`);
    this.db.prepare(statements[field]).run(value, id);
    return this.getType(id);
  }

  setQuestions(id, questions) {
    this.db.prepare("UPDATE application_types SET questions = ? WHERE id = ?").run(JSON.stringify(questions || []), id);
    return this.getType(id);
  }

  deleteType(guildId, name) {
    return this.db.prepare("DELETE FROM application_types WHERE guild_id = ? AND name = ?").run(guildId, name).changes === 1;
  }

  // ---------------- الطلبات ----------------

  submit(data) {
    const number = this._submit(data);
    return this.getByNumber(data.guildId, number);
  }

  _hydrate(row) {
    return row ? { ...row, answers: JSON.parse(row.answers || "{}") } : null;
  }

  getByNumber(guildId, number) {
    return this._hydrate(this.db.prepare("SELECT * FROM applications WHERE guild_id = ? AND number = ?").get(guildId, number));
  }

  getByMessage(messageId) {
    return this._hydrate(this.db.prepare("SELECT * FROM applications WHERE message_id = ?").get(messageId));
  }

  setMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE applications SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  /**
   * تغيير الحالة ذرّي: ينجح مرة واحدة فقط.
   * لو ضغط إداريان قبول ورفض في نفس اللحظة، واحد فقط يمر.
   */
  decide(id, status, reviewerId, note) {
    return this.db
      .prepare(
        "UPDATE applications SET status = ?, reviewer_id = ?, reviewed_at = ?, note = ? WHERE id = ? AND status = 'pending'"
      )
      .run(status, reviewerId, Date.now(), note || null, id).changes === 1;
  }

  pendingForUser(guildId, typeId, userId) {
    return this._hydrate(
      this.db
        .prepare("SELECT * FROM applications WHERE guild_id = ? AND type_id = ? AND user_id = ? AND status = 'pending'")
        .get(guildId, typeId, userId)
    );
  }

  lastForUser(guildId, typeId, userId) {
    return this._hydrate(
      this.db
        .prepare("SELECT * FROM applications WHERE guild_id = ? AND type_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(guildId, typeId, userId)
    );
  }

  listPending(guildId, limit = 15) {
    return this.db
      .prepare("SELECT * FROM applications WHERE guild_id = ? AND status = 'pending' ORDER BY number ASC LIMIT ?")
      .all(guildId, limit)
      .map((r) => this._hydrate(r));
  }

  stats(guildId) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS pending,
           COALESCE(SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END),0) AS accepted,
           COALESCE(SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END),0) AS rejected
         FROM applications WHERE guild_id = ?`
      )
      .get(guildId);
  }
}

module.exports = ApplicationRepository;
