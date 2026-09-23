const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { formatDuration, timestamp } = require("../../core/utils/helpers");
const { REPORT_KINDS } = require("./MilitaryService");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * تفاعلات النظام العسكري. البادئة `mil:`.
 * كل إجراء يُعيد فحص الحالة من القاعدة، فضغطتان متزامنتان لا تفتحان نوبتين
 * ولا تستلمان نفس البلاغ مرتين.
 */
module.exports = {
  prefix: "mil",

  async handle(interaction, app) {
    const parts = interaction.customId.split(":");
    const group = parts[1];
    const action = parts[2];

    if (group === "duty") return duty(interaction, app, action);
    if (group === "report") return report(interaction, app, action, parts[3]);
    return null;
  }
};

// ---------------- مركز العمليات ----------------

async function duty(interaction, app, action) {
  const svc = app.militaryService;
  const guild = interaction.guild;

  if (!svc.enabled(guild.id)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} النظام العسكري معطّل في هذا السيرفر.`, flags: 64 });
  }

  if (action === "list") {
    const shifts = app.military.activeShifts(guild.id);
    return safeReply(interaction, { embeds: [svc.activeShiftsEmbed(guild, shifts)], flags: 64 });
  }

  // الدخول والخروج يتطلبان الرتبة العسكرية إن حُدِّدت
  if (!svc.isMilitary(guild.id, interaction.member)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذا الزر مخصص للعسكريين فقط.`, flags: 64 });
  }

  if (action === "in") {
    const shift = app.military.startShift(guild.id, interaction.user.id);
    if (!shift) {
      const open = app.military.openShift(guild.id, interaction.user.id);
      return safeReply(interaction, {
        content: `${app.config.emoji("warning")} أنت مباشر بالفعل منذ ${timestamp(open.started_at, "R")}.`,
        flags: 64
      });
    }

    const roleResult = await svc.applyDutyRole(guild, interaction.member, true);
    await svc.logDuty(guild, { member: interaction.member, shift, kind: "in" });
    await svc.refreshOperationsPanel(guild.id);

    const points = app.military.getPoints(guild.id, interaction.user.id).points;
    return safeReply(interaction, {
      content:
        `${app.config.emoji("success")} تم تسجيل دخولك للدوام.\n` +
        `نقاطك الحالية: **${points}**` +
        (roleResult.ok ? "" : `\n${app.config.emoji("warning")} تعذّر منحك رتبة الدوام — راجع الإدارة.`),
      flags: 64
    });
  }

  if (action === "out") {
    const shift = app.military.endShift(guild.id, interaction.user.id);
    if (!shift) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} أنت غير مباشر أصلًا.`, flags: 64 });
    }

    await svc.applyDutyRole(guild, interaction.member, false);
    await svc.logDuty(guild, { member: interaction.member, shift, kind: "out" });
    await svc.refreshOperationsPanel(guild.id);

    return safeReply(interaction, {
      content: `${app.config.emoji("success")} تم تسجيل خروجك.\nمدة دوامك: **${formatDuration(shift.duration_ms)}**`,
      flags: 64
    });
  }

  return null;
}

// ---------------- البلاغات ----------------

async function report(interaction, app, action, idRaw) {
  const svc = app.militaryService;
  const guild = interaction.guild;

  if (action === "open") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("mil:report:kind")
      .setPlaceholder("اختر نوع البلاغ")
      .addOptions(REPORT_KINDS.map((k) => ({ label: k.label, value: k.value, emoji: k.emoji })));

    return safeReply(interaction, {
      content: "اختر نوع البلاغ لفتح النموذج:",
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: 64
    });
  }

  if (action === "kind") {
    const kind = interaction.values[0];
    const modal = new ModalBuilder().setCustomId(`mil:report:submit:${encodeURIComponent(kind)}`).setTitle(`بلاغ — ${kind}`.slice(0, 45));
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("details").setLabel("تفاصيل البلاغ").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("location").setLabel("الموقع").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("suspect").setLabel("المشتبه به (إن وُجد)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
      )
    );
    return safeModal(interaction, modal);
  }

  if (action === "submit") {
    const kind = decodeURIComponent(idRaw || "أخرى");
    const cfg = svc.config(guild.id);

    const record = app.military.createReport({
      guildId: guild.id,
      reporterId: interaction.user.id,
      kind,
      details: interaction.fields.getTextInputValue("details"),
      location: interaction.fields.getTextInputValue("location") || null,
      suspect: interaction.fields.getTextInputValue("suspect") || null
    });

    let posted = false;
    if (cfg.reportChannelId) {
      const channel = await app.client.channels.fetch(cfg.reportChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        const message = await channel
          .send({
            content: cfg.reportPingRoleId ? `<@&${cfg.reportPingRoleId}>` : undefined,
            embeds: [svc.reportEmbed(guild, record)],
            components: svc.reportButtons(record),
            allowedMentions: { parse: ["roles"] }
          })
          .catch(() => null);
        if (message) {
          app.military.setReportMessage(record.id, channel.id, message.id);
          posted = true;
        }
      }
    }

    return safeReply(interaction, {
      content:
        `${app.config.emoji("success")} تم إرسال بلاغك برقم **#${record.number}**.` +
        (posted ? "\nسيتم إبلاغك في الخاص عند استلامه." : `\n${app.config.emoji("warning")} لم تُحدَّد قناة البلاغات بعد.`),
      flags: 64
    });
  }

  // استلام وإغلاق البلاغ — للعسكريين/الطاقم فقط
  const id = parseInt(idRaw, 10);
  const record = app.military.getReportById(id);
  if (!record || record.guild_id !== guild.id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذا البلاغ لم يعد موجودًا.`, flags: 64 });
  }

  const isStaff = app.permissions.resolveLevel(interaction.member) >= Level.STAFF;
  if (!isStaff && !svc.isMilitary(guild.id, interaction.member)) {
    return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
  }

  if (action === "claim") {
    if (!app.military.claimReport(id, interaction.user.id)) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} تم استلام هذا البلاغ من عسكري آخر.`, flags: 64 });
    }
    const fresh = app.military.getReportById(id);
    await svc.refreshReport(guild, fresh);

    // إبلاغ المُبلِّغ في الخاص كما وُعد في لوحة البلاغات
    const reporter = await app.client.users.fetch(fresh.reporter_id).catch(() => null);
    await reporter
      ?.send({
        content: `${app.config.emoji("success")} تم استلام بلاغك رقم **#${fresh.number}** في **${guild.name}** من قِبل <@${interaction.user.id}>.`
      })
      .catch(() => {});

    return safeReply(interaction, { content: `${app.config.emoji("success")} استلمت البلاغ **#${fresh.number}**.`, flags: 64 });
  }

  if (action === "close") {
    if (!app.military.closeReport(id, interaction.user.id)) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} البلاغ مغلق بالفعل.`, flags: 64 });
    }
    const fresh = app.military.getReportById(id);
    await svc.refreshReport(guild, fresh);
    return safeReply(interaction, { content: `${app.config.emoji("success")} تم إغلاق البلاغ **#${fresh.number}**.`, flags: 64 });
  }

  return null;
}
