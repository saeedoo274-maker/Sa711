const { safeUpdate, safeReply } = require("../../core/interactions/interactionSafe");
const { isExpired } = require("../../core/interactions/ui");
const { Level } = require("../../core/permissions/PermissionService");

/** أزرار معاينة الإعلان (ann:confirm|cancel:<id>:<stamp>) — لصاحب المسودة فقط. */
module.exports = {
  prefix: "ann",

  async handle(interaction, app) {
    const [, action, idRaw, s] = interaction.customId.split(":");
    const t = app.i18n.forGuild(interaction.guild.id);
    const id = parseInt(idRaw, 10);
    if (!Number.isInteger(id) || isExpired(s, app.announcements.config(interaction.guild.id).draftTtlMs)) {
      return safeUpdate(interaction, { content: t("ui.expired", { emoji: app.config.emoji("warning") }), embeds: [], components: [] });
    }
    if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
      return safeReply(interaction, { content: t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
    }
    const fail = (reason) => safeReply(interaction, { content: `${app.config.emoji("error")} ${t(`ann.err.${reason}`)}`, flags: 64 });

    if (action === "cancel") {
      const res = app.announcements.cancelDraft(interaction.member, id);
      if (!res.ok) return fail(res.reason);
      return safeUpdate(interaction, { content: `✖️ ${t("ann.cancelled")}`, embeds: [], components: [] });
    }
    if (action === "confirm") {
      const res = await app.announcements.confirm(interaction.member, id);
      if (!res.ok) return fail(res.reason);
      const text = res.scheduled
        ? `✅ ${t("ann.scheduledAt", { time: `<t:${Math.floor(res.runAt / 1000)}:F>`, id })}`
        : res.queued ? `✅ ${t("ann.queued", { job: res.jobId })}` : `✅ ${t("ann.sent", { channel: `<#${res.channelId}>` })}`;
      return safeUpdate(interaction, { content: text, embeds: [], components: [] });
    }
    return safeReply(interaction, { content: t("ui.expired", { emoji: app.config.emoji("warning") }), flags: 64 });
  }
};
