const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

/**
 * السوق بين الأعضاء، المزادات، والتداول المباشر.
 * العناصر تُحجز من الحقيبة عند العرض، والمال يُحجز عند المزايدة — لا يمكن
 * بيع ما لا تملكه ولا المزايدة بما ليس معك.
 */
class MarketService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  config(guildId) {
    const eco = this.app.guildConfig.value(guildId, "economy") || {};
    return {
      market: { enabled: true, taxPercent: 5, maxListings: 10, ...(eco.market || {}) },
      auction: { enabled: true, feePercent: 5, minDurationMs: 600_000, maxDurationMs: 7 * 86_400_000, minIncrementPercent: 5, ...(eco.auction || {}) },
      trade: { enabled: true, expiresMs: 300_000, ...(eco.trade || {}) }
    };
  }

  // ---------------- السوق ----------------

  list(member, itemKey, quantity, price) {
    const cfg = this.config(member.guild.id).market;
    if (!cfg.enabled) return { ok: false, reason: "disabled" };
    if (!(quantity > 0) || !(price > 0)) return { ok: false, reason: "invalidAmount" };
    const res = this.repo.listOnMarket({ guildId: member.guild.id, sellerId: member.id, itemKey, quantity, price, maxListings: cfg.maxListings });
    if (res.ok) this.app.bus.emitSafe("market:listed", { guildId: member.guild.id, userId: member.id, itemKey, quantity, price, id: res.id });
    return res;
  }

  buy(member, listingId) {
    const cfg = this.config(member.guild.id).market;
    if (!cfg.enabled) return { ok: false, reason: "disabled" };
    const res = this.repo.buyFromMarket({ guildId: member.guild.id, buyerId: member.id, listingId, taxPercent: cfg.taxPercent });
    if (res.ok) {
      this.app.bus.emitSafe("market:sold", { guildId: member.guild.id, userId: member.id, listing: res.listing, tax: res.tax });
      const t = this.app.i18n.forGuild(member.guild.id);
      this.app.notifications.notify({
        guildId: member.guild.id, userId: res.listing.seller_id, category: "economy",
        payload: { content: t("eco.marketSoldDm", { id: res.listing.id, buyer: member.user.username, amount: this.app.economyService.format(member.guild.id, res.listing.price - res.tax) }) }
      }).catch(() => {});
    }
    return res;
  }

  // ---------------- المزادات ----------------

  auctionPayload(guild, a) {
    const t = this.app.i18n.forGuild(guild.id);
    const item = this.app.inventory.describe(guild.id, a.item_key);
    const fmt = (v) => this.app.economyService.format(guild.id, v);
    const active = a.status === "active" && a.ends_at > Date.now();
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `🔨 ${t("eco.auction")} #${a.id} — ${item.emoji} ${a.quantity}× ${item.label}`,
        color: active ? "warning" : "neutral",
        fields: [
          { name: t("eco.seller"), value: `<@${a.seller_id}>`, inline: true },
          { name: t("eco.topBid"), value: a.top_bid ? `${fmt(a.top_bid)} — <@${a.top_bidder}>` : `${t("eco.minBid")}: ${fmt(a.min_bid)}`, inline: true },
          { name: t("eco.ends"), value: `<t:${Math.floor(a.ends_at / 1000)}:R>`, inline: true }
        ]
      })],
      components: active ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`eco:bid:${a.id}`).setLabel(t("eco.placeBid")).setEmoji("💰").setStyle(ButtonStyle.Success)
      )] : [],
      allowedMentions: { parse: [] }
    };
  }

  async startAuction(member, channel, { itemKey, quantity, minBid, durationMs }) {
    const cfg = this.config(member.guild.id).auction;
    if (!cfg.enabled) return { ok: false, reason: "disabled" };
    if (!(quantity > 0) || !(minBid > 0)) return { ok: false, reason: "invalidAmount" };
    if (durationMs < cfg.minDurationMs || durationMs > cfg.maxDurationMs) return { ok: false, reason: "badDuration" };
    const res = this.repo.createAuction({ guildId: member.guild.id, sellerId: member.id, itemKey, quantity, minBid, endsAt: Date.now() + durationMs });
    if (!res.ok) return res;
    const a = this.repo.auction(res.id);
    const message = await channel.send(this.auctionPayload(member.guild, a)).catch(() => null);
    if (message) this.repo.setAuctionMessage(a.id, channel.id, message.id);
    this.app.scheduler.schedule({ type: "economy:auction-end", guildId: member.guild.id, uniqueKey: `auction:${a.id}`, runAt: a.ends_at, payload: { id: a.id } });
    this.app.bus.emitSafe("auction:started", { guildId: member.guild.id, userId: member.id, auction: a });
    return { ok: true, auction: a };
  }

  bid(member, auctionId, amount) {
    const cfg = this.config(member.guild.id).auction;
    const res = this.repo.bid({ guildId: member.guild.id, auctionId, userId: member.id, amount, minIncrementPercent: cfg.minIncrementPercent });
    if (!res.ok) return res;
    this._refreshAuction(auctionId).catch((err) => this.app.logger.debug(`تحديث المزاد فشل: ${err.message}`));
    if (res.previousBidder) {
      const t = this.app.i18n.forGuild(member.guild.id);
      this.app.notifications.notify({
        guildId: member.guild.id, userId: res.previousBidder, category: "economy",
        payload: { content: t("eco.outbidDm", { id: auctionId, amount: this.app.economyService.format(member.guild.id, amount) }) }
      }).catch(() => {});
    }
    return res;
  }

  async _refreshAuction(id) {
    const a = this.repo.auction(id);
    if (!a?.channel_id || !a.message_id) return;
    const guild = this.app.client.guilds?.cache?.get(a.guild_id);
    const channel = await this.app.client.channels.fetch(a.channel_id).catch(() => null);
    const message = channel ? await channel.messages.fetch(a.message_id).catch(() => null) : null;
    if (guild && message) await message.edit(this.auctionPayload(guild, a));
  }

  async endAuction(id) {
    const a = this.repo.auction(id);
    if (!a || a.status !== "active") return { ok: false, reason: "closed" };
    const res = this.repo.endAuction(id, this.config(a.guild_id).auction.feePercent);
    if (!res.ok) return res;
    await this._refreshAuction(id).catch(() => {});
    const t = this.app.i18n.forGuild(a.guild_id);
    if (res.sold) {
      await this.app.notifications.notify({ guildId: a.guild_id, userId: a.top_bidder, category: "economy", payload: { content: t("eco.auctionWonDm", { id }) } });
      await this.app.notifications.notify({ guildId: a.guild_id, userId: a.seller_id, category: "economy", payload: { content: t("eco.auctionSoldDm", { id, amount: this.app.economyService.format(a.guild_id, a.top_bid - res.fee) }) } });
    }
    this.app.bus.emitSafe("auction:ended", { guildId: a.guild_id, auction: a, sold: res.sold });
    return res;
  }

  // ---------------- التداول ----------------

  tradePayload(guild, trade) {
    const t = this.app.i18n.forGuild(guild.id);
    const fmt = (v) => this.app.economyService.format(guild.id, v);
    const side = (money, item, qty) => {
      const parts = [];
      if (money) parts.push(`💰 ${fmt(money)}`);
      if (item && qty) {
        const d = this.app.inventory.describe(guild.id, item);
        parts.push(`${d.emoji} ${qty}× ${d.label}`);
      }
      return parts.join("\n") || "—";
    };
    const pending = trade.status === "pending";
    return {
      content: pending ? `<@${trade.to_id}>` : undefined,
      embeds: [this.app.theme.embed(guild.id, {
        title: `🤝 ${t("eco.trade")} #${trade.id} — ${t(`eco.tradeStatus.${trade.status}`)}`,
        color: pending ? "info" : trade.status === "accepted" ? "success" : "neutral",
        fields: [
          { name: `📤 ${t("eco.gives", { name: guild.members.cache.get(trade.from_id)?.displayName || trade.from_id })}`, value: side(trade.offer_money, trade.offer_item, trade.offer_qty), inline: true },
          { name: `📥 ${t("eco.gives", { name: guild.members.cache.get(trade.to_id)?.displayName || trade.to_id })}`, value: side(trade.want_money, trade.want_item, trade.want_qty), inline: true },
          ...(pending ? [{ name: t("eco.expires"), value: `<t:${Math.floor(trade.expires_at / 1000)}:R>`, inline: false }] : [])
        ]
      })],
      components: pending ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`eco:trade:${trade.id}:accept`).setLabel(t("eco.accept")).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`eco:trade:${trade.id}:decline`).setLabel(t("eco.decline")).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`eco:trade:${trade.id}:cancel`).setLabel(t("common.cancel")).setStyle(ButtonStyle.Secondary)
      )] : [],
      allowedMentions: { users: pending ? [trade.to_id] : [] }
    };
  }

  proposeTrade(member, target, offer) {
    const cfg = this.config(member.guild.id).trade;
    if (!cfg.enabled) return { ok: false, reason: "disabled" };
    if (target.user.bot || target.id === member.id) return { ok: false, reason: "invalidTarget" };
    const nothing = !offer.offerMoney && !offer.offerItem && !offer.wantMoney && !offer.wantItem;
    if (nothing) return { ok: false, reason: "emptyTrade" };
    // فحص مبدئي لما يعرضه صاحب العرض (الفحص النهائي الذرّي عند القبول)
    if (offer.offerItem && this.app.inventory.amountOf(member.guild.id, member.id, offer.offerItem) < offer.offerQty) return { ok: false, reason: "notEnoughItems" };
    const account = this.app.economy.get(member.guild.id, member.id);
    if (offer.offerMoney && (!account || account.wallet + account.bank < offer.offerMoney)) return { ok: false, reason: "insufficient" };
    const trade = this.repo.createTrade({ guildId: member.guild.id, fromId: member.id, toId: target.id, ...offer, expiresAt: Date.now() + cfg.expiresMs });
    this.app.scheduler.schedule({ type: "economy:trade-expire", guildId: member.guild.id, uniqueKey: `trade:${trade.id}`, runAt: trade.expires_at, payload: { id: trade.id } });
    return { ok: true, trade };
  }
}

module.exports = MarketService;
