const { SlashCommandBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { parseDuration, parseAmount, formatDuration } = require("../../../core/utils/common");
const views = require("../views");
const ShopService = require("../ShopService");

const itemTypes = [
  { name: "عنصر", value: "item" }, { name: "رتبة", value: "role" }, { name: "تجميلي", value: "cosmetic" }, { name: "شارة", value: "badge" }
];

const opt = {
  item: (o, d = "العنصر", req = true) => o.setName("item").setDescription(d).setRequired(req).setAutocomplete(true),
  qty: (o) => o.setName("qty").setDescription("الكمية").setMinValue(1).setMaxValue(1000),
  amount: (o, req = true) => o.setName("amount").setDescription("المبلغ (يدعم 10k)").setRequired(req).setMaxLength(15),
  id: (o) => o.setName("id").setDescription("الرقم").setRequired(true).setMinValue(1)
};

function amountFrom(ctx, name, position) {
  const raw = ctx.isSlash ? ctx.interaction.options.getString(name) : ctx.args[position];
  const v = parseAmount(raw);
  return v && v > 0 ? v : null;
}

module.exports = [
  {
    name: "اقتصاد",
    aliases: ["economy", "eco", "daily", "weekly", "monthly", "work", "rob", "shop", "bag"],
    aliasRoutes: {
      daily: { sub: "daily" }, weekly: { sub: "weekly" }, monthly: { sub: "monthly" }, work: { sub: "work" }, rob: { sub: "rob" },
      shop: { group: "shop", sub: "list" }, bag: { group: "shop", sub: "inventory" }
    },
    subAliases: { يومي: "daily", اسبوعي: "weekly", شهري: "monthly", عمل: "work", سرقة: "rob", سجل: "history", احصائيات: "stats", متجر: "shop", وظائف: "jobs", استثمار: "invest", سوق: "market", مزاد: "auction", تداول: "trade", قرض: "loan" },
    description: "توسعة الاقتصاد: يومي/أسبوعي/شهري، عمل ووظائف، سرقة، متجر وحقيبة، سوق، مزادات، تداول، استثمار، قروض، سجل وإحصاءات.",
    usage: "/اقتصاد daily | /اقتصاد shop buy item:vip | !daily | !work | !shop",
    arguments: [
      { name: "daily/weekly/monthly", required: false, description: "المكافآت الدورية (اليومي بسلسلة أيام)" },
      { name: "work", required: false, description: "العمل حسب وظيفتك" },
      { name: "rob", required: false, description: "محاولة سرقة جيب عضو" },
      { name: "shop", required: false, description: "المتجر والحقيبة والتجهيز" },
      { name: "market / auction / trade", required: false, description: "التجارة بين الأعضاء" },
      { name: "invest / loan", required: false, description: "الاستثمار والقروض" },
      { name: "admin", required: false, description: "إدارة المتجر والوظائف والقروض" }
    ],
    examples: ["!daily", "/اقتصاد shop buy item:vip qty:1", "/اقتصاد market sell item:gold qty:5 price:10k", "/اقتصاد invest start plan:mid amount:50k"],
    category: "economy",
    systemFlag: "economy.enabled",
    feature: "economy",
    cooldown: 2000,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("اقتصاد")
      .setDescription("الاقتصاد الموسّع")
      .addSubcommand((s) => s.setName("daily").setDescription("المكافأة اليومية"))
      .addSubcommand((s) => s.setName("weekly").setDescription("المكافأة الأسبوعية"))
      .addSubcommand((s) => s.setName("monthly").setDescription("المكافأة الشهرية"))
      .addSubcommand((s) => s.setName("work").setDescription("اعمل واكسب"))
      .addSubcommand((s) => s.setName("rob").setDescription("سرقة جيب عضو")
        .addUserOption((o) => o.setName("user").setDescription("الهدف").setRequired(true)))
      .addSubcommand((s) => s.setName("history").setDescription("سجل حركاتك")
        .addStringOption((o) => o.setName("type").setDescription("نوع الحركة").setMaxLength(30))
        .addIntegerOption((o) => o.setName("page").setDescription("الصفحة").setMinValue(1)))
      .addSubcommand((s) => s.setName("stats").setDescription("إحصاءات الاقتصاد"))
      .addSubcommandGroup((g) => g.setName("shop").setDescription("المتجر")
        .addSubcommand((s) => s.setName("list").setDescription("عرض المتجر"))
        .addSubcommand((s) => s.setName("buy").setDescription("شراء").addStringOption((o) => opt.item(o)).addIntegerOption(opt.qty))
        .addSubcommand((s) => s.setName("sell").setDescription("بيع للمتجر").addStringOption((o) => opt.item(o)).addIntegerOption(opt.qty))
        .addSubcommand((s) => s.setName("inventory").setDescription("الحقيبة").addUserOption((o) => o.setName("user").setDescription("العضو")))
        .addSubcommand((s) => s.setName("equip").setDescription("تجهيز عنصر تجميلي").addStringOption((o) => opt.item(o)))
        .addSubcommand((s) => s.setName("purchases").setDescription("مشترياتك")))
      .addSubcommandGroup((g) => g.setName("jobs").setDescription("الوظائف")
        .addSubcommand((s) => s.setName("list").setDescription("الوظائف المتاحة"))
        .addSubcommand((s) => s.setName("apply").setDescription("التقديم على وظيفة").addIntegerOption((o) => o.setName("job").setDescription("الوظيفة").setRequired(true).setAutocomplete(true))))
      .addSubcommandGroup((g) => g.setName("invest").setDescription("الاستثمار")
        .addSubcommand((s) => s.setName("plans").setDescription("الخطط"))
        .addSubcommand((s) => s.setName("start").setDescription("استثمار جديد")
          .addStringOption((o) => o.setName("plan").setDescription("الخطة").setRequired(true).setAutocomplete(true))
          .addStringOption((o) => opt.amount(o)))
        .addSubcommand((s) => s.setName("list").setDescription("استثماراتك"))
        .addSubcommand((s) => s.setName("close").setDescription("سحب استثمار").addIntegerOption(opt.id)))
      .addSubcommandGroup((g) => g.setName("market").setDescription("السوق")
        .addSubcommand((s) => s.setName("list").setDescription("العروض").addIntegerOption((o) => o.setName("page").setDescription("الصفحة").setMinValue(1)))
        .addSubcommand((s) => s.setName("sell").setDescription("عرض للبيع").addStringOption((o) => opt.item(o)).addIntegerOption((o) => opt.qty(o).setRequired(true)).addStringOption((o) => o.setName("price").setDescription("السعر الإجمالي").setRequired(true).setMaxLength(15)))
        .addSubcommand((s) => s.setName("buy").setDescription("شراء عرض").addIntegerOption(opt.id))
        .addSubcommand((s) => s.setName("cancel").setDescription("إلغاء عرضك").addIntegerOption(opt.id)))
      .addSubcommandGroup((g) => g.setName("auction").setDescription("المزادات")
        .addSubcommand((s) => s.setName("start").setDescription("مزاد جديد").addStringOption((o) => opt.item(o)).addIntegerOption((o) => opt.qty(o).setRequired(true))
          .addStringOption((o) => o.setName("min").setDescription("أقل مزايدة").setRequired(true).setMaxLength(15))
          .addStringOption((o) => o.setName("duration").setDescription("المدة (1h, 2d)").setRequired(true).setMaxLength(10)))
        .addSubcommand((s) => s.setName("bid").setDescription("مزايدة").addIntegerOption(opt.id).addStringOption((o) => opt.amount(o)))
        .addSubcommand((s) => s.setName("list").setDescription("المزادات الجارية"))
        .addSubcommand((s) => s.setName("cancel").setDescription("إلغاء مزادك (بلا مزايدات)").addIntegerOption(opt.id)))
      .addSubcommandGroup((g) => g.setName("trade").setDescription("التداول")
        .addSubcommand((s) => s.setName("offer").setDescription("عرض تداول على عضو")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addStringOption((o) => o.setName("give-money").setDescription("مال تعطيه").setMaxLength(15))
          .addStringOption((o) => o.setName("give-item").setDescription("عنصر تعطيه").setAutocomplete(true))
          .addIntegerOption((o) => o.setName("give-qty").setDescription("كميته").setMinValue(1))
          .addStringOption((o) => o.setName("want-money").setDescription("مال تطلبه").setMaxLength(15))
          .addStringOption((o) => o.setName("want-item").setDescription("مفتاح عنصر تطلبه").setMaxLength(40))
          .addIntegerOption((o) => o.setName("want-qty").setDescription("كميته").setMinValue(1))))
      .addSubcommandGroup((g) => g.setName("loan").setDescription("القروض")
        .addSubcommand((s) => s.setName("request").setDescription("طلب قرض").addStringOption((o) => opt.amount(o)).addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(200)))
        .addSubcommand((s) => s.setName("repay").setDescription("سداد").addStringOption((o) => opt.amount(o, false)))
        .addSubcommand((s) => s.setName("status").setDescription("قروضك")))
      .addSubcommandGroup((g) => g.setName("admin").setDescription("إدارة الاقتصاد")
        .addSubcommand((s) => s.setName("item-add").setDescription("إضافة/تحديث عنصر")
          .addStringOption((o) => o.setName("key").setDescription("المفتاح (a-z0-9_-)").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("name").setDescription("الاسم").setRequired(true).setMaxLength(60))
          .addStringOption((o) => o.setName("type").setDescription("النوع").setRequired(true).addChoices(...itemTypes))
          .addIntegerOption((o) => o.setName("price").setDescription("السعر").setRequired(true).setMinValue(0))
          .addIntegerOption((o) => o.setName("sell").setDescription("سعر البيع للمتجر").setMinValue(0))
          .addIntegerOption((o) => o.setName("stock").setDescription("المخزون (فارغ = بلا حد)").setMinValue(0))
          .addRoleOption((o) => o.setName("role").setDescription("للنوع رتبة"))
          .addStringOption((o) => o.setName("badge").setDescription("مفتاح الشارة").setMaxLength(32))
          .addStringOption((o) => o.setName("value").setDescription("للتجميلي: رابط الخلفية https://").setMaxLength(500))
          .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(40))
          .addIntegerOption((o) => o.setName("limit").setDescription("حد لكل عضو").setMinValue(1))
          .addIntegerOption((o) => o.setName("level").setDescription("مستوى مطلوب").setMinValue(0)))
        .addSubcommand((s) => s.setName("item-edit").setDescription("تعديل عنصر").addStringOption((o) => opt.item(o))
          .addIntegerOption((o) => o.setName("price").setDescription("السعر").setMinValue(0))
          .addIntegerOption((o) => o.setName("stock").setDescription("المخزون (-1 = بلا حد)").setMinValue(-1))
          .addIntegerOption((o) => o.setName("discount").setDescription("خصم %").setMinValue(0).setMaxValue(100))
          .addIntegerOption((o) => o.setName("offer-hours").setDescription("عرض محدود لعدد ساعات (0 = إلغاء)").setMinValue(0).setMaxValue(8760))
          .addBooleanOption((o) => o.setName("enabled").setDescription("متاح")))
        .addSubcommand((s) => s.setName("refund").setDescription("استرجاع شراء").addIntegerOption(opt.id))
        .addSubcommand((s) => s.setName("job-add").setDescription("إضافة وظيفة")
          .addStringOption((o) => o.setName("name").setDescription("الاسم").setRequired(true).setMaxLength(40))
          .addIntegerOption((o) => o.setName("min").setDescription("أقل أجر").setRequired(true).setMinValue(1))
          .addIntegerOption((o) => o.setName("max").setDescription("أعلى أجر").setRequired(true).setMinValue(1))
          .addIntegerOption((o) => o.setName("level").setDescription("مستوى مطلوب").setMinValue(0)))
        .addSubcommand((s) => s.setName("job-remove").setDescription("حذف وظيفة").addIntegerOption((o) => o.setName("job").setDescription("الوظيفة").setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName("loans").setDescription("طلبات القروض المعلقة"))),

    async autocomplete(interaction, app) {
      const focused = interaction.options.getFocused(true);
      const guildId = interaction.guild.id;
      const typed = String(focused.value || "").toLowerCase();
      let list;
      const group = interaction.options.getSubcommandGroup(false);
      const sub = interaction.options.getSubcommand(false);
      if (focused.name === "job") list = app.economyPlusRepo.jobs(guildId).map((j) => ({ name: `${j.emoji || "💼"} ${j.name} (${j.min_pay}-${j.max_pay})`, value: j.id }));
      else if (focused.name === "plan") list = app.economyPlus.plans(guildId).map((p) => ({ name: `${p.label || p.key} — ${p.days}d +${p.rate}%`, value: p.key }));
      else if ((group === "shop" && sub === "buy") || group === "admin") {
        list = app.economyPlusRepo.items(guildId, { includeDisabled: group === "admin" }).map((i) => ({ name: `${i.emoji || ""} ${i.name} — ${i.price}`.trim().slice(0, 100), value: i.key }));
      } else {
        list = app.inventory.list(guildId, interaction.user.id).map((r) => ({ name: `${r.emoji} ${r.label} ×${r.amount}`.slice(0, 100), value: r.item_key }));
      }
      return interaction.respond(list.filter((x) => x.name.toLowerCase().includes(typed)).slice(0, 25));
    },

    async execute(ctx) {
      const app = ctx.app;
      const eco = app.economyPlus;
      const guild = ctx.guild;
      const group = ctx.subcommandGroup();
      const sub = ctx.subcommand();
      const t = (k, v) => ctx.t(k, v);
      const o = ctx.interaction?.options;
      const fmt = (v) => eco.format(guild.id, v);
      const fail = (res) => views.fail(ctx, res);

      if (!group) {
        if (["daily", "weekly", "monthly"].includes(sub)) {
          const res = eco.claimPeriodic(ctx.member, sub);
          if (!res.ok) return fail(res);
          return ctx.reply({ embeds: [ctx.embed({
            title: `🎁 ${t(`eco.claim.${sub}`)}`,
            color: "success",
            description: t("eco.claimed", { amount: fmt(res.amount) }) + (res.streakBonus ? `\n🔥 ${t("eco.streak", { streak: res.streak, bonus: fmt(res.streakBonus) })}` : ""),
            fields: [{ name: t("eco.wallet"), value: fmt(res.account.wallet), inline: true }, { name: t("eco.next"), value: `<t:${Math.floor(res.next / 1000)}:R>`, inline: true }]
          })] });
        }
        if (sub === "work") {
          const res = eco.work(ctx.member);
          if (!res.ok) return fail(res);
          return ctx.reply({ embeds: [ctx.embed({ title: `💼 ${res.job ? res.job.name : t("eco.workTitle")}`, color: "success", description: t("eco.worked", { amount: fmt(res.amount) }), fields: [{ name: t("eco.wallet"), value: fmt(res.account.wallet), inline: true }] })] });
        }
        if (sub === "rob") {
          const target = await ctx.getMember("user", 0);
          if (!target) return ctx.fail("errors.memberNotFound");
          const res = eco.rob(ctx.member, target);
          if (!res.ok) return fail(res);
          return ctx.reply({
            content: res.success ? `🦹 ${t("eco.robSuccess", { amount: fmt(res.amount), user: `<@${target.id}>` })}` : `🚓 ${t("eco.robFail", { fine: fmt(res.fine) })}`,
            allowedMentions: { users: [target.id] }
          });
        }
        if (sub === "history") return ctx.reply(views.historyPayload(app, guild, ctx.user.id, { type: ctx.getString("type", 0), page: ctx.getNumber("page", 1) || 1 }), { ephemeral: true });
        if (sub === "stats") return ctx.reply(views.statsPayload(app, guild));
      }

      if (group === "shop") {
        if (sub === "list") return ctx.reply(views.shopPayload(app, guild));
        if (sub === "buy") {
          const res = await app.shop.buy(ctx.member, ctx.getString("item", 0), ctx.getNumber("qty", 1) || 1);
          if (!res.ok) return fail(res);
          return ctx.success(t("eco.bought", { qty: ctx.getNumber("qty", 1) || 1, item: res.item.name, total: fmt(res.total), id: res.purchaseId }));
        }
        if (sub === "sell") {
          const key = String(ctx.getString("item", 0) || "").replace(/^shop\./, "");
          const res = app.shop.sell(ctx.member, key, ctx.getNumber("qty", 1) || 1);
          if (!res.ok) return fail(res);
          return ctx.success(t("eco.sold", { total: fmt(res.total) }));
        }
        if (sub === "inventory") {
          const user = (await ctx.getUser("user", 0)) || ctx.user;
          return ctx.reply(views.inventoryPayload(app, guild, user), { ephemeral: ctx.isSlash });
        }
        if (sub === "equip") {
          const res = app.shop.equip(ctx.member, String(ctx.getString("item", 0) || "").replace(/^shop\./, ""));
          if (!res.ok) return fail(res);
          return ctx.success(t("eco.equipped", { item: res.item.name }));
        }
        if (sub === "purchases") return ctx.reply(views.purchasesPayload(app, guild, ctx.user.id), { ephemeral: true });
      }

      if (group === "jobs") {
        if (sub === "list") return ctx.reply(views.jobsPayload(app, guild, ctx.user.id));
        const res = eco.applyJob(ctx.member, ctx.getNumber("job", 0));
        if (!res.ok) return fail(res);
        return ctx.success(t("eco.jobApplied", { job: res.job.name }));
      }

      if (group === "invest") {
        if (sub === "plans") return ctx.reply(views.plansPayload(app, guild));
        if (sub === "list") return ctx.reply(views.investmentsPayload(app, guild, ctx.user.id), { ephemeral: true });
        if (sub === "start") {
          const res = eco.invest(ctx.member, ctx.getString("plan", 0), amountFrom(ctx, "amount", 1));
          if (!res.ok) return fail(res);
          return ctx.success(t("eco.invested", { amount: fmt(amountFrom(ctx, "amount", 1)), plan: res.plan.label || res.plan.key, date: `<t:${Math.floor(res.maturesAt / 1000)}:R>` }));
        }
        if (sub === "close") {
          const res = eco.closeInvestment(ctx.member, ctx.getNumber("id", 0));
          if (!res.ok) return fail(res);
          return ctx.success(t(res.matured ? "eco.investClaimed" : "eco.investWithdrawn", { amount: fmt(res.payout) }));
        }
      }

      if (group === "market") {
        if (sub === "list") return ctx.reply(views.marketPayload(app, guild, ctx.getNumber("page", 0) || 1));
        if (sub === "sell") {
          const key = app.inventory.resolveKey(guild.id, ctx.user.id, ctx.getString("item", 0));
          const res = app.market.list(ctx.member, key, ctx.getNumber("qty", 1), amountFrom(ctx, "price", 2));
          if (!res.ok) return fail(res);
          return ctx.success(t("eco.listed", { id: res.id }));
        }
        if (sub === "buy") {
          const res = app.market.buy(ctx.member, ctx.getNumber("id", 0));
          if (!res.ok) return fail(res);
          return ctx.success(t("eco.marketBought", { id: res.listing.id, total: fmt(res.listing.price) }));
        }
        if (sub === "cancel") {
          const force = app.permissions.resolveLevel(ctx.member) >= Level.ADMIN;
          const res = app.economyPlusRepo.cancelListing({ guildId: guild.id, userId: ctx.user.id, listingId: ctx.getNumber("id", 0), force });
          if (!res.ok) return fail(res);
          return ctx.success(t("eco.listingCancelled", { id: res.listing.id }));
        }
      }

      if (group === "auction") {
        if (sub === "list") return ctx.reply(views.auctionsPayload(app, guild));
        if (sub === "start") {
          const key = app.inventory.resolveKey(guild.id, ctx.user.id, ctx.getString("item", 0));
          const duration = parseDuration(ctx.getString("duration", 3));
          if (!duration) return ctx.fail("errors.invalidDuration");
          const res = await app.market.startAuction(ctx.member, ctx.channel, { itemKey: key, quantity: ctx.getNumber("qty", 1), minBid: amountFrom(ctx, "min", 2), durationMs: duration });
          if (!res.ok) return fail(res);
          return ctx.reply({ content: `${ctx.emoji("success")} ${t("eco.auctionStarted", { id: res.auction.id, duration: formatDuration(duration) })}` }, { ephemeral: true });
        }
        if (sub === "bid") {
          const res = app.market.bid(ctx.member, ctx.getNumber("id", 0), amountFrom(ctx, "amount", 1));
          if (!res.ok) return fail(res);
          return ctx.success(t("eco.bidPlaced", { id: ctx.getNumber("id", 0), amount: fmt(amountFrom(ctx, "amount", 1)) }));
        }
        if (sub === "cancel") {
          const force = app.permissions.resolveLevel(ctx.member) >= Level.ADMIN;
          const res = app.economyPlusRepo.cancelAuction(ctx.getNumber("id", 0), ctx.user.id, force);
          if (!res.ok) return fail(res);
          app.scheduler.cancelByKey(`auction:${res.auction.id}`);
          return ctx.success(t("eco.auctionCancelled", { id: res.auction.id }));
        }
      }

      if (group === "trade") {
        const target = await ctx.getMember("user", 0);
        if (!target) return ctx.fail("errors.memberNotFound");
        const giveItem = o.getString("give-item") ? app.inventory.resolveKey(guild.id, ctx.user.id, o.getString("give-item")) : null;
        const wantItemRaw = o.getString("want-item");
        const offer = {
          offerMoney: parseAmount(o.getString("give-money")) || 0,
          offerItem: giveItem, offerQty: giveItem ? o.getInteger("give-qty") || 1 : 0,
          wantMoney: parseAmount(o.getString("want-money")) || 0,
          wantItem: wantItemRaw ? (app.economyPlusRepo.itemByKey(guild.id, wantItemRaw) ? `shop.${wantItemRaw}` : wantItemRaw) : null,
          wantQty: wantItemRaw ? o.getInteger("want-qty") || 1 : 0
        };
        const res = app.market.proposeTrade(ctx.member, target, offer);
        if (!res.ok) return fail(res);
        return ctx.reply(app.market.tradePayload(guild, res.trade));
      }

      if (group === "loan") {
        if (sub === "status") return ctx.reply(views.loansPayload(app, guild, ctx.user.id), { ephemeral: true });
        if (sub === "request") {
          const res = await eco.requestLoan(ctx.member, amountFrom(ctx, "amount", 0), ctx.isSlash ? o.getString("reason") : ctx.args.slice(1).join(" "));
          if (!res.ok) return fail(res);
          await views.notifyLoanRequest(app, guild, res.loan);
          return ctx.reply({ content: `${ctx.emoji("success")} ${t("eco.loanRequested", { id: res.loan.id })}` }, { ephemeral: true });
        }
        if (sub === "repay") {
          const res = eco.repayLoan(ctx.member, null, amountFrom(ctx, "amount", 0));
          if (!res.ok) return fail(res);
          return ctx.success(t("eco.loanRepaid", { amount: fmt(res.paid), remaining: fmt(res.loan.remaining) }));
        }
      }

      if (group === "admin") return views.adminExecute(ctx, sub, ShopService);

      return ctx.fail("errors.actionFailed", { details: `${group || ""} ${sub || ""}` });
    }
  }
];
