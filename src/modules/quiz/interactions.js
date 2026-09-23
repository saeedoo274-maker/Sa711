const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildEmbed } = require("../../core/utils/helpers");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

module.exports = {
  prefix: "quiz",

  /** يُستدعى من محرّك الإمبيدات حين يكون إجراء الزر بدء الاختبار. */
  startQuiz(interaction, app) {
    return start(interaction, app);
  },

  async handle(interaction, app) {
    const [, action, ownerId, value] = interaction.customId.split(":");

    if (action === "start") return start(interaction, app);

    // أزرار الإجابة مربوطة بصاحب الجلسة، فلا يجيب أحد نيابة عن غيره
    if (ownerId && interaction.user.id !== ownerId) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذا الاختبار ليس لك.`, flags: 64 });
    }

    if (action === "answer") return answer(interaction, app, value);
  }
};

async function start(interaction, app) {
  const guild = interaction.guild;

  if (!app.quizService.enabled(guild.id)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} اختبار التفعيل معطّل في هذا السيرفر.`, flags: 64 });
  }
  if (app.quiz.hasPassed(guild.id, interaction.user.id)) {
    return safeReply(interaction, { content: `${app.config.emoji("success")} أنت مجتاز للاختبار من قبل.`, flags: 64 });
  }
  if (app.quizService.get(guild.id, interaction.user.id)) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} عندك اختبار جارٍ بالفعل.`, flags: 64 });
  }

  const result = app.quizService.start(guild.id, interaction.user.id);
  if (!result.ok) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} ما فيه أسئلة معرّفة بعد.`, flags: 64 });
  }

  const payload = app.quizService.questionPayload(result.session, interaction.user.id);
  return safeReply(interaction, { ...payload, flags: 64 });
}

async function answer(interaction, app, value) {
  const guild = interaction.guild;
  const result = app.quizService.answer(guild.id, interaction.user.id, value);

  if (!result.ok) {
    return safeUpdate(interaction, {
      embeds: [buildEmbed({ description: `${app.config.emoji("warning")} انتهت جلسة الاختبار. ابدأ من جديد.`, color: app.config.color("neutral") })],
      components: []
    });
  }

  if (!result.done) {
    const payload = app.quizService.questionPayload(result.session, interaction.user.id);
    return safeUpdate(interaction, payload);
  }

  const embed = app.quizService.resultEmbed(guild.id, interaction.member, result);
  await safeUpdate(interaction, { embeds: [embed], components: [] });

  // النتيجة تُنشر في القناة ليراها الطاقم، والرتبة تُعطى تلقائيًا عند النجاح
  let roleNote = null;
  if (result.passed) roleNote = await app.quizService.grantRole(guild, interaction.member);

  const channelId = app.guildConfig.value(guild.id, "logs.quiz") || interaction.channelId;
  const channel = await app.client.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embed],
      allowedMentions: { parse: [] },
      components: result.passed && !app.guildConfig.value(guild.id, "quiz.passRoleId")
        ? [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`quiz:noop`).setLabel("✅ اجتاز الاختبار").setStyle(ButtonStyle.Success).setDisabled(true)
          )]
        : []
    }).catch(() => {});
  }

  if (roleNote) {
    await interaction.followUp({ content: `${app.config.emoji("warning")} ${roleNote}`, flags: 64 }).catch(() => {});
  }
}
