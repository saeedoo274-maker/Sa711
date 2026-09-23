class StaffRepository {
  constructor(db) {
    this.db = db;
  }

  /** كل رتب الطاقم مرتّبة من الأدنى إلى الأعلى. */
  list(guildId) {
    return this.db.prepare("SELECT * FROM staff_ranks WHERE guild_id = ? ORDER BY position ASC").all(guildId);
  }

  getByRole(guildId, roleId) {
    return this.db.prepare("SELECT * FROM staff_ranks WHERE guild_id = ? AND role_id = ?").get(guildId, roleId) || null;
  }

  /** يضيف رتبة في نهاية السلم. الترتيب يُحسب داخل معاملة لمنع تكرار الموضع. */
  add(guildId, roleId, name, level = 1) {
    const insert = this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(position), 0) AS p FROM staff_ranks WHERE guild_id = ?")
        .get(guildId);
      this.db
        .prepare(
          `INSERT INTO staff_ranks (guild_id, role_id, name, position, level, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(guild_id, role_id) DO UPDATE SET name = excluded.name, level = excluded.level`
        )
        .run(guildId, roleId, name, row.p + 1, level, Date.now());
      return row.p + 1;
    });
    return insert();
  }

  remove(guildId, roleId) {
    const res = this.db.prepare("DELETE FROM staff_ranks WHERE guild_id = ? AND role_id = ?").run(guildId, roleId);
    return res.changes === 1;
  }

  /** يعيد ترتيب السلم كاملًا من مصفوفة role IDs مرتبة تصاعديًا. */
  reorder(guildId, orderedRoleIds) {
    const apply = this.db.transaction(() => {
      orderedRoleIds.forEach((roleId, index) => {
        this.db
          .prepare("UPDATE staff_ranks SET position = ? WHERE guild_id = ? AND role_id = ?")
          .run(index + 1, guildId, roleId);
      });
    });
    apply();
  }

  /** أعلى رتبة طاقم يملكها العضو، أو null. */
  highestForMember(guildId, roleIds) {
    const ranks = this.list(guildId);
    let highest = null;
    for (const rank of ranks) {
      if (roleIds.includes(rank.role_id)) {
        if (!highest || rank.position > highest.position) highest = rank;
      }
    }
    return highest;
  }

  /**
   * الرتبة التالية في السلم (للترقية) أو السابقة (للتنزيل).
   * الاستعلامان مكتوبان كاملين مسبقًا بدل بناء SQL من متغيّر،
   * فلا يوجد أي مسار يسمح بتسرّب نص خارجي إلى الاستعلام.
   */
  neighbour(guildId, position, direction) {
    const query =
      direction === "up"
        ? "SELECT * FROM staff_ranks WHERE guild_id = ? AND position > ? ORDER BY position ASC LIMIT 1"
        : "SELECT * FROM staff_ranks WHERE guild_id = ? AND position < ? ORDER BY position DESC LIMIT 1";
    return this.db.prepare(query).get(guildId, position) || null;
  }
}

module.exports = StaffRepository;
