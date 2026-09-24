const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");

const periodChoices = [
  { name: "اليوم", value: "today" }, { name: "7 أيام", value: "7d" }, { name: "30 يومًا", value: "30d" },
  { name: "90 يومًا", value: "90d" }, { name: "سنة", value: "year" }
];

/**
 * أمر الإدارة المتقدمة. كل أمر فرعي يفحص تفعيل نظامه بنفسه لأن /ادارة
 * يجمع أدوات أنظمة متعددة (تعطيل أحدها لا يجب أن يعطّل البقية).
 */
module.exports = [
  {
    name: "ادارة",
    aliases: ["admin", "manage"],
    description: "أدوات الإدارة المتقدمة: التحليلات وغيرها.",
    usage: "/ادارة analytics type:server period:30d",
    arguments: [{ name: "analytics", required: false, description: "تحليلات السيرفر أو الطاقم" }],
    examples: ["/ادارة analytics type:server period:7d", "/ادارة analytics type:staff period:30d"],
    category: "admin",
    slashOnly: true,
    cooldown: 3000,
    permissions: { level: Level.ADMIN },
    featureExempt: () => true,
    slash: new SlashCommandBuilder()
      .setName("ادارة")
      .setDescription("أدوات الإدارة المتقدمة")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((s) => s.setName("analytics").setDescription("التحليلات")
        .addStringOption((o) => o.setName("type").setDescription("النوع").addChoices({ name: "السيرفر", value: "server" }, { name: "الطاقم", value: "staff" }))
        .addStringOption((o) => o.setName("period").setDescription("الفترة").addChoices(...periodChoices))),

    async execute(ctx) {
      const app = ctx.app;
      const sub = ctx.subcommand();
      const need = (feature) => (app.features.isEnabled(ctx.guild.id, feature) ? null : ctx.fail("errors.systemDisabled", { system: feature }));

      if (sub === "analytics") {
        const blocked = need("analytics");
        if (blocked) return blocked;
        await ctx.defer({ ephemeral: true });
        const type = ctx.interaction.options.getString("type") || "server";
        const period = ctx.interaction.options.getString("period") || (type === "staff" ? "30d" : "7d");
        return ctx.reply(type === "staff" ? app.analytics.staffPayload(ctx.guild, period) : app.analytics.serverPayload(ctx.guild, period), { ephemeral: true });
      }
      return ctx.fail("errors.actionFailed", { details: sub || "?" });
    }
  }
];
