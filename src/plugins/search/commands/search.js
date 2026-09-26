const { SlashCommandBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");

const scopeChoices = [
  { name: "الكل", value: "all" }, { name: "القضايا", value: "cases" }, { name: "الأعضاء", value: "members" },
  { name: "التذاكر", value: "tickets" }, { name: "البلاغات", value: "reports" }, { name: "الاستئنافات", value: "appeals" },
  { name: "الأوامر المخصصة", value: "commands" }
];

module.exports = [
  {
    name: "بحث",
    aliases: ["find", "gsearch", "بحث_شامل"],
    description: "بحث شامل للطاقم: القضايا، الأعضاء (بالأسماء الحالية والسابقة)، التذاكر، البلاغات، الاستئنافات، والأوامر المخصصة.",
    usage: "/بحث query:<نص أو رقم> user:@عضو scope:all | !find ahmed",
    arguments: [
      { name: "query", required: false, description: "نص أو رقم (#152)" },
      { name: "user", required: false, description: "عضو محدد" },
      { name: "scope", required: false, description: "النطاق" }
    ],
    examples: ["/بحث query:152", "/بحث user:@عضو", "!find ahmed"],
    category: "search",
    cooldown: 3000,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("بحث")
      .setDescription("بحث شامل (للطاقم)")
      .addStringOption((o) => o.setName("query").setDescription("نص أو رقم").setMaxLength(100))
      .addUserOption((o) => o.setName("user").setDescription("عضو محدد"))
      .addStringOption((o) => o.setName("scope").setDescription("النطاق").addChoices(...scopeChoices)),

    async execute(ctx) {
      let query;
      let userId = null;
      let scope = "all";
      if (ctx.isSlash) {
        const o = ctx.interaction.options;
        query = o.getString("query") || "";
        userId = o.getUser("user")?.id || null;
        scope = o.getString("scope") || "all";
      } else {
        const first = ctx.args[0] || "";
        const mention = first.match(/^<@!?(\d{17,20})>$/)?.[1] || (/^\d{17,20}$/.test(first) ? first : null);
        if (mention) userId = mention;
        query = (mention ? ctx.args.slice(1) : ctx.args).join(" ");
      }
      if (!query.trim() && !userId) return ctx.fail("errors.actionFailed", { details: ctx.t("srch.needInput") });
      if (!["all", ...ctx.app.search.constructor.SCOPES].includes(scope)) scope = "all";
      return ctx.reply(ctx.app.search.payload(ctx.guild, { query, userId, scope }), { ephemeral: ctx.isSlash });
    }
  }
];
