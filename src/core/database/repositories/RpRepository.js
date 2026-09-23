/**
 * أنظمة الحياة الواقعية: العناصر، الحقيبة، الوظائف، السرقات، السجن، المطلوبون.
 *
 * قاعدة حاكمة ضد التكرار (Anti-Duplication):
 * أي عملية تُنقص كمية أو رصيدًا تضع الشرط **داخل جملة UPDATE نفسها**،
 * فلا توجد فجوة بين الفحص والتنفيذ يمكن استغلالها بضغطتين متزامنتين.
 */
class RpRepository {
  constructor(db) {
    this.db = db;

    /** يضيف أو ينقص كمية عنصر ويسجّل الحركة، داخل معاملة واحدة. */
    this._adjust = db.transaction(({ guildId, userId, itemKey, delta, reason, actorId }) => {
      db.prepare(
        `INSERT INTO rp_inventory (guild_id, user_id, item_key, amount, updated_at) VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(guild_id, user_id, item_key) DO NOTHING`
      ).run(guildId, userId, itemKey, Date.now());

      if (delta < 0) {
        // الشرط `amount >= المطلوب` ذرّي: لو الكمية لا تكفي لا يتغيّر شيء
        const res = db
          .prepare("UPDATE rp_inventory SET amount = amount + ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND item_key = ? AND amount >= ?")
          .run(delta, Date.now(), guildId, userId, itemKey, -delta);
        if (res.changes !== 1) return { ok: false, reason: "insufficient" };
      } else {
        db.prepare("UPDATE rp_inventory SET amount = amount + ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND item_key = ?")
          .run(delta, Date.now(), guildId, userId, itemKey);
      }

      db.prepare(
        "INSERT INTO rp_inventory_log (guild_id, user_id, item_key, delta, reason, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(guildId, userId, itemKey, delta, reason || null, actorId || null, Date.now());

      const row = db.prepare("SELECT * FROM rp_inventory WHERE guild_id = ? AND user_id = ? AND item_key = ?").get(guildId, userId, itemKey);
      return { ok: true, amount: row.amount };
    });
  }

  // ---------------- كتالوج العناصر ----------------

  createItem(d) {
    this.db
      .prepare(
        `INSERT INTO rp_items (guild_id, key, label, emoji, sell_price, buy_price, category, illegal, stock, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(d.guildId, d.key, d.label, d.emoji || null, d.sellPrice || 0, d.buyPrice ?? null,
           d.category || null, d.illegal ? 1 : 0, d.stock ?? null, Date.now());
    return this.getItem(d.guildId, d.key);
  }

  getItem(guildId, key) {
    return this.db.prepare("SELECT * FROM rp_items WHERE guild_id = ? AND key = ?").get(guildId, key) || null;
  }

  listItems(guildId, { illegal = null, buyable = false } = {}) {
    let sql = "SELECT * FROM rp_items WHERE guild_id = ? AND enabled = 1";
    if (illegal !== null) sql += ` AND illegal = ${illegal ? 1 : 0}`;
    if (buyable) sql += " AND buy_price IS NOT NULL";
    return this.db.prepare(sql + " ORDER BY id ASC").all(guildId);
  }

  updateItem(guildId, key, field, value) {
    const statements = {
      label: "UPDATE rp_items SET label = ? WHERE guild_id = ? AND key = ?",
      emoji: "UPDATE rp_items SET emoji = ? WHERE guild_id = ? AND key = ?",
      sell_price: "UPDATE rp_items SET sell_price = ? WHERE guild_id = ? AND key = ?",
      buy_price: "UPDATE rp_items SET buy_price = ? WHERE guild_id = ? AND key = ?",
      illegal: "UPDATE rp_items SET illegal = ? WHERE guild_id = ? AND key = ?",
      stock: "UPDATE rp_items SET stock = ? WHERE guild_id = ? AND key = ?",
      enabled: "UPDATE rp_items SET enabled = ? WHERE guild_id = ? AND key = ?"
    };
    if (!statements[field]) throw new Error(`حقل غير مسموح: ${field}`);
    this.db.prepare(statements[field]).run(value, guildId, key);
    return this.getItem(guildId, key);
  }

  deleteItem(guildId, key) {
    return this.db.prepare("DELETE FROM rp_items WHERE guild_id = ? AND key = ?").run(guildId, key).changes === 1;
  }

  /** ينقص المخزون ذرّيًا. المخزون null يعني بلا حد. */
  consumeStock(guildId, key, qty) {
    const item = this.getItem(guildId, key);
    if (!item) return { ok: false, reason: "unknown" };
    if (item.stock === null) return { ok: true };
    const res = this.db
      .prepare("UPDATE rp_items SET stock = stock - ? WHERE guild_id = ? AND key = ? AND stock >= ?")
      .run(qty, guildId, key, qty);
    return res.changes === 1 ? { ok: true } : { ok: false, reason: "outOfStock" };
  }

  // ---------------- الحقيبة ----------------

  give(args) { return this._adjust({ ...args, delta: Math.abs(args.amount) }); }
  take(args) { return this._adjust({ ...args, delta: -Math.abs(args.amount) }); }

  amountOf(guildId, userId, itemKey) {
    const row = this.db.prepare("SELECT amount FROM rp_inventory WHERE guild_id = ? AND user_id = ? AND item_key = ?").get(guildId, userId, itemKey);
    return row?.amount || 0;
  }

  /** الحقيبة مرتّبة، مع بيانات العنصر — تُخفى العناصر ذات الكمية صفر. */
  inventory(guildId, userId) {
    return this.db
      .prepare(
        `SELECT inv.item_key, inv.amount, it.label, it.emoji, it.sell_price, it.illegal
         FROM rp_inventory inv LEFT JOIN rp_items it ON it.guild_id = inv.guild_id AND it.key = inv.item_key
         WHERE inv.guild_id = ? AND inv.user_id = ? AND inv.amount > 0
         ORDER BY inv.item_key ASC`
      )
      .all(guildId, userId);
  }

  inventoryLog(guildId, userId, limit = 15) {
    return this.db
      .prepare("SELECT * FROM rp_inventory_log WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?")
      .all(guildId, userId, limit);
  }

  // ---------------- الوظائف ----------------

  createJob(d) {
    this.db
      .prepare(
        `INSERT INTO rp_jobs (guild_id, key, label, emoji, role_id, image_url, reward_item, reward_min, reward_max, duration_ms, cooldown_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(d.guildId, d.key, d.label, d.emoji || null, d.roleId || null, d.imageUrl || null,
           d.rewardItem || null, d.rewardMin ?? 1, d.rewardMax ?? 3, d.durationMs ?? 60000, d.cooldownMs ?? 0, Date.now());
    return this.getJob(d.guildId, d.key);
  }

  getJob(guildId, key) {
    return this.db.prepare("SELECT * FROM rp_jobs WHERE guild_id = ? AND key = ?").get(guildId, key) || null;
  }

  listJobs(guildId) {
    return this.db.prepare("SELECT * FROM rp_jobs WHERE guild_id = ? AND enabled = 1 ORDER BY id ASC").all(guildId);
  }

  updateJob(guildId, key, field, value) {
    const statements = {
      label: "UPDATE rp_jobs SET label = ? WHERE guild_id = ? AND key = ?",
      emoji: "UPDATE rp_jobs SET emoji = ? WHERE guild_id = ? AND key = ?",
      role_id: "UPDATE rp_jobs SET role_id = ? WHERE guild_id = ? AND key = ?",
      image_url: "UPDATE rp_jobs SET image_url = ? WHERE guild_id = ? AND key = ?",
      reward_item: "UPDATE rp_jobs SET reward_item = ? WHERE guild_id = ? AND key = ?",
      reward_min: "UPDATE rp_jobs SET reward_min = ? WHERE guild_id = ? AND key = ?",
      reward_max: "UPDATE rp_jobs SET reward_max = ? WHERE guild_id = ? AND key = ?",
      duration_ms: "UPDATE rp_jobs SET duration_ms = ? WHERE guild_id = ? AND key = ?",
      cooldown_ms: "UPDATE rp_jobs SET cooldown_ms = ? WHERE guild_id = ? AND key = ?",
      enabled: "UPDATE rp_jobs SET enabled = ? WHERE guild_id = ? AND key = ?"
    };
    if (!statements[field]) throw new Error(`حقل غير مسموح: ${field}`);
    this.db.prepare(statements[field]).run(value, guildId, key);
    return this.getJob(guildId, key);
  }

  deleteJob(guildId, key) {
    return this.db.prepare("DELETE FROM rp_jobs WHERE guild_id = ? AND key = ?").run(guildId, key).changes === 1;
  }

  /** جلسة عمل مفتوحة (لم تُجمع مكافأتها بعد). */
  openSession(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM rp_job_sessions WHERE guild_id = ? AND user_id = ? AND collected_at IS NULL")
      .get(guildId, userId) || null;
  }

  /**
   * يبدأ جلسة عمل. يرجع null إن كانت هناك جلسة مفتوحة —
   * الفحص والإدراج داخل معاملة واحدة فلا تُفتح جلستان بضغطتين متزامنتين.
   */
  startSession({ guildId, userId, jobKey, durationMs }) {
    const start = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT 1 FROM rp_job_sessions WHERE guild_id = ? AND user_id = ? AND collected_at IS NULL")
        .get(guildId, userId);
      if (existing) return null;

      const now = Date.now();
      const info = this.db
        .prepare("INSERT INTO rp_job_sessions (guild_id, user_id, job_key, started_at, ends_at) VALUES (?, ?, ?, ?, ?)")
        .run(guildId, userId, jobKey, now, now + durationMs);
      return this.db.prepare("SELECT * FROM rp_job_sessions WHERE id = ?").get(info.lastInsertRowid);
    });
    return start();
  }

  /** يجمع مكافأة الجلسة ذرّيًا: تنجح مرة واحدة فقط. */
  collectSession(id, rewardItem, rewardQty) {
    return this.db
      .prepare("UPDATE rp_job_sessions SET collected_at = ?, reward_item = ?, reward_qty = ? WHERE id = ? AND collected_at IS NULL")
      .run(Date.now(), rewardItem, rewardQty, id).changes === 1;
  }

  lastSessionEnd(guildId, userId, jobKey) {
    const row = this.db
      .prepare("SELECT MAX(collected_at) AS last FROM rp_job_sessions WHERE guild_id = ? AND user_id = ? AND job_key = ? AND collected_at IS NOT NULL")
      .get(guildId, userId, jobKey);
    return row?.last || 0;
  }

  // ---------------- المواقع ----------------

  addLocation(d) {
    const info = this.db
      .prepare("INSERT INTO rp_locations (guild_id, job_key, name, image_url, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(d.guildId, d.jobKey, d.name, d.imageUrl || null, d.note || null, Date.now());
    return this.db.prepare("SELECT * FROM rp_locations WHERE id = ?").get(info.lastInsertRowid);
  }

  listLocations(guildId, jobKey) {
    return this.db.prepare("SELECT * FROM rp_locations WHERE guild_id = ? AND job_key = ? ORDER BY id ASC").all(guildId, jobKey);
  }

  deleteLocation(guildId, id) {
    return this.db.prepare("DELETE FROM rp_locations WHERE guild_id = ? AND id = ?").run(guildId, id).changes === 1;
  }

  // ---------------- السرقات ----------------

  createRobbery(d) {
    this.db
      .prepare(
        `INSERT INTO rp_robberies (guild_id, key, label, emoji, image_url, required_item, consume_item,
           reward_min, reward_max, success_percent, duration_ms, cooldown_ms, min_police, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(d.guildId, d.key, d.label, d.emoji || null, d.imageUrl || null, d.requiredItem || null,
           d.consumeItem ? 1 : 0, d.rewardMin ?? 100, d.rewardMax ?? 500, d.successPercent ?? 70,
           d.durationMs ?? 60000, d.cooldownMs ?? 600000, d.minPolice ?? 0, Date.now());
    return this.getRobbery(d.guildId, d.key);
  }

  getRobbery(guildId, key) {
    return this.db.prepare("SELECT * FROM rp_robberies WHERE guild_id = ? AND key = ?").get(guildId, key) || null;
  }

  listRobberies(guildId) {
    return this.db.prepare("SELECT * FROM rp_robberies WHERE guild_id = ? AND enabled = 1 ORDER BY id ASC").all(guildId);
  }

  updateRobbery(guildId, key, field, value) {
    const statements = {
      label: "UPDATE rp_robberies SET label = ? WHERE guild_id = ? AND key = ?",
      emoji: "UPDATE rp_robberies SET emoji = ? WHERE guild_id = ? AND key = ?",
      image_url: "UPDATE rp_robberies SET image_url = ? WHERE guild_id = ? AND key = ?",
      required_item: "UPDATE rp_robberies SET required_item = ? WHERE guild_id = ? AND key = ?",
      consume_item: "UPDATE rp_robberies SET consume_item = ? WHERE guild_id = ? AND key = ?",
      reward_min: "UPDATE rp_robberies SET reward_min = ? WHERE guild_id = ? AND key = ?",
      reward_max: "UPDATE rp_robberies SET reward_max = ? WHERE guild_id = ? AND key = ?",
      success_percent: "UPDATE rp_robberies SET success_percent = ? WHERE guild_id = ? AND key = ?",
      duration_ms: "UPDATE rp_robberies SET duration_ms = ? WHERE guild_id = ? AND key = ?",
      cooldown_ms: "UPDATE rp_robberies SET cooldown_ms = ? WHERE guild_id = ? AND key = ?",
      min_police: "UPDATE rp_robberies SET min_police = ? WHERE guild_id = ? AND key = ?",
      enabled: "UPDATE rp_robberies SET enabled = ? WHERE guild_id = ? AND key = ?"
    };
    if (!statements[field]) throw new Error(`حقل غير مسموح: ${field}`);
    this.db.prepare(statements[field]).run(value, guildId, key);
    return this.getRobbery(guildId, key);
  }

  deleteRobbery(guildId, key) {
    return this.db.prepare("DELETE FROM rp_robberies WHERE guild_id = ? AND key = ?").run(guildId, key).changes === 1;
  }

  openRobbery(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM rp_robbery_sessions WHERE guild_id = ? AND user_id = ? AND resolved_at IS NULL")
      .get(guildId, userId) || null;
  }

  startRobbery({ guildId, userId, robberyKey, durationMs }) {
    const start = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT 1 FROM rp_robbery_sessions WHERE guild_id = ? AND user_id = ? AND resolved_at IS NULL")
        .get(guildId, userId);
      if (existing) return null;

      const now = Date.now();
      const info = this.db
        .prepare("INSERT INTO rp_robbery_sessions (guild_id, user_id, robbery_key, started_at, ends_at) VALUES (?, ?, ?, ?, ?)")
        .run(guildId, userId, robberyKey, now, now + durationMs);
      return this.db.prepare("SELECT * FROM rp_robbery_sessions WHERE id = ?").get(info.lastInsertRowid);
    });
    return start();
  }

  resolveRobbery(id, success, reward) {
    return this.db
      .prepare("UPDATE rp_robbery_sessions SET resolved_at = ?, success = ?, reward = ? WHERE id = ? AND resolved_at IS NULL")
      .run(Date.now(), success ? 1 : 0, reward || 0, id).changes === 1;
  }

  lastRobberyEnd(guildId, userId, key) {
    const row = this.db
      .prepare("SELECT MAX(resolved_at) AS last FROM rp_robbery_sessions WHERE guild_id = ? AND user_id = ? AND robbery_key = ? AND resolved_at IS NOT NULL")
      .get(guildId, userId, key);
    return row?.last || 0;
  }

  // ---------------- السجن ----------------

  activeJail(guildId, userId) {
    const row = this.db
      .prepare("SELECT * FROM rp_jail WHERE guild_id = ? AND user_id = ? AND released_at IS NULL")
      .get(guildId, userId);
    return row ? { ...row, saved_roles: JSON.parse(row.saved_roles || "[]") } : null;
  }

  jail({ guildId, userId, reason, durationMs, savedRoles, jailedBy }) {
    const apply = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT 1 FROM rp_jail WHERE guild_id = ? AND user_id = ? AND released_at IS NULL")
        .get(guildId, userId);
      if (existing) return null;

      const now = Date.now();
      const info = this.db
        .prepare(
          `INSERT INTO rp_jail (guild_id, user_id, reason, duration_ms, started_at, ends_at, saved_roles, jailed_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(guildId, userId, reason || null, durationMs, now, now + durationMs, JSON.stringify(savedRoles || []), jailedBy, now);
      const row = this.db.prepare("SELECT * FROM rp_jail WHERE id = ?").get(info.lastInsertRowid);
      return { ...row, saved_roles: JSON.parse(row.saved_roles || "[]") };
    });
    return apply();
  }

  /** إطلاق سراح ذرّي: ينجح مرة واحدة فقط. */
  release(id, releasedBy) {
    return this.db
      .prepare("UPDATE rp_jail SET released_at = ?, released_by = ? WHERE id = ? AND released_at IS NULL")
      .run(Date.now(), releasedBy || null, id).changes === 1;
  }

  /** السجناء الذين انتهت مدتهم — يُستخدم عند الإقلاع أيضًا فتنجو الحالة من إعادة التشغيل. */
  dueJails(now = Date.now()) {
    return this.db
      .prepare("SELECT * FROM rp_jail WHERE released_at IS NULL AND ends_at <= ?")
      .all(now)
      .map((r) => ({ ...r, saved_roles: JSON.parse(r.saved_roles || "[]") }));
  }

  listJailed(guildId) {
    return this.db
      .prepare("SELECT * FROM rp_jail WHERE guild_id = ? AND released_at IS NULL ORDER BY ends_at ASC")
      .all(guildId)
      .map((r) => ({ ...r, saved_roles: JSON.parse(r.saved_roles || "[]") }));
  }

  jailHistory(guildId, userId, limit = 10) {
    return this.db
      .prepare("SELECT * FROM rp_jail WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?")
      .all(guildId, userId, limit);
  }

  // ---------------- المطلوبون ----------------

  addWanted({ guildId, userId, level, reason, addedBy }) {
    const info = this.db
      .prepare("INSERT INTO rp_wanted (guild_id, user_id, level, reason, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(guildId, userId, level || 1, reason || null, addedBy, Date.now());
    return this.db.prepare("SELECT * FROM rp_wanted WHERE id = ?").get(info.lastInsertRowid);
  }

  activeWanted(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM rp_wanted WHERE guild_id = ? AND user_id = ? AND cleared_at IS NULL ORDER BY id DESC")
      .all(guildId, userId);
  }

  clearWanted(guildId, userId, clearedBy) {
    return this.db
      .prepare("UPDATE rp_wanted SET cleared_at = ?, cleared_by = ? WHERE guild_id = ? AND user_id = ? AND cleared_at IS NULL")
      .run(Date.now(), clearedBy, guildId, userId).changes;
  }

  listWanted(guildId, limit = 25) {
    return this.db
      .prepare(
        `SELECT user_id, COUNT(*) AS count, MAX(level) AS level FROM rp_wanted
         WHERE guild_id = ? AND cleared_at IS NULL GROUP BY user_id ORDER BY level DESC, count DESC LIMIT ?`
      )
      .all(guildId, limit);
  }

  // ---------------- الشخصيات المتعددة ----------------

  /**
   * يضمن وجود الشخصية الأولى ويجعلها نشطة.
   * كل عضو يبدأ بشخصية واحدة تلقائيًا، فلا يحتاج إعدادًا مسبقًا.
   */
  ensureCharacter(guildId, userId) {
    const ensure = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM rp_characters WHERE guild_id = ? AND user_id = ? ORDER BY slot ASC")
        .all(guildId, userId);
      if (existing.length) {
        // لو ما فيه نشطة (بيانات قديمة)، نُفعّل الأولى
        if (!existing.some((c) => c.active)) {
          this.db.prepare("UPDATE rp_characters SET active = 1 WHERE id = ?").run(existing[0].id);
        }
        return this.activeCharacter(guildId, userId);
      }
      this.db
        .prepare("INSERT INTO rp_characters (guild_id, user_id, slot, active, created_at) VALUES (?, ?, 1, 1, ?)")
        .run(guildId, userId, Date.now());
      return this.activeCharacter(guildId, userId);
    });
    return ensure();
  }

  activeCharacter(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM rp_characters WHERE guild_id = ? AND user_id = ? AND active = 1")
      .get(guildId, userId) || null;
  }

  /** رقم الشخصية النشطة — يُستخدم لنسب الممتلكات لها. */
  activeSlot(guildId, userId) {
    return this.activeCharacter(guildId, userId)?.slot || 1;
  }

  listCharacters(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM rp_characters WHERE guild_id = ? AND user_id = ? ORDER BY slot ASC")
      .all(guildId, userId);
  }

  createCharacter(guildId, userId, slot, name) {
    this.db
      .prepare("INSERT INTO rp_characters (guild_id, user_id, slot, name, active, created_at) VALUES (?, ?, ?, ?, 0, ?)")
      .run(guildId, userId, slot, name || null, Date.now());
    return this.db.prepare("SELECT * FROM rp_characters WHERE guild_id = ? AND user_id = ? AND slot = ?").get(guildId, userId, slot);
  }

  /** التبديل ذرّي: شخصية نشطة واحدة فقط مهما تزامنت الضغطات. */
  switchCharacter(guildId, userId, slot) {
    const apply = this.db.transaction(() => {
      const target = this.db
        .prepare("SELECT * FROM rp_characters WHERE guild_id = ? AND user_id = ? AND slot = ?")
        .get(guildId, userId, slot);
      if (!target) return null;
      this.db.prepare("UPDATE rp_characters SET active = 0 WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
      this.db.prepare("UPDATE rp_characters SET active = 1 WHERE id = ?").run(target.id);
      return this.activeCharacter(guildId, userId);
    });
    return apply();
  }

  renameCharacter(guildId, userId, slot, name) {
    this.db
      .prepare("UPDATE rp_characters SET name = ? WHERE guild_id = ? AND user_id = ? AND slot = ?")
      .run(name, guildId, userId, slot);
    return this.db.prepare("SELECT * FROM rp_characters WHERE guild_id = ? AND user_id = ? AND slot = ?").get(guildId, userId, slot);
  }

  // ---------------- الممتلكات ----------------

  createProperty(d) {
    this.db
      .prepare(
        `INSERT INTO rp_properties (guild_id, key, label, kind, price, emoji, image_url, location, stock, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(d.guildId, d.key, d.label, d.kind || "vehicle", d.price, d.emoji || null,
           d.imageUrl || null, d.location || null, d.stock ?? null, Date.now());
    return this.getProperty(d.guildId, d.key);
  }

  getProperty(guildId, key) {
    return this.db.prepare("SELECT * FROM rp_properties WHERE guild_id = ? AND key = ?").get(guildId, key) || null;
  }

  listProperties(guildId, kind = null) {
    const sql = kind
      ? "SELECT * FROM rp_properties WHERE guild_id = ? AND kind = ? AND enabled = 1 ORDER BY price ASC"
      : "SELECT * FROM rp_properties WHERE guild_id = ? AND enabled = 1 ORDER BY kind ASC, price ASC";
    return kind ? this.db.prepare(sql).all(guildId, kind) : this.db.prepare(sql).all(guildId);
  }

  updateProperty(guildId, key, field, value) {
    const statements = {
      label: "UPDATE rp_properties SET label = ? WHERE guild_id = ? AND key = ?",
      kind: "UPDATE rp_properties SET kind = ? WHERE guild_id = ? AND key = ?",
      price: "UPDATE rp_properties SET price = ? WHERE guild_id = ? AND key = ?",
      emoji: "UPDATE rp_properties SET emoji = ? WHERE guild_id = ? AND key = ?",
      image_url: "UPDATE rp_properties SET image_url = ? WHERE guild_id = ? AND key = ?",
      location: "UPDATE rp_properties SET location = ? WHERE guild_id = ? AND key = ?",
      stock: "UPDATE rp_properties SET stock = ? WHERE guild_id = ? AND key = ?",
      enabled: "UPDATE rp_properties SET enabled = ? WHERE guild_id = ? AND key = ?"
    };
    if (!statements[field]) throw new Error(`حقل غير مسموح: ${field}`);
    this.db.prepare(statements[field]).run(value, guildId, key);
    return this.getProperty(guildId, key);
  }

  deleteProperty(guildId, key) {
    return this.db.prepare("DELETE FROM rp_properties WHERE guild_id = ? AND key = ?").run(guildId, key).changes === 1;
  }

  /** ينقص مخزون الممتلكات ذرّيًا. null = بلا حد. */
  consumePropertyStock(guildId, key) {
    const prop = this.getProperty(guildId, key);
    if (!prop) return { ok: false, reason: "unknown" };
    if (prop.stock === null) return { ok: true };
    const res = this.db
      .prepare("UPDATE rp_properties SET stock = stock - 1 WHERE guild_id = ? AND key = ? AND stock >= 1")
      .run(guildId, key);
    return res.changes === 1 ? { ok: true } : { ok: false, reason: "outOfStock" };
  }

  addOwnership(d) {
    const info = this.db
      .prepare(
        `INSERT INTO rp_ownership (guild_id, user_id, slot, property_key, plate, bought_at, bought_price)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(d.guildId, d.userId, d.slot || 1, d.propertyKey, d.plate || null, Date.now(), d.price);
    return this.db.prepare("SELECT * FROM rp_ownership WHERE id = ?").get(info.lastInsertRowid);
  }

  /** ممتلكات الشخصية النشطة، مع بيانات المعروض. */
  ownedBy(guildId, userId, slot, kind = null) {
    const sql = kind
      ? `SELECT o.*, p.label, p.kind, p.emoji, p.location FROM rp_ownership o
         LEFT JOIN rp_properties p ON p.guild_id = o.guild_id AND p.key = o.property_key
         WHERE o.guild_id = ? AND o.user_id = ? AND o.slot = ? AND o.confiscated = 0 AND p.kind = ?
         ORDER BY o.id ASC`
      : `SELECT o.*, p.label, p.kind, p.emoji, p.location FROM rp_ownership o
         LEFT JOIN rp_properties p ON p.guild_id = o.guild_id AND p.key = o.property_key
         WHERE o.guild_id = ? AND o.user_id = ? AND o.slot = ? AND o.confiscated = 0
         ORDER BY o.id ASC`;
    return kind
      ? this.db.prepare(sql).all(guildId, userId, slot, kind)
      : this.db.prepare(sql).all(guildId, userId, slot);
  }

  ownsProperty(guildId, userId, slot, propertyKey) {
    return !!this.db
      .prepare("SELECT 1 FROM rp_ownership WHERE guild_id = ? AND user_id = ? AND slot = ? AND property_key = ? AND confiscated = 0")
      .get(guildId, userId, slot, propertyKey);
  }

  /** مصادرة ممتلك ذرّيًا: تنجح مرة واحدة. */
  confiscateOwnership(id) {
    return this.db
      .prepare("UPDATE rp_ownership SET confiscated = 1 WHERE id = ? AND confiscated = 0")
      .run(id).changes === 1;
  }

  // ---------------- الاعتقال ----------------

  activeCuff(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM rp_cuffs WHERE guild_id = ? AND user_id = ? AND released_at IS NULL")
      .get(guildId, userId) || null;
  }

  /** الكلبشة ذرّية: لا يُكلبش المكلبش مرتين. */
  cuff({ guildId, userId, officerId, reason }) {
    const apply = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT 1 FROM rp_cuffs WHERE guild_id = ? AND user_id = ? AND released_at IS NULL")
        .get(guildId, userId);
      if (existing) return null;
      const info = this.db
        .prepare("INSERT INTO rp_cuffs (guild_id, user_id, officer_id, reason, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(guildId, userId, officerId, reason || null, Date.now());
      return this.db.prepare("SELECT * FROM rp_cuffs WHERE id = ?").get(info.lastInsertRowid);
    });
    return apply();
  }

  uncuff(guildId, userId, releasedBy) {
    return this.db
      .prepare("UPDATE rp_cuffs SET released_at = ?, released_by = ? WHERE guild_id = ? AND user_id = ? AND released_at IS NULL")
      .run(Date.now(), releasedBy, guildId, userId).changes === 1;
  }

  listCuffed(guildId) {
    return this.db
      .prepare("SELECT * FROM rp_cuffs WHERE guild_id = ? AND released_at IS NULL ORDER BY created_at ASC")
      .all(guildId);
  }

  /** يفكّ كل الكلبشات — للطوارئ أو نهاية المناوبة. */
  uncuffAll(guildId, releasedBy) {
    return this.db
      .prepare("UPDATE rp_cuffs SET released_at = ?, released_by = ? WHERE guild_id = ? AND released_at IS NULL")
      .run(Date.now(), releasedBy, guildId).changes;
  }

  logSeizure(d) {
    const info = this.db
      .prepare("INSERT INTO rp_seizures (guild_id, user_id, officer_id, item_key, amount, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(d.guildId, d.userId, d.officerId, d.itemKey, d.amount, d.reason || null, Date.now());
    return this.db.prepare("SELECT * FROM rp_seizures WHERE id = ?").get(info.lastInsertRowid);
  }

  seizures(guildId, userId, limit = 15) {
    return this.db
      .prepare("SELECT * FROM rp_seizures WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?")
      .all(guildId, userId, limit);
  }
}

module.exports = RpRepository;
