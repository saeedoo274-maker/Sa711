const { safeUpdate, safeReply } = require("../../core/interactions/interactionSafe");

module.exports = {
  prefix: "game",

  async handle(interaction, app) {
    const [, idRaw, action, arg] = interaction.customId.split(":");
    const t = app.i18n.forGuild(interaction.guild.id);
    const res = await app.games.handle(interaction, parseInt(idRaw, 10), action, arg);
    if (!res.ok) {
      const text = t(`game.err.${res.reason}`, { min: "", max: "", game: "" });
      return safeReply(interaction, { content: `${app.config.emoji("error")} ${text.startsWith("game.err.") ? res.reason : text}`, flags: 64 });
    }
    return safeUpdate(interaction, res.update);
  }
};
