const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * تفاعلات الهوية الوطنية. البادئة `idn:`.
 * كل قرار يُعاد فحصه من القاعدة عند الضغط، فلا تُقبل هوية وتُرفض معًا.
 */
module.exports = {
  prefix: "idn",

  async handle(interaction, app) {
    const [, action, arg] = interaction.customId.split(":");

    if (action === "create") return createModal(interaction, app);
    if (action === "createsave") return createSave(interaction, app);
    if (action === "mine") return showMine(interaction, app);
    if (action === "approve" || action === "reject") return decide(interaction, app, action, parseInt(arg, 10));
    if (action === "rejectsave") return rejectSave(interaction, app, parseInt(arg, 10));
    return null;
  }
};

async function createModal(interaction, app) {
  const guildId = interaction.guild.id;
  if (!app.identityService.enabled(guildId)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} نظام الهوية معطّل حاليًا.`, flags: 64 });
  }

  const existing = app.identities.get(guildId, interaction.user.id);
  if (existing) {
    const messages = {
      pending: "طلبك قيد المراجعة بالفعل.",
      approved: "عندك هوية معتمدة بالفعل. اضغط **عرض هويتي**.",
      rejected: `طلبك السابق رُفض${existing.reject_reason ? `: ${existing.reject_reason}` : ""}. راجع الإدارة لإعادة التقديم.`
    };
    return safeReply(interaction, { content: `${app.config.emoji("warning")} ${messages[existing.status]}`, flags: 64 });
  }

  const modal = new ModalBuilder().setCustomId("idn:createsave").setTitle("إنشاء الهوية الوطنية");
  modal.addComponents(
    row("full_name", "الاسم الكامل", TextInputStyle.Short, { required: true, max: 80, placeholder: "الاسم الأول والأخير" }),
    row("birth_date", "تاريخ الميلاد", TextInputStyle.Short, { required: true, max: 20, placeholder: "30/04/1993" }),
    row("birth_place", "مكان الميلاد", TextInputStyle.Short, { required: false, max: 60 }),
    row("nationality", "الجنسية", TextInputStyle.Short, { required: false, max: 40 }),
    row("job", "المهنة", TextInputStyle.Short, { required: false, max: 60 })
  );
  return safeModal(interaction, modal);
}

function row(id, label, style, { required = false, max, placeholder } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (max) input.setMaxLength(max);
  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(input);
}

async function createSave(interaction, app) {
  const guildId = interaction.guild.id;

  // إعادة الفحص: قد يكون قدّم من نافذة أخرى بين فتح النموذج وإرساله
  if (app.identities.get(guildId, interaction.user.id)) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} عندك طلب هوية بالفعل.`, flags: 64 });
  }

  const get = (k) => interaction.fields.getTextInputValue(k)?.trim() || null;
  const identity = app.identities.create({
    guildId,
    userId: interaction.user.id,
    fullName: get("full_name"),
    birthDate: get("birth_date"),
    birthPlace: get("birth_place"),
    nationality: get("nationality"),
    job: get("job"),
    photoUrl: interaction.user.displayAvatarURL({ extension: "png" })
  });

  const cfg = app.identityService.config(guildId);
  let posted = false;
  if (cfg.reviewChannelId) {
    const channel = await app.client.channels.fetch(cfg.reviewChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      const message = await channel
        .send({
          embeds: [app.identityService.reviewEmbed(interaction.guild, identity, interaction.user)],
          components: app.identityService.reviewButtons(identity)
        })
        .catch(() => null);
      if (message) {
        app.identities.setMessage(identity.id, channel.id, message.id);
        posted = true;
      }
    }
  }

  return safeReply(interaction, {
    content:
      `${app.config.emoji("success")} تم إرسال طلب هويتك برقم \`${String(identity.card_number).padStart(6, "0")}\`.` +
      (posted ? "\nستصلك البطاقة في الخاص بعد الموافقة." : `\n${app.config.emoji("warning")} لم تُحدَّد قناة المراجعة بعد.`),
    flags: 64
  });
}

async function showMine(interaction, app) {
  const identity = app.identities.get(interaction.guild.id, interaction.user.id);
  if (!identity) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} ما عندك هوية. اضغط **إنشاء هوية**.`, flags: 64 });
  }
  if (identity.status !== "approved") {
    const msg = identity.status === "pending" ? "هويتك قيد المراجعة." : "طلب هويتك مرفوض.";
    return safeReply(interaction, { content: `${app.config.emoji("warning")} ${msg}`, flags: 64 });
  }

  const card = await app.identityService.renderCard(interaction.guild, identity, interaction.user);
  if (card.files) return safeReply(interaction, { files: card.files, flags: 64 });
  return safeReply(interaction, { ...card.payload, flags: card.payload.flags | 64 });
}

async function decide(interaction, app, action, id) {
  if (app.permissions.resolveLevel(interaction.member) < Level.STAFF) {
    return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
  }

  const identity = app.identities.getById(id);
  if (!identity || identity.guild_id !== interaction.guild.id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذا الطلب لم يعد موجودًا.`, flags: 64 });
  }
  if (identity.status !== "pending") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} تم البت في هذا الطلب بالفعل.`, flags: 64 });
  }

  if (action === "reject") {
    const modal = new ModalBuilder().setCustomId(`idn:rejectsave:${id}`).setTitle("رفض طلب الهوية");
    modal.addComponents(row("reason", "سبب الرفض", TextInputStyle.Paragraph, { required: true, max: 500 }));
    return safeModal(interaction, modal);
  }

  return approve(interaction, app, identity);
}

async function approve(interaction, app, identity) {
  const guild = interaction.guild;
  const cfg = app.identityService.config(guild.id);
  const validityMs = (cfg.validityDays || 0) * 86400000;

  if (!app.identities.approve(identity.id, interaction.user.id, validityMs)) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} تم البت في الطلب من إداري آخر.`, flags: 64 });
  }

  const fresh = app.identities.getById(identity.id);
  await app.identityService.refreshReview(guild, fresh);

  // منح رتبة المواطن إن حُدِّدت، مع احترام تسلسل الرتب
  if (cfg.citizenRoleId) {
    const member = await guild.members.fetch(fresh.user_id).catch(() => null);
    const role = guild.roles.cache.get(cfg.citizenRoleId);
    const me = guild.members.me;
    if (member && role && !role.managed && role.position < me.roles.highest.position) {
      await member.roles.add(role, "قبول الهوية الوطنية").catch(() => {});
    }
  }

  // تسليم البطاقة للعضو في الخاص
  const user = await app.client.users.fetch(fresh.user_id).catch(() => null);
  if (user) {
    const card = await app.identityService.renderCard(guild, fresh, user);
    const intro = { content: `${app.config.emoji("success")} تم قبول هويتك في **${guild.name}**.` };
    await user.send(card.files ? { ...intro, files: card.files } : intro).catch(() => {});
    if (!card.files) await user.send(card.payload).catch(() => {});
  }

  return safeReply(interaction, { content: `${app.config.emoji("success")} تم قبول الهوية وتسليمها للعضو.`, flags: 64 });
}

async function rejectSave(interaction, app, id) {
  const identity = app.identities.getById(id);
  if (!identity || identity.guild_id !== interaction.guild.id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذا الطلب لم يعد موجودًا.`, flags: 64 });
  }

  const reason = interaction.fields.getTextInputValue("reason");
  if (!app.identities.reject(id, interaction.user.id, reason)) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} تم البت في الطلب من إداري آخر.`, flags: 64 });
  }

  const fresh = app.identities.getById(id);
  await app.identityService.refreshReview(interaction.guild, fresh);

  const user = await app.client.users.fetch(fresh.user_id).catch(() => null);
  await user
    ?.send({ content: `${app.config.emoji("error")} تم رفض طلب هويتك في **${interaction.guild.name}**.\nالسبب: ${reason}` })
    .catch(() => {});

  return safeReply(interaction, { content: `${app.config.emoji("success")} تم رفض الطلب.`, flags: 64 });
}
