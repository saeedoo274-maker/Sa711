const { safeUpdate } = require("../../core/interactions/interactionSafe");
const { isExpired, replyExpired, ensureOwner } = require("../../core/interactions/ui");

module.exports = {
  prefix: "lb",
  async handle(interaction, app) {
    const [, type, period, pageRaw, ownerId, s] = interaction.customId.split(":");
    if (isExpired(s, 15 * 60_000)) return replyExpired(interaction, app);
    if (!(await ensureOwner(interaction, ownerId, app))) return;
    return safeUpdate(interaction, app.leaderboards.payload(interaction.guild, { type, period, page: parseInt(pageRaw, 10) || 1, ownerId }));
  }
};
