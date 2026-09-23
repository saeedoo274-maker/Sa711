const { buildEmbed, timestamp, truncate } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");

/**
 * الفواتير: توثيق يدوي لعمليات البيع، لكل بائع في السيرفر.
 *
 * تُبنى الفاتورة بـ Components v2 (حاوية موحّدة بدل إمبيد تقليدي) لتُقرأ بشكل
 * أنظف داخل قناة الفواتير، مع نفس ضمانات الترقيم الذرّي المستخدمة في القضايا والتذاكر.
 */
class InvoiceService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "invoices") || {};
  }

  enabled(guildId) {
    const cfg = this.config(guildId);
    return !!cfg.enabled && !!cfg.channelId;
  }

  /** ينشئ فاتورة وينشرها في قناة الفواتير المحددة، إن وُجدت. */
  async create({ guild, seller, clientName, product, amount, method }) {
    const record = this.app.invoices.create({
      guildId: guild.id,
      sellerId: seller.id,
      clientName: truncate(clientName, 200),
      product: truncate(product, 200),
      amount,
      method: truncate(method, 100)
    });

    const channelId = this.config(guild.id).channelId;
    if (!channelId) return { ok: true, record, posted: false };

    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return { ok: true, record, posted: false };

    const payload = containerPayload({
      text:
        `**فاتورة #${record.number}**\n\n` +
        `**البائع:** <@${record.seller_id}>\n` +
        `**العميل:** ${record.client_name}\n` +
        `**المنتج:** ${record.product}\n` +
        `**المبلغ:** ${this.app.economyService.format(guild.id, record.amount)}\n` +
        `**طريقة الدفع:** ${record.method}\n\n` +
        `${timestamp(record.created_at, "R")}`,
      color: this.app.config.color("success")
    });

    const message = await channel.send(payload).catch(() => null);
    if (message) this.app.invoices.setMessage(guild.id, record.number, channel.id, message.id);

    return { ok: true, record, posted: !!message };
  }

  listEmbed(guild, seller, rows) {
    if (!rows.length) {
      return buildEmbed({ description: "لا توجد فواتير مسجّلة لهذا البائع بعد.", color: this.app.config.color("neutral") });
    }
    return buildEmbed({
      title: `🧾 فواتير ${seller.username || seller.id}`,
      description: rows
        .map((r) => `**#${r.number}** — ${r.product} • ${this.app.economyService.format(guild.id, r.amount)} • ${timestamp(r.created_at, "R")}`)
        .join("\n"),
      color: this.app.config.color("primary")
    });
  }

  statsEmbed(guild, seller, totals) {
    return buildEmbed({
      title: `📊 إجمالي مبيعات ${seller.username || seller.id}`,
      color: this.app.config.color("primary"),
      fields: [
        { name: "عدد الفواتير", value: `\`${totals.count}\``, inline: true },
        { name: "الإجمالي", value: this.app.economyService.format(guild.id, totals.total), inline: true }
      ]
    });
  }
}

module.exports = InvoiceService;
