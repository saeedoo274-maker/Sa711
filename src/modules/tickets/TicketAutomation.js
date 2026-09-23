const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { buildEmbed, timestamp, formatDuration, truncate } = require("../../core/utils/helpers");

const STAR_LABELS = ["", "سيئ جدًا", "سيئ", "مقبول", "جيد", "ممتاز"];
const STAR_COLORS = ["neutral", "danger", "danger", "warning", "success", "success"];

/**
 * أتمتة التذاكر: الإغلاق عند الخمول، وطلب التقييم، ونسخ المحادثة بصيغة HTML.
 *
 * الإغلاق التلقائي على مرحلتين عمدًا: تنبيه أولًا ثم إجراء.
 * إغلاق تذكرة نشطة بالخطأ أسوأ من تركها مفتوحة ساعة إضافية.
 */
class TicketAutomation {
  constructor(app) {
    this.app = app;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), 5 * 60_000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  settings(guildId) {
    const cfg = this.app.guildConfig.value(guildId, "tickets") || {};
    return {
      idleHours: cfg.autoCloseIdleHours || 0,
      graceHours: cfg.autoCloseGraceHours || 12,
      action: cfg.autoCloseAction || "lock",
      maxClaims: cfg.maxClaimsPerStaff || 0,
      ratingEnabled: !!cfg.ratingEnabled,
      ratingChannelId: cfg.ratingChannelId || null
    };
  }

  /** فحص دوري لكل التذاكر الخاملة. */
  async tick() {
    const byGuild = new Map();

    for (const guild of this.app.client.guilds.cache.values()) {
      const settings = this.settings(guild.id);
      if (!settings.idleHours) continue;
      byGuild.set(guild.id, { guild, settings });
    }
    if (!byGuild.size) return;

    // مرحلة التنبيه
    for (const [guildId, { guild, settings }] of byGuild) {
      const idleMs = settings.idleHours * 3_600_000;
      for (const ticket of this.app.tickets.idleUnwarned(idleMs)) {
        if (ticket.guild_id !== guildId) continue;
        await this._warn(guild, ticket, settings).catch(() => {});
      }
    }

    // مرحلة التنفيذ
    for (const [guildId, { guild, settings }] of byGuild) {
      const graceMs = settings.graceHours * 3_600_000;
      for (const ticket of this.app.tickets.idleWarned(graceMs)) {
        if (ticket.guild_id !== guildId) continue;
        await this._execute(guild, ticket, settings).catch(() => {});
      }
    }
  }

  async _warn(guild, ticket, settings) {
    const channel = await this.app.client.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      // القناة محذوفة يدويًا — ننظّف السجل بدل محاولة تنبيهها كل خمس دقائق
      this.app.tickets.delete(ticket.channel_id);
      return;
    }
    if (!this.app.tickets.markWarned(ticket.channel_id)) return;

    const actionLabel = settings.action === "delete" ? "ستُحذف" : "ستُقفل";
    await channel
      .send({
        content: `<@${ticket.owner_id}>`,
        embeds: [
          buildEmbed({
            title: "⏳ تنبيه خمول",
            description:
              `ما فيه نشاط في هذه التذكرة منذ **${formatDuration(settings.idleHours * 3_600_000)}**.\n` +
              `لو ما وصل رد خلال **${formatDuration(settings.graceHours * 3_600_000)}**، ${actionLabel} تلقائيًا.\n\n` +
              `أي رسالة هنا تُلغي هذا التنبيه.`,
            color: this.app.config.color("warning")
          })
        ],
        allowedMentions: { parse: ["users"] }
      })
      .catch(() => {});
  }

  async _execute(guild, ticket, settings) {
    const channel = await this.app.client.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      this.app.tickets.delete(ticket.channel_id);
      return;
    }

    if (settings.action === "delete") {
      await this.archiveAndDelete(guild, channel, ticket, "إغلاق تلقائي بسبب الخمول");
      return;
    }

    if (!this.app.tickets.close(ticket.channel_id, this.app.client.user.id)) return;
    await this.app.ticketService.closeChannel(channel, ticket);

    const fresh = this.app.tickets.getByChannel(ticket.channel_id);
    await channel
      .send({
        embeds: [
          buildEmbed({
            description: "🔒 أُغلقت التذكرة تلقائيًا بسبب الخمول.",
            color: this.app.config.color("neutral")
          })
        ],
        components: this.app.ticketService.buildButtons(fresh)
      })
      .catch(() => {});

    await this.requestRating(guild, fresh);
  }

  /** يؤرشف المحادثة ثم يحذف القناة. */
  async archiveAndDelete(guild, channel, ticket, reason) {
    const archiveId = this.app.guildConfig.value(guild.id, "tickets.transcriptChannelId");
    if (archiveId) {
      const target = await this.app.client.channels.fetch(archiveId).catch(() => null);
      if (target?.isTextBased()) {
        const file = await this.transcriptHTML(channel, ticket).catch(() => null);
        if (file) {
          await target
            .send({
              embeds: [
                buildEmbed({
                  title: `📄 أرشيف التذكرة ${ticket.number ? `#${String(ticket.number).padStart(4, "0")}` : ""}`,
                  color: this.app.config.color("neutral"),
                  fields: [
                    { name: "صاحب التذكرة", value: `<@${ticket.owner_id}>`, inline: true },
                    { name: "المستلم", value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : "—", inline: true },
                    { name: "السبب", value: reason, inline: true }
                  ]
                })
              ],
              files: [file]
            })
            .catch(() => {});
        }
      }
    }

    await this.requestRating(guild, ticket);
    this.app.tickets.delete(ticket.channel_id);
    await channel.delete(reason).catch(() => {});
  }

  /** يرسل طلب التقييم لصاحب التذكرة في الخاص. */
  async requestRating(guild, ticket) {
    const settings = this.settings(guild.id);
    if (!settings.ratingEnabled || !ticket.claimed_by) return;
    if (this.app.tickets.hasRated(guild.id, ticket.id, ticket.owner_id)) return;

    const user = await this.app.client.users.fetch(ticket.owner_id).catch(() => null);
    if (!user) return;

    // البيانات تُضمَّن في معرّف الزر نفسه: التذكرة تُحذف من القاعدة فور الإغلاق،
    // والرسالة تبقى في خاص العضو قد يضغطها بعد ساعات — فلا يصح الاعتماد على صف موجود.
    // الصيغة: trate:<ticketId>:<action>:<guildId>:<staffId>:<number>
    const ctx = `${guild.id}:${ticket.claimed_by}:${ticket.number || 0}`;

    const rows = [
      new ActionRowBuilder().addComponents(
        ...[1, 2, 3, 4, 5].map((n) =>
          new ButtonBuilder()
            .setCustomId(`trate:${ticket.id}:${n}:${ctx}`)
            .setLabel("⭐".repeat(n))
            .setStyle(n >= 4 ? ButtonStyle.Success : n === 3 ? ButtonStyle.Secondary : ButtonStyle.Danger)
        )
      )
    ];

    await user
      .send({
        embeds: [
          buildEmbed({
            title: "⭐ قيّم خدمتك",
            description:
              `انتهت تذكرتك في **${guild.name}**.\n` +
              `كيف كانت خدمة <@${ticket.claimed_by}>؟\n\n` +
              `اضغط عدد النجوم التي تستحقها.`,
            color: this.app.config.color("primary"),
            footer: ticket.number ? `تذكرة #${String(ticket.number).padStart(4, "0")}` : undefined
          })
        ],
        components: rows
      })
      .catch(() => {});
  }

  /**
   * نسخة HTML من المحادثة.
   * مبنية يدويًا بلا مكتبات خارجية، وتدعم العربية من اليمين لليسار.
   */
  async transcriptHTML(channel, ticket) {
    const messages = [];
    let lastId = null;
    for (let i = 0; i < 5; i++) {
      const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) }).catch(() => null);
      if (!batch || batch.size === 0) break;
      messages.push(...batch.values());
      lastId = batch.last().id;
      if (batch.size < 100) break;
    }

    const escape = (text) =>
      String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const rows = messages
      .reverse()
      .map((m) => {
        const time = new Date(m.createdTimestamp).toLocaleString("ar", { hour12: false });
        const attachments = m.attachments.size
          ? `<div class="att">${[...m.attachments.values()]
              .map((a) =>
                /^image\//i.test(a.contentType || "")
                  ? `<a href="${escape(a.url)}" target="_blank"><img src="${escape(a.url)}" alt=""></a>`
                  : `<a href="${escape(a.url)}" target="_blank">📎 ${escape(a.name)}</a>`
              )
              .join("")}</div>`
          : "";
        const embeds = m.embeds.length
          ? m.embeds
              .map(
                (e) =>
                  `<div class="embed"><b>${escape(e.title || "")}</b><div>${escape(e.description || "").replace(/\n/g, "<br>")}</div></div>`
              )
              .join("")
          : "";

        return `<div class="msg">
  <div class="head"><span class="author">${escape(m.author.tag)}</span><span class="time">${escape(time)}</span></div>
  <div class="body">${escape(m.content).replace(/\n/g, "<br>")}</div>
  ${embeds}${attachments}
</div>`;
      })
      .join("\n");

    const number = ticket.number ? `#${String(ticket.number).padStart(4, "0")}` : channel.name;
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>نسخة التذكرة ${escape(number)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#1a1b1e; color:#e8e8ea;
         font-family:"Segoe UI","Noto Naskh Arabic",Tahoma,sans-serif; line-height:1.7; }
  .wrap { max-width:900px; margin:0 auto; }
  .info { background:#26272b; border-radius:12px; padding:20px; margin-bottom:24px; border:1px solid #35363b; }
  .info h1 { margin:0 0 12px; font-size:20px; }
  .info div { color:#a8a9ad; font-size:14px; }
  .msg { background:#232428; border-radius:10px; padding:14px 16px; margin-bottom:10px; border:1px solid #2e2f34; }
  .head { display:flex; justify-content:space-between; margin-bottom:6px; font-size:13px; }
  .author { font-weight:600; color:#a5b4fc; }
  .time { color:#7a7b80; }
  .body { white-space:pre-wrap; word-break:break-word; }
  .embed { border-right:3px solid #5865f2; padding:8px 12px; margin-top:8px; background:#1e1f23; border-radius:6px; }
  .att { margin-top:8px; }
  .att img { max-width:320px; border-radius:8px; display:block; margin-top:6px; }
  .att a { color:#8ab4f8; }
  .foot { text-align:center; color:#6b6c71; font-size:12px; margin-top:24px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="info">
    <h1>📄 نسخة محادثة التذكرة ${escape(number)}</h1>
    <div>القناة: ${escape(channel.name)}</div>
    <div>صاحب التذكرة: ${escape(ticket.owner_id)}</div>
    <div>المستلم: ${escape(ticket.claimed_by || "لا يوجد")}</div>
    <div>تاريخ الإنشاء: ${escape(new Date(ticket.created_at).toLocaleString("ar", { hour12: false }))}</div>
    <div>عدد الرسائل: ${messages.length}</div>
  </div>
  ${rows || '<div class="msg"><div class="body">لا توجد رسائل.</div></div>'}
  <div class="foot">أُنشئت ${escape(new Date().toLocaleString("ar", { hour12: false }))}</div>
</div>
</body>
</html>`;

    return new AttachmentBuilder(Buffer.from(html, "utf8"), {
      name: `transcript-${String(ticket.number || channel.name)}.html`
    });
  }

  ratingEmbed(guild, { userId, staffId, stars, note, ticketNumber }) {
    return buildEmbed({
      title: "⭐ تقييم جديد",
      description: `${"⭐".repeat(stars)}${"☆".repeat(5 - stars)}  **${STAR_LABELS[stars]}**`,
      color: this.app.config.color(STAR_COLORS[stars]),
      fields: [
        { name: "العضو", value: `<@${userId}>`, inline: true },
        { name: "الإداري", value: staffId ? `<@${staffId}>` : "—", inline: true },
        { name: "النجوم", value: `\`${stars}/5\``, inline: true },
        ...(ticketNumber ? [{ name: "التذكرة", value: `#${String(ticketNumber).padStart(4, "0")}`, inline: true }] : []),
        ...(note ? [{ name: "ملاحظة", value: truncate(note, 1000) }] : [])
      ]
    });
  }
}

module.exports = TicketAutomation;
module.exports.STAR_LABELS = STAR_LABELS;
