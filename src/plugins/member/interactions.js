const { Level } = require("../../core/permissions/PermissionService");
const { safeUpdate, safeReply } = require("../../core/interactions/interactionSafe");
const { isExpired, replyExpired, ensureOwner } = require("../../core/interactions/ui");
const { historyPayload, SECTIONS } = require("./views");

module.exports = {
  prefix: "mbr",

  async handle(interaction, app) {
    const [, action, userId, ownerId, s] = interaction.customId.split(":");
    if (action !== "h") return replyExpired(interaction, app);
    if (isExpired(s, 15 * 60_000)) return replyExpired(interaction, app);
    if (!(await ensureOwner(interaction, ownerId, app))) return;
    if (app.permissions.resolveLevel(interaction.member) < Level.STAFF) {
      return safeReply(interaction, { content: app.i18n.tg(interaction.guild.id, "errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
    }
    const section = SECTIONS.includes(interaction.values?.[0]) ? interaction.values[0] : "overview";
    const user = await app.client.users.fetch(userId).catch(() => null);
    if (!user) return safeReply(interaction, { content: app.i18n.tg(interaction.guild.id, "errors.userNotFound", { emoji: app.config.emoji("error") }), flags: 64 });
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    return safeUpdate(interaction, historyPayload(app, interaction.guild, user, member, section, ownerId));
  }
};
