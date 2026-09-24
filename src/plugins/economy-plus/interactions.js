const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { safeReply, safeModal, safeUpdate } = require("../../core/interactions/interactionSafe");
const { parseAmount } = require("../../core/utils/common");

module.exports = {
  prefix: "eco",

  async handle(interaction, app) {
    const guild = interaction.guild;
    const t = app.i18n.forGuild(guild.id);
    const [, action, idRaw, arg] = interaction.customId.split(":");
    const id = parseInt(idRaw, 10);
    const reply = (ok, text) => safeReply(interaction, { content: `${app.config.emoji(ok ? "success" : "error")} ${text}`, flags: 64 });
    const errText = (res) => {
      const text = t(`eco.err.${res.reason}`, { min: res.minimum ?? res.min ?? "", max: res.max ?? "" });
      return text.startsWith("eco.err.") ? res.reason : text;
    };
    if (app.guildConfig.value(guild.id, "economy.enabled") === false) return reply(false, t("errors.systemDisabled", { emoji: "", system: "economy" }));

    // ---- المزاد: زر → نموذج المبلغ → مزايدة ----
    if (action === "bid") {
      const auction = app.economyPlusRepo.auction(id);
      if (!auction || auction.guild_id !== guild.id || auction.status !== "active") return reply(false, t("eco.err.closed"));
      const minimum = auction.top_bid ? Math.ceil(auction.top_bid * (1 + app.market.config(guild.id).auction.minIncrementPercent / 100)) : auction.min_bid;
      const modal = new ModalBuilder().setCustomId(`eco:bidm:${id}`).setTitle(`${t("eco.auction")} #${id}`).addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("amount").setLabel(t("eco.bidLabel", { min: minimum }).slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(15))
      );
      return safeModal(interaction, modal);
    }
    if (action === "bidm" && interaction.isModalSubmit()) {
      const amount = parseAmount(interaction.fields.getTextInputValue("amount"));
      if (!amount) return reply(false, t("eco.err.invalidAmount"));
      const res = app.market.bid(interaction.member, id, amount);
      return res.ok ? reply(true, t("eco.bidPlaced", { id, amount: app.economyService.format(guild.id, amount) })) : reply(false, errText(res));
    }

    // ---- التداول ----
    if (action === "trade") {
      if (arg === "accept") {
        const res = app.economyPlusRepo.acceptTrade(id, interaction.user.id);
        if (!res.ok) return reply(false, errText(res));
        app.scheduler.cancelByKey(`trade:${id}`);
        app.bus.emitSafe("economy:trade", { guildId: guild.id, trade: res.trade });
        return safeUpdate(interaction, app.market.tradePayload(guild, app.economyPlusRepo.trade(id)));
      }
      const status = arg === "decline" ? "declined" : "cancelled";
      const res = app.economyPlusRepo.closeTrade(id, interaction.user.id, status);
      if (!res.ok) return reply(false, errText(res));
      app.scheduler.cancelByKey(`trade:${id}`);
      return safeUpdate(interaction, app.market.tradePayload(guild, app.economyPlusRepo.trade(id)));
    }

    // ---- القروض (أدمن) ----
    if (action === "loan") {
      if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) return reply(false, t("errors.noPermission", { emoji: "" }));
      const res = arg === "approve" ? app.economyPlus.approveLoan(guild, id, interaction.member) : app.economyPlus.rejectLoan(guild, id, interaction.member);
      if (!res.ok) return reply(false, errText(res));
      const loan = res.loan;
      await app.notifications.notify({
        guildId: guild.id, userId: loan.user_id, category: "economy",
        payload: { content: t(arg === "approve" ? "eco.loanApprovedDm" : "eco.loanRejectedDm", { id, guild: guild.name, due: loan.due_at ? `<t:${Math.floor(loan.due_at / 1000)}:R>` : "", amount: app.economyService.format(guild.id, loan.remaining) }) }
      });
      return reply(true, t(arg === "approve" ? "eco.loanApproved" : "eco.loanRejected", { id }));
    }

    return reply(false, t("ui.expired", { emoji: "" }));
  }
};
