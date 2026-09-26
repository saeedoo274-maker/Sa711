const { SlashCommandBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { historyPayload } = require("../views");

const lbTypes = ["xp", "level", "messages", "voice", "activity", "economy", "tickets", "staff", "achievements", "reputation", "games", "invites", "giveaways", "stars"];
const lbPeriods = [{ name: "الكل", value: "all" }, { name: "اليوم", value: "today" }, { name: "7 أيام", value: "7d" }, { name: "30 يومًا", value: "30d" }, { name: "90 يومًا", value: "90d" }, { name: "سنة", value: "year" }];

module.exports = [
  {
    name: "عضو",
    aliases: ["member", "whois", "سجل_عضو", "achievements", "ach", "badges", "leaderboards", "انجازات", "شارات", "متصدرين"],
    aliasRoutes: {
      whois: { sub: "history" }, "سجل_عضو": { sub: "history" }, achievements: { sub: "achievements" }, ach: { sub: "achievements" },
      "انجازات": { sub: "achievements" }, badges: { sub: "badges" }, "شارات": { sub: "badges" }, leaderboards: { sub: "leaderboard" }, "متصدرين": { sub: "leaderboard" }
    },
    subAliases: { سجل: "history", بحث: "lookup", انجازات: "achievements", شارات: "badges", ترتيب: "leaderboard", دعوات: "invites", استئناف: "appeal" },
    defaultSubcommand: "history",
    description: "ملف العضو: السجل الكامل (أسماء، رتب، دخول/خروج، إدارة، تذاكر، تقديمات، نشاط، XP، اقتصاد) والبحث.",
    usage: "/عضو history user:@عضو | /عضو lookup query:الاسم",
    arguments: [
      { name: "history", required: false, description: "سجل عضو (طاقم)" },
      { name: "lookup", required: false, description: "بحث بالاسم الحالي أو القديم (طاقم)" },
      { name: "achievements", required: false, description: "إنجازاتك وتقدمك" },
      { name: "badges", required: false, description: "شاراتك" },
      { name: "leaderboard", required: false, description: "لوحات المتصدرين (14 نوعًا)" },
      { name: "invites", required: false, description: "دعوات عضو ومن دعاه" },
      { name: "appeal", required: false, description: "استئناف تحذير أو إسكات (سلاش)" }
    ],
    examples: ["/عضو history user:@عضو", "!whois 123456789012345678", "/عضو lookup query:ahmed"],
    category: "member",
    cooldown: 3000,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("عضو")
      .setDescription("ملف العضو")
      .addSubcommand((s) => s.setName("history").setDescription("السجل الكامل لعضو")
        .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true)))
      .addSubcommand((s) => s.setName("lookup").setDescription("بحث بالأسماء (الحالية والقديمة)")
        .addStringOption((o) => o.setName("query").setDescription("الاسم أو جزء منه").setRequired(true).setMinLength(2).setMaxLength(50)))
      .addSubcommand((s) => s.setName("achievements").setDescription("الإنجازات").addUserOption((o) => o.setName("user").setDescription("العضو")))
      .addSubcommand((s) => s.setName("badges").setDescription("الشارات").addUserOption((o) => o.setName("user").setDescription("العضو")))
      .addSubcommand((s) => s.setName("leaderboard").setDescription("لوحات المتصدرين")
        .addStringOption((o) => o.setName("type").setDescription("النوع").addChoices(...lbTypes.map((v) => ({ name: v, value: v }))))
        .addStringOption((o) => o.setName("period").setDescription("الفترة").addChoices(...lbPeriods)))
      .addSubcommand((s) => s.setName("invites").setDescription("الدعوات").addUserOption((o) => o.setName("user").setDescription("العضو")))
      .addSubcommand((s) => s.setName("appeal").setDescription("استئناف عقوبة")
        .addIntegerOption((o) => o.setName("case").setDescription("رقم القضية").setRequired(true).setMinValue(1))),

    async execute(ctx) {
      const app = ctx.app;
      const sub = ctx.subcommand() || "history";
      const staff = app.permissions.resolveLevel(ctx.member) >= Level.STAFF;
      const t = (k, v) => ctx.t(k, v);

      if (sub === "history") {
        if (!staff) return ctx.fail("errors.noPermission");
        if (!app.features.isEnabled(ctx.guild.id, "history")) return ctx.fail("errors.systemDisabled", { system: "history" });
        const user = await ctx.getUser("user", 0);
        if (!user) return ctx.fail("errors.userNotFound");
        const member = await ctx.guild.members.fetch(user.id).catch(() => null);
        return ctx.reply(historyPayload(app, ctx.guild, user, member, "overview", ctx.user.id), { ephemeral: ctx.isSlash });
      }

      if (sub === "lookup") {
        if (!staff) return ctx.fail("errors.noPermission");
        const query = ctx.isSlash ? ctx.interaction.options.getString("query") : ctx.args.join(" ");
        if (!query || query.length < 2) return ctx.fail("errors.actionFailed", { details: t("member.queryShort") });
        const rows = app.historyRepo.searchByName(ctx.guild.id, query, 20);
        // الأعضاء الحاليون بالاسم أيضًا (من الكاش، بلا جلب ثقيل)
        const q = query.toLowerCase();
        const live = [...ctx.guild.members.cache.values()]
          .filter((m) => [m.user.username, m.displayName, m.nickname].some((n) => n && n.toLowerCase().includes(q)))
          .slice(0, 10)
          .map((m) => ({ user_id: m.id, names: m.displayName }));
        const merged = new Map();
        for (const r of [...live, ...rows]) if (!merged.has(r.user_id)) merged.set(r.user_id, r);
        return ctx.reply({
          embeds: [ctx.embed({
            title: `🔎 ${t("member.lookupTitle", { query })}`,
            description: [...merged.values()].slice(0, 20).map((r) => `<@${r.user_id}> \`${r.user_id}\` — ${String(r.names || "").slice(0, 80)}`).join("\n") || t("ui.empty"),
            color: "info"
          })],
          allowedMentions: { parse: [] }
        }, { ephemeral: ctx.isSlash });
      }
      if (sub === "achievements") {
        if (!app.achievements || !app.features.isEnabled(ctx.guild.id, "achievements")) return ctx.fail("errors.systemDisabled", { system: "achievements" });
        const user = (await ctx.getUser("user", 0)) || ctx.user;
        await app.achievements.flush();
        return ctx.reply(app.achievements.payload(ctx.guild, user));
      }

      if (sub === "badges") {
        if (!app.rewardsRepo) return ctx.fail("errors.systemDisabled", { system: "rewards" });
        const user = (await ctx.getUser("user", 0)) || ctx.user;
        const rows = app.rewardsRepo.memberBadges(ctx.guild.id, user.id);
        return ctx.reply({
          embeds: [ctx.embed({
            title: `🏅 ${t("member.badgesTitle", { user: user.username })}`,
            color: "warning",
            description: rows.map((b) => `${b.emoji || "🏅"} **${b.name || b.badge}** — <t:${Math.floor(b.awarded_at / 1000)}:d>${b.description ? `\n-# ${b.description}` : ""}`).join("\n") || t("ui.empty")
          })]
        });
      }

      if (sub === "leaderboard") {
        if (!app.leaderboards) return ctx.fail("errors.systemDisabled", { system: "leaderboards" });
        const type = ctx.getString("type", 0) || "xp";
        const period = ctx.getString("period", 1) || "all";
        return ctx.reply(app.leaderboards.payload(ctx.guild, { type: lbTypes.includes(type) ? type : "xp", period, page: 1, ownerId: ctx.user.id }));
      }

      if (sub === "invites") {
        if (!app.invites || !app.features.isEnabled(ctx.guild.id, "invites")) return ctx.fail("errors.systemDisabled", { system: "invites" });
        const user = (await ctx.getUser("user", 0)) || ctx.user;
        return ctx.reply(app.invites.payload(ctx.guild, user));
      }

      if (sub === "appeal") {
        if (!app.appeals || !app.features.isEnabled(ctx.guild.id, "appeals")) return ctx.fail("errors.systemDisabled", { system: "appeals" });
        if (!ctx.isSlash) return ctx.fail("errors.actionFailed", { details: t("apl.err.slashOnly") });
        const record = app.cases.getByNumber(ctx.guild.id, ctx.interaction.options.getInteger("case"));
        const check = app.appeals.eligibility(ctx.guild.id, ctx.user.id, record);
        if (!check.ok) return ctx.fail("errors.actionFailed", { details: t(`apl.err.${check.reason}`, { time: check.wait ? Math.ceil(check.wait / 3_600_000) + "h" : "" }) });
        return ctx.interaction.showModal(app.appeals.modal(ctx.guild.id, record.case_number));
      }

      return ctx.fail("errors.actionFailed", { details: sub });
    }
  }
];
