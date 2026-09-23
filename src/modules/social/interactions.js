const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { buildEmbed, truncate } = require("../../core/utils/helpers");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * تفاعلات المنشورات الاجتماعية. البادئة `social:`.
 * كل إجراء يُعيد جلب المنشور من القاعدة عند كل ضغطة (لا يعتمد على البيانات
 * المعروضة في الرسالة)، فحذف منشور من الإدارة يُحترم فورًا حتى لو ضغط أحد زره قبله بلحظة.
 */
module.exports = {
  prefix: "social",

  async handle(interaction, app) {
    const parts = interaction.customId.split(":");
    const action = parts[1];
    const postId = parseInt(parts[2], 10);

    if (action === "reportsubmit" || action === "replysubmit") {
      return action === "reportsubmit" ? reportSubmit(interaction, app, postId) : replySubmit(interaction, app, postId);
    }

    const post = app.social.getPost(postId);
    if (!post || post.guild_id !== interaction.guild.id) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذا المنشور لم يعد موجودًا.`, flags: 64 });
    }

    if (action === "like") return like(interaction, app, post);
    if (action === "repost") return repost(interaction, app, post);
    if (action === "reply") return replyModal(interaction, app, post);
    if (action === "report") return reportModal(interaction, app, post);
    if (action === "delete") return deletePost(interaction, app, post);

    return null;
  }
};

async function like(interaction, app, post) {
  const added = app.social.toggleLike(post.id, interaction.user.id);
  await app.socialService.refreshPost(app.social.getPostRaw(post.id));
  return safeReply(interaction, { content: `${added ? "❤️ أعجبك هذا المنشور." : "تم إلغاء إعجابك."}`, flags: 64 });
}

async function repost(interaction, app, post) {
  const done = app.social.repost(post.id, interaction.user.id);
  if (!done) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} أعدت نشر هذا المنشور بالفعل.`, flags: 64 });
  }
  await app.socialService.refreshPost(app.social.getPostRaw(post.id));
  return safeReply(interaction, { content: "🔁 تمت إعادة نشره على ملفك.", flags: 64 });
}

async function replyModal(interaction, app, post) {
  const modal = new ModalBuilder().setCustomId(`social:replysubmit:${post.id}`).setTitle("الرد على المنشور");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("content").setLabel("ردّك").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(280)
    )
  );
  return safeModal(interaction, modal);
}

async function replySubmit(interaction, app, postId) {
  const original = app.social.getPost(postId);
  if (!original) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} المنشور الأصلي لم يعد موجودًا.`, flags: 64 });
  }

  app.socialService.ensureProfile(interaction.guild.id, interaction.user.id, interaction.user.username);
  const content = interaction.fields.getTextInputValue("content");
  const result = await app.socialService.publish({ guild: interaction.guild, author: interaction.user, content, replyTo: postId });

  await app.socialService.refreshPost(app.social.getPostRaw(postId));

  return safeReply(interaction, {
    content: `${app.config.emoji("success")} تم نشر ردّك${result.posted ? "" : ` (لم تُحدَّد قناة الخلاصة بعد، الرد محفوظ فقط)`}.`,
    flags: 64
  });
}

async function reportModal(interaction, app, post) {
  if (app.social.hasReported(post.id, interaction.user.id)) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} أبلغت عن هذا المنشور مسبقًا.`, flags: 64 });
  }
  const modal = new ModalBuilder().setCustomId(`social:reportsubmit:${post.id}`).setTitle("الإبلاغ عن منشور");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("reason").setLabel("سبب الإبلاغ").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
    )
  );
  return safeModal(interaction, modal);
}

async function reportSubmit(interaction, app, postId) {
  const post = app.social.getPostRaw(postId);
  if (!post) return safeReply(interaction, { content: `${app.config.emoji("error")} المنشور لم يعد موجودًا.`, flags: 64 });

  if (app.social.hasReported(postId, interaction.user.id)) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} أبلغت عن هذا المنشور مسبقًا.`, flags: 64 });
  }

  const reason = interaction.fields.getTextInputValue("reason");
  app.social.createReport({ guildId: interaction.guild.id, postId, reporterId: interaction.user.id, reason });

  const reviewChannelId = app.socialService.config(interaction.guild.id).reportChannelId;
  if (reviewChannelId) {
    const channel = await app.client.channels.fetch(reviewChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      const profile = app.social.getProfile(interaction.guild.id, post.author_id);
      const embed = buildEmbed({
        title: "🚩 بلاغ على منشور",
        color: app.config.color("danger"),
        fields: [
          { name: "الكاتب", value: `<@${post.author_id}>${profile ? ` (@${profile.handle})` : ""}`, inline: true },
          { name: "المُبلِّغ", value: `<@${interaction.user.id}>`, inline: true },
          { name: "المحتوى", value: truncate(post.content, 1000) },
          { name: "سبب الإبلاغ", value: truncate(reason, 500) }
        ]
      });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`social:delete:${postId}`).setLabel("حذف المنشور").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
      );
      await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
    }
  }

  return safeReply(interaction, { content: `${app.config.emoji("success")} تم إرسال بلاغك للمراجعة.`, flags: 64 });
}

async function deletePost(interaction, app, post) {
  // الحذف متاح لصاحب المنشور نفسه، أو للطاقم كإجراء إشرافي
  const isAuthor = post.author_id === interaction.user.id;
  const isStaff = app.permissions.resolveLevel(interaction.member) >= Level.STAFF;
  if (!isAuthor && !isStaff) {
    return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
  }

  const deleted = app.social.deletePost(post.id, interaction.guild.id);
  if (!deleted) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} تم حذف هذا المنشور بالفعل.`, flags: 64 });
  }

  if (post.channel_id && post.message_id) {
    const channel = await app.client.channels.fetch(post.channel_id).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(post.message_id).catch(() => null) : null;
    await message?.delete().catch(() => {});
  }

  return safeReply(interaction, { content: `${app.config.emoji("success")} تم حذف المنشور.`, flags: 64 });
}
