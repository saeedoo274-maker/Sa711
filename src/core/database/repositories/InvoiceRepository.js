/**
 * الفواتير: سجل بيع يدوي يوثّقه البائع لكل عملية.
 * الترقيم متسلسل ومستقل لكل سيرفر، بنفس آلية القضايا الإدارية.
 */
class InvoiceRepository {
  constructor(db) {
    this.db = db;

    /**
     * إنشاء فاتورة برقم متسلسل داخل معاملة واحدة،
     * فلا يحصل بائعان على نفس رقم الفاتورة عند التنفيذ المتزامن.
     */
    this._create = db.transaction((data) => {
      db.prepare(
        `INSERT INTO invoice_counters (guild_id, last_number) VALUES (?, 0)
         ON CONFLICT(guild_id) DO NOTHING`
      ).run(data.guildId);

      db.prepare("UPDATE invoice_counters SET last_number = last_number + 1 WHERE guild_id = ?").run(data.guildId);
      const { last_number: number } = db
        .prepare("SELECT last_number FROM invoice_counters WHERE guild_id = ?")
        .get(data.guildId);

      db.prepare(
        `INSERT INTO invoices (guild_id, number, seller_id, client_name, product, amount, method, created_at)
         VALUES (@guildId, @number, @sellerId, @clientName, @product, @amount, @method, @createdAt)`
      ).run({
        guildId: data.guildId,
        number,
        sellerId: data.sellerId,
        clientName: data.clientName,
        product: data.product,
        amount: data.amount,
        method: data.method,
        createdAt: Date.now()
      });

      return number;
    });
  }

  create(data) {
    const number = this._create(data);
    return this.getByNumber(data.guildId, number);
  }

  getByNumber(guildId, number) {
    return this.db.prepare("SELECT * FROM invoices WHERE guild_id = ? AND number = ?").get(guildId, number) || null;
  }

  setMessage(guildId, number, channelId, messageId) {
    this.db
      .prepare("UPDATE invoices SET channel_id = ?, message_id = ? WHERE guild_id = ? AND number = ?")
      .run(channelId, messageId, guildId, number);
  }

  listBySeller(guildId, sellerId, limit = 15) {
    return this.db
      .prepare("SELECT * FROM invoices WHERE guild_id = ? AND seller_id = ? ORDER BY number DESC LIMIT ?")
      .all(guildId, sellerId, limit);
  }

  /** إجمالي مبيعات بائع خلال فترة، لتقارير الأداء. */
  totalBySeller(guildId, sellerId, sinceMs = null) {
    if (sinceMs) {
      return this.db
        .prepare("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM invoices WHERE guild_id = ? AND seller_id = ? AND created_at >= ?")
        .get(guildId, sellerId, Date.now() - sinceMs);
    }
    return this.db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM invoices WHERE guild_id = ? AND seller_id = ?")
      .get(guildId, sellerId);
  }

  stats(guildId) {
    return this.db
      .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM invoices WHERE guild_id = ?")
      .get(guildId);
  }
}

module.exports = InvoiceRepository;
