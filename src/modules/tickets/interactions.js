const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { buildEmbed, extractId } = require("../../core/utils/helpers");
const { Level } = require("../../core/permissions/PermissionService");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * كل معالج هنا يعيد فحص الصلاحية من جديد.
 * وجود الزر أمام المستخدم لا يعني أبدًا أنه مخوّل بالضغط عليه.
 */
module.exports = {
  prefix: "ticket",

  /** يُستدعى من محرّك الإمبيدات حين يكون إجراء الزر فتح تذكرة. */
  openTypedTicket(interaction, app, typeId) {
    return startTyped(interaction, app, typeId);
  },

  async handle(interaction, app) {
    const [, action, arg] = interaction.customId.split(":");

    // فتح تذكرة من لوحة عامة
    if (action === "open") return openTicket(interaction, app, arg);
    // فتح تذكرة بنوع محدد (من زر أو خيار قائمة مبني يدويًا)
    if (action === "new") return startTyped(interaction, app, arg);
    if (action === "newsubmit") return submitTyped(interaction, app, arg);

    const ticket = app.tickets.getByChannel(interaction.channelId);
    if (!ticket) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذه القناة ليست تذكرة مسجّلة.`, flags: 64 });
    }

    const isOwner = interaction.user.id === ticket.owner_id;
    const canManage = app.ticketService.canManage(interaction.member, ticket);

    switch (action) {
      case "claim": return claim(interaction, app, ticket, canManage);
      case "unclaim": return unclaim(interaction, app, ticket, canManage);
      case "close": return close(interaction, app, ticket, canManage || isOwner);
      case "reopen": return reopen(interaction, app, ticket, canManage);
      case "delete": return remove(interaction, app, ticket);
      case "allowfiles": return files(interaction, app, ticket, canManage, true);
      case "denyfiles": return files(interaction, app, ticket, canManage, false);
      case "add": return memberModal(interaction, app, canManage, "add");
      case "remove": return memberModal(interaction, app, canManage, "remove");
      case "rename": return renameModal(interaction, app, canManage);
      case "transcript": return transcript(interaction, app, ticket, canManage);
      case "addsubmit": return memberSubmit(interaction, app, ticket, "add");
      case "removesubmit": return memberSubmit(interaction, app, ticket, "remove");
      case "renamesubmit": return renameSubmit(interaction, app, ticket);
      default: return null;
    }
  }
};

function deny(interaction, app, key = "errors.noPermission") {
  return safeReply(interaction, { content: app.i18n.t(key, { emoji: app.config.emoji("error") }), flags: 64 });
}

async function refreshHeader(interaction, app, ticket) {
  const fresh = app.tickets.getByChannel(ticket.channel_id);
  if (!fresh) return;
  const panel = fresh.panel_id ? app.tickets.getPanel(fresh.panel_id) : null;
  const message = interaction.message;
  if (!message) return;
  await message
    .edit({
      embeds: [app.ticketService.header(fresh, interaction.guild, panel?.config || {})],
      components: app.ticketService.buildButtons(fresh)
    })
    .catch(() => {});
}

async function openTicket(interaction, app, panelId) {
  await interaction.deferReply({ flags: 64 });
  const result = await app.ticketService.open({ guild: interaction.guild, member: interaction.member, panelId });

  if (!result.ok) {
    const messages = {
      systemDisabled: `${app.config.emoji("error")} نظام التذاكر معطّل في هذا السيرفر.`,
      duplicate: `${app.config.emoji("warning")} لديك تذكرة مفتوحة بالفعل. أغلقها أولًا قبل فتح تذكرة جديدة.`,
      actionFailed: `${app.config.emoji("error")} تعذّر إنشاء التذكرة: ${result.details || "خطأ غير معروف"}`
    };
    return safeUpdate(interaction, { content: messages[result.reason] || messages.actionFailed });
  }
  return safeUpdate(interaction, { content: `${app.config.emoji("success")} تم فتح تذكرتك: <#${result.channel.id}>` });
}

async function claim(interaction, app, ticket, canManage) {
  if (!canManage) return deny(interaction, app);

  // حد التذاكر المستلمة في نفس الوقت — يمنع احتكار موظف للتذاكر
  const maxClaims = app.guildConfig.value(interaction.guild.id, "tickets.maxClaimsPerStaff") || 0;
  if (maxClaims > 0 && app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
    const active = app.tickets.activeClaims(interaction.guild.id, interaction.user.id);
    if (active >= maxClaims) {
      return safeReply(interaction, {
        content: `${app.config.emoji("warning")} وصلت للحد الأقصى من التذاكر المستلمة (**${maxClaims}**). أنهِ إحداها أولًا.`,
        flags: 64
      });
    }
  }

  // العملية الذرّية: أول ضغطة فقط تُرجع true، والبقية تفشل بأمان
  const success = app.tickets.claim(ticket.channel_id, interaction.user.id);
  if (!success) {
    const current = app.tickets.getByChannel(ticket.channel_id);
    return safeReply(interaction, {
      content: `${app.config.emoji("warning")} التذكرة مستلمة بالفعل بواسطة <@${current?.claimed_by}>.`,
      flags: 64
    });
  }

  app.activity.increment(interaction.guild.id, interaction.user.id, "tickets_claimed");
  app.bus.emitSafe("ticket:claimed", { guild: interaction.guild, ticket, member: interaction.member });

  await safeReply(interaction, { content: `${app.config.emoji("success")} استلمت التذكرة.`, flags: 64 });
  await refreshHeader(interaction, app, ticket);
  await interaction.channel.send({
    embeds: [buildEmbed({ description: `🙋 تم استلام التذكرة بواسطة <@${interaction.user.id}>`, color: app.config.color("success") })]
  }).catch(() => {});
}

async function unclaim(interaction, app, ticket, canManage) {
  if (!canManage) return deny(interaction, app);

  const level = app.permissions.resolveLevel(interaction.member);
  const force = level >= Level.ADMIN; // الأدمن يقدر يلغي استلام غيره
  const success = app.tickets.unclaim(ticket.channel_id, interaction.user.id, force);
  if (!success) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} لا يمكنك إلغاء استلام لست أنت من قام به.`, flags: 64 });
  }

  app.bus.emitSafe("ticket:unclaimed", { guild: interaction.guild, ticket, member: interaction.member });
  await safeReply(interaction, { content: `${app.config.emoji("success")} تم إلغاء الاستلام.`, flags: 64 });
  await refreshHeader(interaction, app, ticket);
}

async function close(interaction, app, ticket, allowed) {
  if (!allowed) return deny(interaction, app);

  const success = app.tickets.close(ticket.channel_id, interaction.user.id);
  if (!success) return safeReply(interaction, { content: `${app.config.emoji("warning")} التذكرة مغلقة بالفعل.`, flags: 64 });

  await app.ticketService.closeChannel(interaction.channel, ticket);
  app.activity.increment(interaction.guild.id, interaction.user.id, "tickets_closed");
  app.bus.emitSafe("ticket:closed", { guild: interaction.guild, ticket, member: interaction.member });

  await safeReply(interaction, {
    embeds: [buildEmbed({ description: `🔒 تم إغلاق التذكرة بواسطة <@${interaction.user.id}>`, color: app.config.color("danger") })]
  });
  await refreshHeader(interaction, app, ticket);

  const closed = app.tickets.getByChannel(ticket.channel_id);
  await app.ticketAutomation.requestRating(interaction.guild, closed).catch(() => {});
}

async function reopen(interaction, app, ticket, canManage) {
  if (!canManage) return deny(interaction, app);

  const success = app.tickets.reopen(ticket.channel_id);
  if (!success) return safeReply(interaction, { content: `${app.config.emoji("warning")} التذكرة مفتوحة بالفعل.`, flags: 64 });

  await app.ticketService.reopenChannel(interaction.channel, ticket);
  app.bus.emitSafe("ticket:reopened", { guild: interaction.guild, ticket, member: interaction.member });

  await safeReply(interaction, {
    embeds: [buildEmbed({ description: `🔓 تم إعادة فتح التذكرة بواسطة <@${interaction.user.id}>`, color: app.config.color("success") })]
  });
  await refreshHeader(interaction, app, ticket);
}

async function remove(interaction, app, ticket) {
  // الحذف النهائي يتطلب مستوى أعلى من الإغلاق
  const level = app.permissions.resolveLevel(interaction.member);
  if (level < Level.ADMIN) return deny(interaction, app);
  if (ticket.status !== "closed") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} يجب إغلاق التذكرة قبل حذفها.`, flags: 64 });
  }

  await safeReply(interaction, { content: `${app.config.emoji("warning")} سيتم حذف القناة خلال 5 ثوانٍ...` });

  // نسخة المحادثة تُحفظ قبل الحذف إن كانت قناة الأرشيف معرّفة
  const transcriptChannelId = app.guildConfig.value(interaction.guild.id, "tickets.transcriptChannelId");
  if (transcriptChannelId) {
    const target = await app.client.channels.fetch(transcriptChannelId).catch(() => null);
    if (target?.isTextBased()) {
      const file = await app.ticketAutomation.transcriptHTML(interaction.channel, ticket).catch(() => null);
      if (file) {
        await target.send({
          content: `📄 أرشيف تذكرة <@${ticket.owner_id}> — حُذفت بواسطة <@${interaction.user.id}>`,
          files: [file]
        }).catch(() => {});
      }
    }
  }

  app.tickets.delete(ticket.channel_id);
  app.bus.emitSafe("ticket:deleted", { guild: interaction.guild, ticket, member: interaction.member });
  setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
}

async function files(interaction, app, ticket, canManage, allow) {
  if (!canManage) return deny(interaction, app);
  await app.ticketService.setAttachments(interaction.channel, ticket.owner_id, allow);
  await safeReply(interaction, {
    content: `${app.config.emoji("success")} ${allow ? "تم السماح لصاحب التذكرة بإرسال الصور والملفات." : "تم منع إرسال الصور والملفات."}`,
    flags: 64
  });
  await refreshHeader(interaction, app, ticket);
}

async function memberModal(interaction, app, canManage, mode) {
  if (!canManage) return deny(interaction, app);
  const modal = new ModalBuilder()
    .setCustomId(`ticket:${mode}submit`)
    .setTitle(mode === "add" ? "إضافة عضو للتذكرة" : "إزالة عضو من التذكرة");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("user").setLabel("آيدي العضو أو منشن").setStyle(TextInputStyle.Short).setRequired(true)
    )
  );
  return safeModal(interaction, modal);
}

async function memberSubmit(interaction, app, ticket, mode) {
  const canManage = app.ticketService.canManage(interaction.member, ticket);
  if (!canManage) return deny(interaction, app);

  const userId = extractId(interaction.fields.getTextInputValue("user"));
  if (!userId) return safeReply(interaction, { content: `${app.config.emoji("error")} آيدي غير صالح.`, flags: 64 });

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) return safeReply(interaction, { content: app.i18n.t("errors.memberNotFound", { emoji: app.config.emoji("error") }), flags: 64 });

  if (mode === "add") {
    await interaction.channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });
    app.tickets.addMember(ticket.id, userId, interaction.user.id);
    return safeReply(interaction, { content: `${app.config.emoji("success")} تمت إضافة <@${userId}> إلى التذكرة.` });
  }

  if (userId === ticket.owner_id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} لا يمكن إزالة صاحب التذكرة.`, flags: 64 });
  }
  await interaction.channel.permissionOverwrites.delete(userId).catch(() => {});
  app.tickets.removeMember(ticket.id, userId);
  return safeReply(interaction, { content: `${app.config.emoji("success")} تمت إزالة <@${userId}> من التذكرة.` });
}

async function renameModal(interaction, app, canManage) {
  if (!canManage) return deny(interaction, app);
  const modal = new ModalBuilder().setCustomId("ticket:renamesubmit").setTitle("إعادة تسمية التذكرة");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("الاسم الجديد").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(90)
    )
  );
  return safeModal(interaction, modal);
}

async function renameSubmit(interaction, app, ticket) {
  if (!app.ticketService.canManage(interaction.member, ticket)) return deny(interaction, app);
  const name = interaction.fields.getTextInputValue("name").toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\-_]/g, "-").slice(0, 90);
  await interaction.channel.setName(name).catch(() => {});
  return safeReply(interaction, { content: `${app.config.emoji("success")} تم تغيير اسم التذكرة إلى \`${name}\`` });
}

async function transcript(interaction, app, ticket, canManage) {
  if (!canManage) return deny(interaction, app);
  await interaction.deferReply({ flags: 64 });
  const file = await app.ticketAutomation.transcriptHTML(interaction.channel, ticket).catch(() => null);
  if (!file) return safeUpdate(interaction, { content: `${app.config.emoji("error")} تعذّر إنشاء نسخة المحادثة.` });
  return safeUpdate(interaction, { content: `${app.config.emoji("success")} نسخة المحادثة جاهزة:`, files: [file] });
}

/**
 * يبدأ فتح تذكرة من نوع محدد.
 * لو للنوع نموذج أسئلة، تُعرض نافذة قبل إنشاء القناة.
 */
async function startTyped(interaction, app, typeId) {
  const type = app.ticketTypes.get(typeId);
  if (!type || type.guild_id !== interaction.guild.id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} نوع التذكرة لم يعد موجودًا.`, flags: 64 });
  }

  if (!type.questions.length) return finishTyped(interaction, app, type, null);

  const modal = new ModalBuilder().setCustomId(`ticket:newsubmit:${type.id}`).setTitle(String(type.label).slice(0, 45));
  type.questions.slice(0, 5).forEach((q, i) => {
    const input = new TextInputBuilder()
      .setCustomId(`q${i}`)
      .setLabel(String(q.label).slice(0, 45))
      .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(q.required !== false)
      .setMaxLength(q.long ? 1000 : 200);
    if (q.placeholder) input.setPlaceholder(String(q.placeholder).slice(0, 100));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });
  return safeModal(interaction, modal);
}

async function submitTyped(interaction, app, typeId) {
  const type = app.ticketTypes.get(typeId);
  if (!type || type.guild_id !== interaction.guild.id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} نوع التذكرة لم يعد موجودًا.`, flags: 64 });
  }

  const answers = {};
  type.questions.slice(0, 5).forEach((q, i) => {
    const value = interaction.fields.getTextInputValue(`q${i}`);
    if (value) answers[q.label] = value;
  });

  return finishTyped(interaction, app, type, answers);
}

async function finishTyped(interaction, app, type, answers) {
  await interaction.deferReply({ flags: 64 });

  const result = await app.ticketService.open({
    guild: interaction.guild,
    member: interaction.member,
    type,
    answers
  });

  if (!result.ok) {
    const messages = {
      systemDisabled: `${app.config.emoji("error")} نظام التذاكر معطّل في هذا السيرفر.`,
      duplicate: `${app.config.emoji("warning")} لديك تذكرة مفتوحة من نوع **${type.label}**. أغلقها أولًا.`,
      actionFailed: `${app.config.emoji("error")} تعذّر إنشاء التذكرة: ${result.details || "خطأ غير معروف"}`
    };
    return safeUpdate(interaction, { content: messages[result.reason] || messages.actionFailed });
  }

  return safeUpdate(interaction, {
    content: `${app.config.emoji("success")} تم فتح تذكرة **${type.label}**: <#${result.channel.id}>`
  });
}
