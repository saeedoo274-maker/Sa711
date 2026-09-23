const { Level } = require("../../core/permissions/PermissionService");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

module.exports = {
  prefix: "giveaway",

  async handle(interaction, app) {
    const [, action, idRaw] = interaction.customId.split(":");
    const id = parseInt(idRaw, 10);
    const giveaway = app.giveaways.getById(id);

    if (!giveaway || giveaway.guild_id !== interaction.guild.id) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذا السحب لم يعد موجودًا.`, flags: 64 });
    }

    if (action === "enter") {
      if (giveaway.status !== "active") {
        return safeReply(interaction, { content: `${app.config.emoji("warning")} انتهى هذا السحب.`, flags: 64 });
      }

      // الضغط مرة أخرى ينسحب من السحب
      if (app.giveaways.hasEntered(id, interaction.user.id)) {
        app.giveaways.leave(id, interaction.user.id);
        await refresh(interaction, app, giveaway);
        return safeReply(interaction, { content: `${app.config.emoji("success")} تم إلغاء مشاركتك.`, flags: 64 });
      }

      const eligible = app.giveawayService.eligibility(giveaway, interaction.member);
      if (!eligible.ok) {
        return safeReply(interaction, { content: `${app.config.emoji("error")} ${eligible.message}`, flags: 64 });
      }

      const weight = app.giveawayService.entryWeight(giveaway, interaction.member);
      app.giveaways.enter(id, interaction.user.id, weight);
      await refresh(interaction, app, giveaway);

      return safeReply(interaction, {
        content: `${app.config.emoji("success")} تم تسجيل مشاركتك${weight > 1 ? ` بـ \`${weight}\` فرص` : ""}. بالتوفيق!`,
        flags: 64
      });
    }

    // الإنهاء وإعادة السحب للإدارة فقط، ويُعاد فحص الصلاحية هنا لا في الواجهة
    if (app.permissions.resolveLevel(interaction.member) < Level.MODERATOR && interaction.user.id !== giveaway.host_id) {
      return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
    }

    if (action === "end") {
      await interaction.deferReply({ flags: 64 });
      const result = await app.giveawayService.end(id);
      return safeUpdate(interaction, {
        content: result.ok
          ? `${app.config.emoji("success")} تم إنهاء السحب. عدد الفائزين: \`${result.winners.length}\``
          : `${app.config.emoji("warning")} السحب منتهٍ بالفعل.`
      });
    }

    if (action === "reroll") {
      await interaction.deferReply({ flags: 64 });
      const result = await app.giveawayService.end(id, { rerolledBy: interaction.user.id });
      return safeUpdate(interaction, { content: `${app.config.emoji("success")} تمت إعادة السحب. الفائزون: \`${result.winners.length}\`` });
    }
  }
};

async function refresh(interaction, app, giveaway) {
  const fresh = app.giveaways.getById(giveaway.id);
  if (!fresh || !interaction.message) return;
  await interaction.message
    .edit({ embeds: [app.giveawayService.buildEmbed(fresh)], components: app.giveawayService.buttons(fresh) })
    .catch(() => {});
}
