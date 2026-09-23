const { Level } = require("../../core/permissions/PermissionService");
const { EMOJIS } = require("./PollService");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

module.exports = {
  prefix: "poll",

  async handle(interaction, app) {
    const [, action, idRaw, optionRaw] = interaction.customId.split(":");
    const pollId = parseInt(idRaw, 10);
    const poll = app.polls.getById(pollId);

    if (!poll || poll.guild_id !== interaction.guild.id) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذا الاستطلاع لم يعد موجودًا.`, flags: 64 });
    }

    if (action === "close") {
      const isAuthor = interaction.user.id === poll.author_id;
      if (!isAuthor && app.permissions.resolveLevel(interaction.member) < Level.MODERATOR) {
        return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
      }
      const result = await app.pollService.close(pollId);
      return safeReply(interaction, {
        content: result.ok ? `${app.config.emoji("success")} تم إغلاق التصويت.` : `${app.config.emoji("warning")} الاستطلاع مغلق بالفعل.`,
        flags: 64
      });
    }

    if (poll.status !== "active") {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} انتهى هذا الاستطلاع.`, flags: 64 });
    }

    if (action === "results") {
      // يرى المستخدم اختياره الحالي فقط، دون كشف نتائج الاستطلاع المجهول
      const mine = [];
      poll.options.forEach((option, index) => {
        const voted = app.polls.voters(pollId, index).some((v) => v.user_id === interaction.user.id);
        if (voted) mine.push(`${EMOJIS[index]} ${option}`);
      });
      return safeReply(interaction, {
        content: mine.length ? `اختيارك الحالي:\n${mine.join("\n")}` : "لم تصوّت بعد.",
        flags: 64
      });
    }

    if (action === "vote") {
      const optionIndex = parseInt(optionRaw, 10);
      if (isNaN(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
        return safeReply(interaction, { content: `${app.config.emoji("error")} خيار غير صالح.`, flags: 64 });
      }

      let message;
      if (poll.multiple) {
        const added = app.polls.toggleVote(pollId, interaction.user.id, optionIndex);
        message = added ? `${app.config.emoji("success")} تم تسجيل صوتك لـ **${poll.options[optionIndex]}**` : `➖ تم سحب صوتك من **${poll.options[optionIndex]}**`;
      } else {
        app.polls.voteSingle(pollId, interaction.user.id, optionIndex);
        message = `${app.config.emoji("success")} تم تسجيل صوتك لـ **${poll.options[optionIndex]}**`;
      }

      const fresh = app.polls.getById(pollId);
      if (interaction.message) {
        await interaction.message.edit({ embeds: [app.pollService.buildEmbed(fresh)], components: app.pollService.buttons(fresh) }).catch(() => {});
      }
      return safeReply(interaction, { content: message, flags: 64 });
    }
  }
};
