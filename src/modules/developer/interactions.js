const panel = require("../panel/interactions");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/** أزرار لوحة المطور. تُفحص هوية المطور من الخادم عند كل ضغطة. */
module.exports = {
  prefix: "dev",

  async handle(interaction, app) {
    if (!app.permissions.isDeveloper(interaction.user.id)) {
      return safeReply(interaction, { content: app.i18n.t("errors.developerOnly", { emoji: app.config.emoji("error") }), flags: 64 });
    }

    const [, action] = interaction.customId.split(":");

    if (action === "reload") {
      const count = app.registry.load();
      return safeReply(interaction, { content: app.i18n.t("developer.reloaded", { count }), flags: 64 });
    }

    if (action === "maintenance") {
      app.maintenance = !app.maintenance;
      return safeReply(interaction, {
        content: app.i18n.t(app.maintenance ? "developer.maintenanceOn" : "developer.maintenanceOff"),
        flags: 64
      });
    }
  }
};
