const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp, truncate } = require("../../../core/utils/helpers");
const { Events } = require("../../../core/events/EventBus");

const SYSTEM = "moderation.enabled";

module.exports = [
  {
    name: "تحذير",
    aliases: ["warn", "انذار"],
    description: "إعطاء تحذير مسجَّل لعضو.",
    usage: "warn <@عضو> [السبب]",
    arguments: [
      { name: "عضو", required: true, description: "العضو المراد تحذيره" },
      { name: "السبب", required: false, description: "سبب التحذير" }
    ],
    examples: ["warn @أحمد لغة غير لائقة"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("تحذير")
      .setDescription("إعطاء تحذير لعضو")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("سبب التحذير"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      if (!member) return ctx.fail("errors.memberNotFound");

      const result = await ctx.app.moderation.punish({
        type: "warn",
        guild: ctx.guild,
        executor: ctx.member,
        target: member,
        reason: ctx.getString("reason", 1, true)
      });
      if (!result.ok) return ctx.fail(`errors.${result.reason}`, { details: result.details });

      const total = ctx.app.cases.countByTarget(ctx.guild.id, member.id, "warn");
      return ctx.success(
        `${ctx.t("moderation.warn.success", { target: `<@${member.id}>` })}  •  ` +
          `${ctx.t("common.caseNumber")} \`#${result.case.case_number}\`  •  إجمالي التحذيرات: \`${total}\``
      );
    }
  },

  {
    name: "حذف_تحذير",
    aliases: ["unwarn", "removewarn"],
    description: "حذف تحذير برقم القضية.",
    usage: "unwarn <رقم القضية>",
    arguments: [{ name: "رقم القضية", required: true, description: "رقم القضية الظاهر عند التحذير" }],
    examples: ["unwarn 42"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.MODERATOR },
    slash: new SlashCommandBuilder()
      .setName("حذف_تحذير")
      .setDescription("حذف تحذير برقم القضية")
      .addIntegerOption((o) => o.setName("case").setDescription("رقم القضية").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const caseNumber = ctx.getNumber("case", 0);
      if (!caseNumber) return ctx.fail("errors.invalidNumber");

      const record = ctx.app.cases.getByNumber(ctx.guild.id, caseNumber);
      if (!record || record.type !== "warn") return ctx.fail("errors.caseNotFound");

      // عملية ذرية: تُرجع false إذا كان تحذيرًا محذوفًا مسبقًا (منع الحذف المزدوج)
      const removed = ctx.app.cases.deactivate(ctx.guild.id, caseNumber);
      if (!removed) return ctx.fail("errors.caseNotFound");

      ctx.app.bus.emitSafe(Events.WARN_REMOVED, {
        guild: ctx.guild,
        executor: ctx.member,
        target: { id: record.target_id },
        details: `تم حذف التحذير رقم #${caseNumber}`
      });

      return ctx.success(ctx.t("moderation.unwarn.success", { caseNumber }));
    }
  },

  {
    name: "التحذيرات",
    aliases: ["warnings", "warns"],
    description: "عرض تحذيرات عضو.",
    usage: "warnings <@عضو>",
    arguments: [{ name: "عضو", required: true, description: "العضو المراد عرض تحذيراته" }],
    examples: ["warnings @أحمد"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("التحذيرات")
      .setDescription("عرض تحذيرات عضو")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const user = await ctx.getUser("user", 0);
      if (!user) return ctx.fail("errors.userNotFound");

      const list = ctx.app.cases.listByTarget(ctx.guild.id, user.id, { type: "warn", activeOnly: true, limit: 15 });
      if (!list.length) {
        return ctx.reply({
          embeds: [buildEmbed({ description: ctx.t("moderation.warnings.empty"), color: ctx.color("neutral") })]
        });
      }

      const fields = list.map((c) => ({
        name: `#${c.case_number} • ${timestamp(c.created_at, "R")}`,
        value: `${truncate(c.reason || ctx.t("common.noReason"), 200)}\n${ctx.t("common.moderator")}: <@${c.moderator_id}>`
      }));

      return ctx.reply({
        embeds: [
          buildEmbed({
            title: ctx.t("moderation.warnings.title", { target: user.tag }),
            color: ctx.color("warning"),
            fields,
            footer: `الإجمالي: ${list.length}`,
            thumbnail: user.displayAvatarURL()
          })
        ]
      });
    }
  }
];
