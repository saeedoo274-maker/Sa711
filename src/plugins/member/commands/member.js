const { SlashCommandBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { historyPayload } = require("../views");

module.exports = [
  {
    name: "عضو",
    aliases: ["member", "whois", "history", "سجل_عضو"],
    aliasRoutes: { history: { sub: "history" }, whois: { sub: "history" }, "سجل_عضو": { sub: "history" } },
    subAliases: { سجل: "history", بحث: "lookup" },
    defaultSubcommand: "history",
    description: "ملف العضو: السجل الكامل (أسماء، رتب، دخول/خروج، إدارة، تذاكر، تقديمات، نشاط، XP، اقتصاد) والبحث.",
    usage: "/عضو history user:@عضو | /عضو lookup query:الاسم",
    arguments: [
      { name: "history", required: false, description: "سجل عضو (طاقم)" },
      { name: "lookup", required: false, description: "بحث بالاسم الحالي أو القديم (طاقم)" }
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
        .addStringOption((o) => o.setName("query").setDescription("الاسم أو جزء منه").setRequired(true).setMinLength(2).setMaxLength(50))),

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
      return ctx.fail("errors.actionFailed", { details: sub });
    }
  }
];
