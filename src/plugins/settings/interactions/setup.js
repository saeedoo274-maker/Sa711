const { Level } = require("../../../core/permissions/PermissionService");
const { safeReply, safeUpdate } = require("../../../core/interactions/interactionSafe");

/** خطوات معالج الإعداد: setup:<sessionId>:<action> */
module.exports = {
  prefix: "setup",

  async handle(interaction, app) {
    const [, sid, action] = interaction.customId.split(":");
    const wizard = app.setupWizard;
    const t = app.i18n.forGuild(interaction.guild.id);
    const session = wizard.get(sid);
    if (!session || session.guildId !== interaction.guild.id) {
      return safeUpdate(interaction, { content: t("ui.expired", { emoji: app.config.emoji("warning") }), embeds: [], components: [] });
    }
    if (interaction.user.id !== session.userId) return safeReply(interaction, { content: t("ui.notYours", { emoji: app.config.emoji("error") }), flags: 64 });
    // الصلاحية تُفحص عند كل خطوة، لا عند فتح المعالج فقط
    if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) return safeReply(interaction, { content: t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });

    const d = session.draft;
    const value = interaction.values?.[0];
    switch (action) {
      case "lang": if (value) d.language = value; break;
      case "log": if (value) d.logChannelId = value; break;
      case "wel": if (value) d.welcomeChannelId = value; break;
      case "staff": if (value) d.staffRoleId = value; break;
      case "tcat": if (value) d.ticketCategoryId = value; break;
      case "feat": d.features = (interaction.values || []).filter((f) => session.featureList.includes(f)); break;
      case "next": session.step = Math.min(session.step + 1, 6); break;
      case "back": session.step = Math.max(session.step - 1, 0); break;
      case "cancel":
        wizard.sessions.delete(sid);
        return safeUpdate(interaction, { content: `✖️ ${t("setup.cancelled")}`, embeds: [], components: [] });
      case "apply": {
        const count = wizard.apply(session);
        return safeUpdate(interaction, { content: `✅ ${t("setup.applied", { count })}`, embeds: [], components: [] });
      }
      default:
        return safeReply(interaction, { content: t("ui.expired", { emoji: app.config.emoji("warning") }), flags: 64 });
    }
    return safeUpdate(interaction, wizard.render(session));
  }
};
