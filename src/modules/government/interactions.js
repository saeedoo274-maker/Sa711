const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * تفاعلات الأنظمة الحكومية. البادئة `gov:`.
 * التصويت والقرار يُعاد فحص حالتهما من القاعدة عند كل ضغطة.
 */
module.exports = {
  prefix: "gov",

  async handle(interaction, app) {
    const parts = interaction.customId.split(":");
    const action = parts[1];

    if (action === "propose") return proposeModal(interaction, app);
    if (action === "proposesave") return proposeSave(interaction, app);

    const projectId = parseInt(parts[2], 10);
    const project = app.government.getProjectById(projectId);
    if (!project || project.guild_id !== interaction.guild.id) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذا المشروع لم يعد موجودًا.`, flags: 64 });
    }

    if (action === "vote") return vote(interaction, app, project, parts[3]);
    if (action === "approve" || action === "reject") return decide(interaction, app, project, action);
    if (action === "decidesave") return decideSave(interaction, app, project, parts[3]);
    return null;
  }
};

function row(id, label, style, { required = true, max, placeholder } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (max) input.setMaxLength(max);
  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(input);
}

async function proposeModal(interaction, app) {
  if (!app.governmentService.enabled(interaction.guild.id)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} نظام المجلس معطّل حاليًا.`, flags: 64 });
  }

  const modal = new ModalBuilder().setCustomId("gov:proposesave").setTitle("تقديم مشروع قرار");
  modal.addComponents(
    row("title", "ما هو مشروع القرار؟", TextInputStyle.Short, { max: 200 }),
    row("goal", "الهدف من مشروع القرار", TextInputStyle.Paragraph, { max: 800 }),
    row("details", "تفاصيل إضافية (اختياري)", TextInputStyle.Paragraph, { required: false, max: 1000 })
  );
  return safeModal(interaction, modal);
}

async function proposeSave(interaction, app) {
  const guildId = interaction.guild.id;
  const project = app.government.createProject({
    guildId,
    title: interaction.fields.getTextInputValue("title").trim(),
    goal: interaction.fields.getTextInputValue("goal").trim(),
    details: interaction.fields.getTextInputValue("details")?.trim() || null,
    proposerId: interaction.user.id
  });

  const cfg = app.governmentService.config(guildId);
  let posted = false;
  if (cfg.councilChannelId) {
    const channel = await app.client.channels.fetch(cfg.councilChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      const payload = app.governmentService.projectPayload(project);
      const message = await channel
        .send({
          content: cfg.councilPingRoleId ? `<@&${cfg.councilPingRoleId}>` : undefined,
          ...payload,
          allowedMentions: { parse: ["roles"] }
        })
        .catch(() => null);
      if (message) {
        app.government.setProjectMessage(project.id, channel.id, message.id);
        posted = true;
      }
    }
  }

  return safeReply(interaction, {
    content:
      `${app.config.emoji("success")} تم تقديم مشروع القرار رقم **#${project.number}**.` +
      (posted ? "" : `\n${app.config.emoji("warning")} لم تُحدَّد قناة المجلس بعد.`),
    flags: 64
  });
}

async function vote(interaction, app, project, choice) {
  if (!["yes", "no", "abstain"].includes(choice)) return null;

  if (!app.governmentService.isCouncil(interaction.guild.id, interaction.member)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} التصويت مخصص لأعضاء المجلس.`, flags: 64 });
  }

  const previous = app.government.voterChoice(project.id, interaction.user.id);
  const result = app.government.vote(project.id, interaction.user.id, choice);
  if (!result.ok) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} التصويت مغلق على هذا المشروع.`, flags: 64 });
  }

  await app.governmentService.refreshProject(app.government.getProjectById(project.id));

  const labels = { yes: "موافق", no: "رافض", abstain: "ممتنع" };
  return safeReply(interaction, {
    content: previous
      ? `${app.config.emoji("success")} تم تغيير صوتك من **${labels[previous]}** إلى **${labels[choice]}**.`
      : `${app.config.emoji("success")} سُجّل صوتك: **${labels[choice]}**`,
    flags: 64
  });
}

async function decide(interaction, app, project, action) {
  if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
    return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
  }
  if (project.status !== "open") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} تم البت في هذا المشروع بالفعل.`, flags: 64 });
  }

  const approving = action === "approve";
  const modal = new ModalBuilder()
    .setCustomId(`gov:decidesave:${project.id}:${approving ? "approved" : "rejected"}`)
    .setTitle(approving ? "اعتماد المشروع" : "رفض المشروع");
  modal.addComponents(
    row("reason", approving ? "ملاحظات الاعتماد" : "سبب الرفض", TextInputStyle.Paragraph, { required: !approving, max: 800 }),
    row("session", "ميقات الجلسة (اختياري)", TextInputStyle.Short, { required: false, max: 200 })
  );
  return safeModal(interaction, modal);
}

async function decideSave(interaction, app, project, status) {
  if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
    return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
  }

  const reason = interaction.fields.getTextInputValue("reason")?.trim() || null;
  const session = interaction.fields.getTextInputValue("session")?.trim() || null;

  if (!app.government.decideProject(project.id, status, interaction.user.id, reason, session)) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} تم البت في المشروع من مسؤول آخر.`, flags: 64 });
  }

  const fresh = app.government.getProjectById(project.id);
  await app.governmentService.refreshProject(fresh);

  const proposer = await app.client.users.fetch(fresh.proposer_id).catch(() => null);
  await proposer
    ?.send({
      content:
        status === "approved"
          ? `${app.config.emoji("success")} تم اعتماد مشروع قرارك **#${fresh.number}** في **${interaction.guild.name}**.`
          : `${app.config.emoji("error")} تم رفض مشروع قرارك **#${fresh.number}**.${reason ? `\nالسبب: ${reason}` : ""}`
    })
    .catch(() => {});

  return safeReply(interaction, {
    content: `${app.config.emoji("success")} تم ${status === "approved" ? "اعتماد" : "رفض"} المشروع **#${fresh.number}**.`,
    flags: 64
  });
}
