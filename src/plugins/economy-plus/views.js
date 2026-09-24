const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { formatDuration, truncate } = require("../../core/utils/common");

const PER_PAGE = 10;

function fail(ctx, res) {
  const details = ctx.t(`eco.err.${res.reason}`, {
    remaining: res.remainingMs ? formatDuration(res.remainingMs) : "",
    next: res.next ? `<t:${Math.floor(res.next / 1000)}:R>` : "",
    min: res.min ?? res.minimum ?? "",
    max: res.max ?? res.limit ?? "",
    level: res.level ?? "",
    stock: res.stock ?? ""
  });
  return ctx.fail("errors.actionFailed", { details: details.startsWith("eco.err.") ? res.reason : details });
}

function historyPayload(app, guild, userId, { type = null, page = 1 }) {
  const t = app.i18n.forGuild(guild.id);
  const total = app.economyPlusRepo.historyCount(guild.id, userId, type);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const current = Math.min(Math.max(1, page), pages);
  const rows = app.economyPlusRepo.history(guild.id, userId, { type, limit: PER_PAGE, offset: (current - 1) * PER_PAGE });
  const incoming = new Set(["transfer_in", "admin_add", "loan", "daily", "weekly", "monthly", "work", "rob", "shop_sell", "shop_refund", "invest_return", "invest_withdraw", "market_sell", "auction_sale", "auction_refund", "trade_in", "game_win", "reward"]);
  const lines = rows.map((r) => `\`#${r.id}\` <t:${Math.floor(r.created_at / 1000)}:d> ${incoming.has(r.type) ? "🟢 +" : "🔴 −"}${app.economyService.format(guild.id, r.amount)} \`${r.type}\`${r.reason ? ` — ${truncate(r.reason, 40)}` : ""}`);
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🧾 ${t("eco.historyTitle")}${type ? ` (${type})` : ""}`,
      description: lines.join("\n") || t("ui.empty"),
      color: "info",
      footer: t("ui.page", { page: current, pages })
    })]
  };
}

function statsPayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const fmt = (v) => app.economyService.format(guild.id, v);
  const s = app.economyPlusRepo.stats(guild.id, Date.now() - 30 * 86_400_000);
  const money = app.economy.totalMoney(guild.id);
  const top = s.volume.slice(0, 8).map((v) => `\`${v.type}\` ×${v.c} — ${fmt(v.total)}`).join("\n") || "—";
  const loans = s.loans.map((l) => `${l.status}: ${l.c}${l.remaining ? ` (${fmt(l.remaining)})` : ""}`).join(" • ") || "—";
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `📈 ${t("eco.statsTitle")}`,
      color: "info",
      fields: [
        { name: t("eco.circulation"), value: `${fmt(money.total)} • ${money.accounts} ${t("eco.accounts")}`, inline: true },
        { name: t("eco.invested"), value: `${fmt(s.invested.total)} (${s.invested.c})`, inline: true },
        { name: t("eco.marketListings"), value: `${s.market}`, inline: true },
        { name: t("eco.shopRevenue"), value: `${fmt(s.shop.revenue)} • ${s.shop.purchases} (${s.shop.refunds} ↩)`, inline: true },
        { name: t("eco.loans"), value: loans, inline: true },
        { name: t("eco.volume30"), value: top }
      ]
    })]
  };
}

function shopPayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const fmt = (v) => app.economyService.format(guild.id, v);
  const items = app.economyPlusRepo.items(guild.id);
  const lines = items.slice(0, 25).map((i) => {
    const price = app.shop.price(i);
    const available = app.shop.available(i);
    const deal = i.discount_percent ? ` ~~${fmt(i.price)}~~ -${i.discount_percent}%` : "";
    const offer = i.offer_ends_at ? ` ⏳<t:${Math.floor(i.offer_ends_at / 1000)}:R>` : "";
    const stock = i.stock !== null ? ` • ${t("eco.stock")}: ${i.stock}` : "";
    const lvl = i.required_level ? ` • Lv ${i.required_level}+` : "";
    return `${available ? "" : "~~"}${i.emoji || { item: "📦", role: "🎭", cosmetic: "🎨", badge: "🏅" }[i.type]} **${i.name}** \`${i.key}\` — ${price === null ? "—" : fmt(price)}${deal}${offer}${stock}${lvl}${available ? "" : "~~"}${i.description ? `\n-# ${truncate(i.description, 90)}` : ""}`;
  });
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🛒 ${t("eco.shopTitle")}`,
      description: lines.join("\n") || t("eco.shopEmpty"),
      color: "primary",
      footer: t("eco.shopFooter")
    }, guild)]
  };
}

function inventoryPayload(app, guild, user) {
  const t = app.i18n.forGuild(guild.id);
  const rows = app.inventory.list(guild.id, user.id);
  const equipped = new Set(app.economyPlusRepo.equipped(guild.id, user.id).map((e) => e.item_key));
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🎒 ${t("eco.inventoryTitle", { user: user.username })}`,
      description: rows.map((r) => `${r.emoji} **${r.label}** ×${r.amount} \`${r.item_key}\`${equipped.has(r.item_key) ? " ✅" : ""}`).join("\n").slice(0, 4000) || t("ui.empty"),
      color: "neutral"
    })]
  };
}

function purchasesPayload(app, guild, userId) {
  const t = app.i18n.forGuild(guild.id);
  const rows = app.economyPlusRepo.purchases(guild.id, userId, 15);
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🧾 ${t("eco.purchasesTitle")}`,
      description: rows.map((p) => `\`#${p.id}\` <t:${Math.floor(p.created_at / 1000)}:d> ${p.quantity}× \`${p.item_key}\` — ${app.economyService.format(guild.id, p.total)}${p.refunded ? " ↩" : ""}`).join("\n") || t("ui.empty"),
      color: "info"
    })]
  };
}

function jobsPayload(app, guild, userId) {
  const t = app.i18n.forGuild(guild.id);
  const jobs = app.economyPlusRepo.jobs(guild.id);
  const mine = app.economyPlusRepo.memberJob(guild.id, userId);
  const cfg = app.economyPlus.config(guild.id).work || {};
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `💼 ${t("eco.jobsTitle")}`,
      color: "info",
      description: jobs.map((j) => `${mine?.id === j.id ? "✅" : "▫️"} ${j.emoji || "💼"} **${j.name}** — ${app.economyService.format(guild.id, j.min_pay)}–${app.economyService.format(guild.id, j.max_pay)}${j.required_level ? ` • Lv ${j.required_level}+` : ""}`).join("\n") ||
        t("eco.noJobs", { min: cfg.min ?? 100, max: cfg.max ?? 400 }),
      footer: t("eco.workCooldown", { time: formatDuration(cfg.cooldownMs ?? 3_600_000) })
    })]
  };
}

function plansPayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const cfg = app.economyPlus.config(guild.id).investments || {};
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `📊 ${t("eco.plansTitle")}`,
      color: "success",
      description: app.economyPlus.plans(guild.id).map((p) => `**${p.label || p.key}** \`${p.key}\` — ${p.days} ${t("eco.days")} • +${p.rate}%`).join("\n"),
      footer: t("eco.plansFooter", { penalty: cfg.earlyPenaltyPercent ?? 10, max: cfg.maxActive ?? 3 })
    })]
  };
}

function investmentsPayload(app, guild, userId) {
  const t = app.i18n.forGuild(guild.id);
  const fmt = (v) => app.economyService.format(guild.id, v);
  const rows = app.economyPlusRepo.investments(guild.id, userId);
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `📊 ${t("eco.investmentsTitle")}`,
      color: "info",
      description: rows.map((i) => `\`#${i.id}\` ${i.plan} — ${fmt(i.amount)} +${i.rate}% • ${i.status === "active" ? `⏳ <t:${Math.floor(i.matures_at / 1000)}:R>` : `${i.status} ${fmt(i.payout || 0)}`}`).join("\n") || t("ui.empty")
    })]
  };
}

function marketPayload(app, guild, page = 1) {
  const t = app.i18n.forGuild(guild.id);
  const total = app.economyPlusRepo.marketCount(guild.id);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const current = Math.min(Math.max(1, page), pages);
  const rows = app.economyPlusRepo.marketListings(guild.id, { limit: PER_PAGE, offset: (current - 1) * PER_PAGE });
  const tax = app.market.config(guild.id).market.taxPercent;
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🏪 ${t("eco.marketTitle")}`,
      color: "primary",
      description: rows.map((l) => {
        const d = app.inventory.describe(guild.id, l.item_key);
        return `\`#${l.id}\` ${d.emoji} ${l.quantity}× **${d.label}** — ${app.economyService.format(guild.id, l.price)} • <@${l.seller_id}>`;
      }).join("\n") || t("ui.empty"),
      footer: `${t("ui.page", { page: current, pages })} • ${t("eco.taxNote", { tax })}`
    })],
    allowedMentions: { parse: [] }
  };
}

function auctionsPayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const rows = app.economyPlusRepo.auctions(guild.id, 15);
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🔨 ${t("eco.auctionsTitle")}`,
      color: "warning",
      description: rows.map((a) => {
        const d = app.inventory.describe(guild.id, a.item_key);
        return `\`#${a.id}\` ${d.emoji} ${a.quantity}× **${d.label}** — ${app.economyService.format(guild.id, a.top_bid || a.min_bid)} • <t:${Math.floor(a.ends_at / 1000)}:R>`;
      }).join("\n") || t("ui.empty")
    })]
  };
}

function loansPayload(app, guild, userId) {
  const t = app.i18n.forGuild(guild.id);
  const fmt = (v) => app.economyService.format(guild.id, v);
  const active = app.economy.activeLoans(guild.id, userId);
  const pending = app.economy.pendingLoans(guild.id).filter((l) => l.user_id === userId);
  const cfg = app.economyPlus.loanConfig(guild.id);
  const lines = [
    ...active.map((l) => `\`#${l.id}\` ${fmt(l.amount)} → ${t("eco.remaining")}: **${fmt(l.remaining)}**${l.due_at ? ` • ${t("eco.due")} <t:${Math.floor(l.due_at / 1000)}:R>` : ""}`),
    ...pending.map((l) => `\`#${l.id}\` ${fmt(l.amount)} — 🕓 ${t("eco.pending")}`)
  ];
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🏦 ${t("eco.loansTitle")}`,
      color: "info",
      description: lines.join("\n") || t("ui.empty"),
      footer: cfg.enabled ? t("eco.loanTerms", { interest: cfg.interestPercent, days: cfg.termDays, max: fmt(cfg.maxAmount) }) : t("eco.err.disabled")
    })]
  };
}

async function notifyLoanRequest(app, guild, loan) {
  const t = app.i18n.forGuild(guild.id);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`eco:loan:${loan.id}:approve`).setLabel(t("eco.approve")).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`eco:loan:${loan.id}:reject`).setLabel(t("eco.reject")).setStyle(ButtonStyle.Danger)
  );
  const target = app.guildConfig.value(guild.id, "notifications.staffChannelId") ? "staff" : app.guildConfig.value(guild.id, "logs.economy") ? "channel" : null;
  if (!target) return;
  await app.notifications.notify({
    guildId: guild.id,
    targets: [target],
    channelId: app.guildConfig.value(guild.id, "logs.economy"),
    payload: {
      embeds: [app.theme.embed(guild.id, {
        title: `🏦 ${t("eco.loanRequestTitle")} #${loan.id}`,
        color: "warning",
        fields: [
          { name: t("eco.member"), value: `<@${loan.user_id}>`, inline: true },
          { name: t("eco.amount"), value: app.economyService.format(guild.id, loan.amount), inline: true },
          { name: t("common.reason"), value: truncate(loan.reason || "—", 500) }
        ]
      })],
      components: [row]
    }
  });
}

/** أوامر /اقتصاد admin — مستوى أدمن مطلوب، يُفحص من الخادم. */
async function adminExecute(ctx, sub, ShopService) {
  const app = ctx.app;
  const guild = ctx.guild;
  const o = ctx.interaction?.options;
  const t = (k, v) => ctx.t(k, v);
  if (app.permissions.resolveLevel(ctx.member) < Level.ADMIN) return ctx.fail("errors.noPermission");
  if (!o) return ctx.fail("errors.actionFailed", { details: t("eco.err.slashOnly") });
  const repo = app.economyPlusRepo;

  if (sub === "item-add") {
    const key = o.getString("key").toLowerCase();
    if (!ShopService.validKey(key)) return ctx.fail("errors.actionFailed", { details: t("eco.err.badKey") });
    const type = o.getString("type");
    const role = o.getRole("role");
    const badge = o.getString("badge");
    const value = o.getString("value");
    if (type === "role" && !role) return ctx.fail("errors.actionFailed", { details: t("eco.err.needRole") });
    if (type === "badge" && !badge) return ctx.fail("errors.actionFailed", { details: t("eco.err.needBadge") });
    if (type === "cosmetic" && !/^https:\/\/\S+$/i.test(value || "")) return ctx.fail("errors.actionFailed", { details: t("eco.err.needValue") });
    if (type === "badge" && app.rewardsRepo && !app.rewardsRepo.badge(guild.id, badge)) {
      app.rewardsRepo.upsertBadge(guild.id, { key: badge, name: o.getString("name"), emoji: o.getString("emoji") || "🏅" });
    }
    const item = repo.upsertItem(guild.id, {
      key, name: o.getString("name"), type, price: o.getInteger("price"), sellPrice: o.getInteger("sell"),
      stock: o.getInteger("stock"), roleId: role?.id, badgeKey: badge, emoji: o.getString("emoji"),
      data: type === "cosmetic" ? { slot: "rankBackground", value } : null,
      perUserLimit: o.getInteger("limit"), requiredLevel: o.getInteger("level") || 0
    });
    return ctx.success(t("eco.itemSaved", { item: item.name, key: item.key }));
  }

  if (sub === "item-edit") {
    const key = o.getString("item");
    if (!repo.itemByKey(guild.id, key)) return fail(ctx, { reason: "notFound" });
    const stock = o.getInteger("stock");
    const hours = o.getInteger("offer-hours");
    repo.updateItem(guild.id, key, {
      price: o.getInteger("price") ?? undefined,
      stock: stock === null ? undefined : stock < 0 ? null : stock,
      discount: o.getInteger("discount") ?? undefined,
      offerEndsAt: hours === null ? undefined : hours === 0 ? null : Date.now() + hours * 3_600_000,
      enabled: o.getBoolean("enabled") ?? undefined
    });
    return ctx.reply(shopPayload(app, guild), { ephemeral: true });
  }

  if (sub === "refund") {
    const res = await app.shop.refund(guild, o.getInteger("id"), ctx.user.id);
    if (!res.ok) return fail(ctx, res);
    return ctx.success(t("eco.refunded", { id: res.purchase.id, total: app.economyService.format(guild.id, res.purchase.total) }));
  }

  if (sub === "job-add") {
    const min = o.getInteger("min");
    const max = o.getInteger("max");
    if (min > max) return fail(ctx, { reason: "minMax" });
    const job = repo.addJob(guild.id, { name: o.getString("name"), minPay: min, maxPay: max, requiredLevel: o.getInteger("level") || 0 });
    return ctx.success(t("eco.jobSaved", { job: job.name }));
  }

  if (sub === "job-remove") {
    return repo.removeJob(guild.id, o.getInteger("job")) ? ctx.success(t("eco.jobRemoved")) : fail(ctx, { reason: "notFound" });
  }

  if (sub === "loans") {
    const pending = app.economy.pendingLoans(guild.id).slice(0, 10);
    return ctx.reply({
      embeds: [ctx.embed({
        title: `🏦 ${t("eco.pendingLoans")}`,
        color: "warning",
        description: pending.map((l) => `\`#${l.id}\` <@${l.user_id}> — ${app.economyService.format(guild.id, l.amount)}${l.reason ? ` — ${truncate(l.reason, 60)}` : ""}`).join("\n") || t("ui.empty")
      })],
      components: pending.slice(0, 4).map((l) => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`eco:loan:${l.id}:approve`).setLabel(`✅ #${l.id}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`eco:loan:${l.id}:reject`).setLabel(`❌ #${l.id}`).setStyle(ButtonStyle.Danger)
      )),
      allowedMentions: { parse: [] }
    }, { ephemeral: true });
  }

  if (sub === "settings") {
    const updates = {};
    for (const k of ["daily", "weekly", "monthly"]) if (o.getInteger(k) !== null) updates[`economy.${k}.amount`] = o.getInteger(k);
    if (o.getBoolean("rob") !== null) updates["economy.rob.enabled"] = o.getBoolean("rob");
    if (o.getBoolean("loans") !== null) updates["economy.loans.enabled"] = o.getBoolean("loans");
    if (o.getInteger("interest") !== null) updates["economy.loans.interestPercent"] = o.getInteger("interest");
    if (o.getInteger("market-tax") !== null) updates["economy.market.taxPercent"] = o.getInteger("market-tax");
    if (Object.keys(updates).length) app.guildConfig.setMany(guild.id, updates);
    const c = app.economyPlus.config(guild.id);
    const fmt = (v) => app.economyService.format(guild.id, v || 0);
    return ctx.reply({
      embeds: [ctx.embed({
        title: `⚙️ ${t("eco.settingsTitle")}`,
        color: "info",
        fields: [
          { name: t("eco.claim.daily"), value: fmt(c.daily?.amount), inline: true },
          { name: t("eco.claim.weekly"), value: fmt(c.weekly?.amount), inline: true },
          { name: t("eco.claim.monthly"), value: fmt(c.monthly?.amount), inline: true },
          { name: t("eco.robLabel"), value: c.rob?.enabled ? "✅" : "❌", inline: true },
          { name: t("eco.loans"), value: `${c.loans?.enabled ? "✅" : "❌"} ${c.loans?.interestPercent ?? 10}%`, inline: true },
          { name: t("eco.marketTax"), value: `${c.market?.taxPercent ?? 5}%`, inline: true }
        ]
      })]
    }, { ephemeral: true });
  }
  return ctx.fail("errors.actionFailed", { details: sub });
}

module.exports = {
  fail, historyPayload, statsPayload, shopPayload, inventoryPayload, purchasesPayload, jobsPayload,
  plansPayload, investmentsPayload, marketPayload, auctionsPayload, loansPayload, notifyLoanRequest, adminExecute
};
