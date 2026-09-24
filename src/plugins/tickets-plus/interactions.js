const { safeReply, safeUpdate } = require("../../core/interactions/interactionSafe");

module.exports = {
  prefix: "tkt",
  async handle(interaction, app) {
    const [, action, idRaw] = interaction.customId.split(":");
    const t = app.i18n.forGuild(interaction.guild.id);
    const ticket = app.ticketsPlusRepo.byId(parseInt(idRaw, 10));
    if (!ticket || ticket.guild_id !== interaction.guild.id) return safeReply(interaction, { content: `${app.config.emoji("error")} ${t("tk.err.notTicket")}`, flags: 64 });
    if (action === "cancelclose") {
      const allowed = interaction.user.id === ticket.owner_id || app.ticketsPlus.isStaff(interaction.member, ticket);
      if (!allowed) return safeReply(interaction, { content: t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
      const res = app.ticketsPlus.cancelClose(ticket, interaction.member);
      if (!res.ok) return safeReply(interaction, { content: `${app.config.emoji("warning")} ${t(`tk.err.${res.reason}`)}`, flags: 64 });
      return safeUpdate(interaction, { content: `✋ ${t("tk.closeCancelledBy", { user: `<@${interaction.user.id}>` })}`, embeds: [], components: [], allowedMentions: { parse: [] } });
    }
    return safeReply(interaction, { content: t("ui.expired", { emoji: app.config.emoji("warning") }), flags: 64 });
  }
};
