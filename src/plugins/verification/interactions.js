const { safeReply } = require("../../core/interactions/interactionSafe");

module.exports = {
  prefix: "verify",

  async handle(interaction, app) {
    const t = app.i18n.forGuild(interaction.guild.id);
    const res = await app.verification.verify(interaction.member);
    const emoji = app.config.emoji(res.ok ? "success" : res.reason === "already" ? "warning" : "error");
    return safeReply(interaction, { content: `${emoji} ${t(res.ok ? "verify.done" : `verify.err.${res.reason}`)}`, flags: 64 });
  }
};
