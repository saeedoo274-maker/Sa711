const { Level } = require("../../core/permissions/PermissionService");
const { safeUpdate, safeReply } = require("../../core/interactions/interactionSafe");
const { isExpired, replyExpired, ensureOwner } = require("../../core/interactions/ui");
const { leaderboardPayload } = require("./views");

const PAGE_TTL_MS = 15 * 60_000;
const CONFIRM_TTL_MS = 60_000;

module.exports = {
  prefix: "lvl",

  async handle(interaction, app) {
    const [, action, ...rest] = interaction.customId.split(":");

    if (action === "top") {
      const [period, pageRaw, ownerId, s] = rest;
      if (isExpired(s, PAGE_TTL_MS)) return replyExpired(interaction, app);
      if (!(await ensureOwner(interaction, ownerId, app))) return;
      const page = Math.max(1, parseInt(pageRaw, 10) || 1);
      return safeUpdate(interaction, leaderboardPayload(app, interaction.guild, { period, page, ownerId }));
    }

    if (action === "reset") {
      const [ownerId, s, answer] = rest;
      if (isExpired(s, CONFIRM_TTL_MS)) return replyExpired(interaction, app);
      if (!(await ensureOwner(interaction, ownerId, app))) return;
      // الصلاحية تُفحص من جديد عند الضغط، لا عند عرض الزر فقط
      if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
        return safeReply(interaction, { content: app.i18n.tg(interaction.guild.id, "errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
      }
      if (answer !== "yes") return safeUpdate(interaction, { content: app.i18n.tg(interaction.guild.id, "common.cancelled"), components: [] });
      const removed = app.levels.repo.resetGuild(interaction.guild.id);
      app.bus.emitSafe("levels:admin", { guildId: interaction.guild.id, actorId: interaction.user.id, action: "resetGuild", count: removed });
      return safeUpdate(interaction, {
        content: `${app.config.emoji("success")} ${app.i18n.tg(interaction.guild.id, "xp.resetGuildDone", { count: removed })}`,
        components: []
      });
    }

    return safeReply(interaction, { content: app.i18n.tg(interaction.guild.id, "ui.expired", { emoji: app.config.emoji("warning") }), flags: 64 });
  }
};
