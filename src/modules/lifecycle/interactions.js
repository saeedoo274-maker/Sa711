const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { KINDS } = require("./LifecycleService");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * أزرار مراجعة طلبات الإجازة والاستقالة والبلاغات.
 * الصلاحية تُفحص من الخادم عند كل ضغطة، لا بإخفاء الأزرار.
 */
module.exports = {
  prefix: "lc",

  async handle(interaction, app) {
    const [, action, kind, idRaw] = interaction.customId.split(":");

    if (app.permissions.resolveLevel(interaction.member) < Level.MODERATOR) {
      return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
    }
    if (!KINDS[kind]) return null;

    const id = parseInt(idRaw, 10);
    const record = app.lifecycle.getById(kind, interaction.guild.id, id);
    if (!record) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذا الطلب لم يعد موجودًا.`, flags: 64 });
    }
    if (record.status !== "pending") {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} تم البت في هذا الطلب بالفعل.`, flags: 64 });
    }

    if (action === "note") {
      const modal = new ModalBuilder().setCustomId(`lc:notesave:${kind}:${id}`).setTitle("رفض مع ذكر السبب");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("note").setLabel("سبب الرفض").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
        )
      );
      return safeModal(interaction, modal);
    }

    if (action === "notesave") return decide(interaction, app, kind, record, false, interaction.fields.getTextInputValue("note"));
    if (action === "no") return decide(interaction, app, kind, record, false, null);
    if (action === "ok") return decide(interaction, app, kind, record, true, null);

    return null;
  }
};

async function decide(interaction, app, kind, record, accept, note) {
  await interaction.deferReply({ flags: 64 });
  const guild = interaction.guild;
  const svc = app.lifecycleService;

  if (!accept) {
    if (!app.lifecycle.reject(kind, record.id, { reviewerId: interaction.user.id, note })) {
      return safeUpdate(interaction, { content: `${app.config.emoji("warning")} تم البت في الطلب من إداري آخر.` });
    }
    const fresh = app.lifecycle.getById(kind, guild.id, record.id);
    await svc.refresh(guild, kind, fresh);
    if (kind !== "report") await svc._notify(guild, fresh.user_id, kind, fresh, "rejected");
    return safeUpdate(interaction, { content: `${app.config.emoji("success")} تم رفض الطلب \`#${fresh.number}\`` });
  }

  if (kind === "report") {
    const result = await svc.acceptReport({ guild, record, reviewerId: interaction.user.id, note });
    if (!result.ok) return safeUpdate(interaction, { content: `${app.config.emoji("warning")} تم البت في البلاغ من إداري آخر.` });
    return safeUpdate(interaction, {
      content:
        `${app.config.emoji("success")} تم قبول البلاغ \`#${result.record.number}\` — التحذير رقم **${result.level}**` +
        (result.roleNote ? `\n${app.config.emoji("warning")} ${result.roleNote}` : "")
    });
  }

  const member = await guild.members.fetch(record.user_id).catch(() => null);
  if (!member) return safeUpdate(interaction, { content: app.i18n.t("errors.memberNotFound", { emoji: app.config.emoji("error") }) });

  const result =
    kind === "leave"
      ? await svc.applyLeave({ guild, member, record, reviewerId: interaction.user.id })
      : await svc.applyResignation({ guild, member, record, reviewerId: interaction.user.id });

  if (!result.ok) {
    return safeUpdate(interaction, {
      content:
        result.reason === "alreadyDecided"
          ? `${app.config.emoji("warning")} تم البت في الطلب من إداري آخر.`
          : `${app.config.emoji("error")} ${result.details || "فشل التنفيذ."}`
    });
  }

  return safeUpdate(interaction, {
    content: `${app.config.emoji("success")} تم قبول الطلب \`#${result.record.number}\` — سُحبت \`${result.roles.length}\` رتبة.`
  });
}
