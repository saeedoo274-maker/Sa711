class GiveawayRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const info = this.db
      .prepare(
        `INSERT INTO giveaways
          (guild_id, channel_id, message_id, prize, winners_count, host_id, required_role_id,
           bonus_role_id, bonus_entries, min_account_age_ms, ends_at, status, created_at)
         VALUES (@guildId, @channelId, @messageId, @prize, @winnersCount, @hostId, @requiredRoleId,
                 @bonusRoleId, @bonusEntries, @minAccountAgeMs, @endsAt, 'active', @createdAt)`
      )
      .run({
        guildId: data.guildId,
        channelId: data.channelId,
        messageId: data.messageId || null,
        prize: data.prize,
        winnersCount: data.winnersCount || 1,
        hostId: data.hostId,
        requiredRoleId: data.requiredRoleId || null,
        bonusRoleId: data.bonusRoleId || null,
        bonusEntries: data.bonusEntries || 1,
        minAccountAgeMs: data.minAccountAgeMs || null,
        endsAt: data.endsAt,
        createdAt: Date.now()
      });
    return this.getById(info.lastInsertRowid);
  }

  getById(id) {
    return this.db.prepare("SELECT * FROM giveaways WHERE id = ?").get(id) || null;
  }

  getByMessage(messageId) {
    return this.db.prepare("SELECT * FROM giveaways WHERE message_id = ?").get(messageId) || null;
  }

  setMessage(id, messageId) {
    this.db.prepare("UPDATE giveaways SET message_id = ? WHERE id = ?").run(messageId, id);
  }

  /** دخول السحب — INSERT واحد يمنع الدخول المزدوج بحكم المفتاح الأساسي. */
  enter(giveawayId, userId, entries = 1) {
    const res = this.db
      .prepare("INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id, entries, joined_at) VALUES (?, ?, ?, ?)")
      .run(giveawayId, userId, entries, Date.now());
    return res.changes === 1;
  }

  leave(giveawayId, userId) {
    return this.db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?").run(giveawayId, userId).changes === 1;
  }

  hasEntered(giveawayId, userId) {
    return !!this.db.prepare("SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?").get(giveawayId, userId);
  }

  entries(giveawayId) {
    return this.db.prepare("SELECT * FROM giveaway_entries WHERE giveaway_id = ?").all(giveawayId);
  }

  entryCount(giveawayId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM giveaway_entries WHERE giveaway_id = ?").get(giveawayId).c;
  }

  /**
   * إنهاء السحب — ذرّي.
   * يُرجع true لمرة واحدة فقط مهما تعدد المستدعون (المؤقّت + زر الإنهاء اليدوي معًا)،
   * وبذلك يستحيل سحب فائزين مرتين لنفس السحب.
   */
  markEnded(id) {
    return this.db.prepare("UPDATE giveaways SET status = 'ended' WHERE id = ? AND status = 'active'").run(id).changes === 1;
  }

  cancel(id) {
    return this.db.prepare("UPDATE giveaways SET status = 'cancelled' WHERE id = ? AND status = 'active'").run(id).changes === 1;
  }

  saveWinners(id, userIds) {
    const now = Date.now();
    const insert = this.db.transaction(() => {
      for (const userId of userIds) {
        this.db.prepare("INSERT OR IGNORE INTO giveaway_winners (giveaway_id, user_id, drawn_at) VALUES (?, ?, ?)").run(id, userId, now);
      }
    });
    insert();
  }

  winners(id) {
    return this.db.prepare("SELECT * FROM giveaway_winners WHERE giveaway_id = ? ORDER BY drawn_at DESC").all(id);
  }

  listActive(guildId = null) {
    return guildId
      ? this.db.prepare("SELECT * FROM giveaways WHERE status = 'active' AND guild_id = ?").all(guildId)
      : this.db.prepare("SELECT * FROM giveaways WHERE status = 'active'").all();
  }

  listDue(now = Date.now()) {
    return this.db.prepare("SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= ?").all(now);
  }
}

module.exports = GiveawayRepository;
