const { safeReply, safeUpdate } = require("../../core/interactions/interactionSafe");

/** أزرار طلب الصداقة في الخاص: soc:faccept|fdecline:<guildId>:<requesterId> */
module.exports = {
  prefix: "soc",
  dmAllowed: true,

  async handle(interaction, app) {
    const [, action, guildId, requesterId] = interaction.customId.split(":");
    const guild = /^\d{17,20}$/.test(guildId || "") ? app.client.guilds?.cache?.get(guildId) : null;
    const t = app.i18n.forGuild(guild?.id || null);
    if (!guild || !/^\d{17,20}$/.test(requesterId || "")) return safeReply(interaction, { content: t("ui.expired", { emoji: app.config.emoji("warning") }), flags: 64 });
    const svc = app.socialPlus;
    let res;
    if (action === "faccept") {
      const requester = await app.client.users.fetch(requesterId).catch(() => null);
      res = requester ? svc.acceptFriend(guild, interaction.user, requester) : { ok: false, reason: "noRequest" };
    } else if (action === "fdecline") res = svc.declineFriend(guild, interaction.user, requesterId);
    else res = { ok: false, reason: "noRequest" };
    if (!res.ok) return safeReply(interaction, { content: `${app.config.emoji("error")} ${svc.describe(res, t)}`, flags: 64 });
    return safeUpdate(interaction, { content: action === "faccept" ? `🤝 ${t("soc.friendAccepted", { user: `<@${requesterId}>` })}` : `✖️ ${t("soc.friendDeclined")}`, components: [], allowedMentions: { parse: [] } });
  }
};
