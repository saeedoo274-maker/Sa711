const help = require("./commands/help");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

module.exports = {
  prefix: "help",

  async handle(interaction, app) {
    const [, action] = interaction.customId.split(":");
    if (action === "module") {
      const moduleName = interaction.values[0];
      return safeUpdate(interaction, help.moduleView(app, interaction.member, moduleName));
    }
  }
};
