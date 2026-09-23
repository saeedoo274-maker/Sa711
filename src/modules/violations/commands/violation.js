const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");

const SYSTEM = "violations.enabled";

module.exports = [
  {
    name: "مخالفة",
    aliases: ["violation", "مخالفات"],
    description: "تسجيل المخالفات وعرضها وسدادها وإلغاؤها.",
    usage: "/violation issue user:<عضو> kind:<النوع> amount:<المبلغ>",
    arguments: [
      { name: "issue", required: false, description: "تسجيل مخالفة على عضو (للإدارة)" },
      { name: "list", required: false, description: "عرض مخالفات عضو" },
      { name: "pay", required: false, description: "سداد مخالفة من رصيدك" },
      { name: "cancel", required: false, description: "إلغاء مخالفة (للإدارة)" },
      { name: "recent", required: false, description: "آخر المخالفات المسجّلة" }
    ],
    examples: [
      "/violation issue user:@أحمد kind:تجاوز السرعة amount:500",
      "/violation list",
      "/violation pay number:12"
    ],
    category: "violations",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("مخالفة")
      .setDescription("نظام المخالفات")
      .addSubcommand((s) =>
        s.setName("issue").setDescription("تسجيل مخالفة على عضو")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addStringOption((o) => o.setName("kind").setDescription("نوع المخالفة").setRequired(true).setMaxLength(100))
          .addIntegerOption((o) => o.setName("amount").setDescription("قيمة المخالفة").setRequired(true).setMinValue(1))
          .addStringOption((o) => o.setName("notes").setDescription("ملاحظات").setMaxLength(500))
      )
      .addSubcommand((s) =>
        s.setName("list").setDescription("عرض المخالفات")
          .addUserOption((o) => o.setName("user").setDescription("عضو آخر (للإدارة)"))
      )
      .addSubcommand((s) =>
        s.setName("pay").setDescription("سداد مخالفة")
          .addIntegerOption((o) => o.setName("number").setDescription("رقم المخالفة").setRequired(true).setMinValue(1))
      )
      .addSubcommand((s) =>
        s.setName("cancel").setDescription("إلغاء مخالفة")
          .addIntegerOption((o) => o.setName("number").setDescription("رقم المخالفة").setRequired(true).setMinValue(1))
      )
      .addSubcommand((s) => s.setName("recent").setDescription("آخر المخالفات المسجّلة")),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const svc = ctx.app.violationService;
      const guild = ctx.guild;
      const level = ctx.app.permissions.resolveLevel(ctx.member);

      if (sub === "issue") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");

        const member = await ctx.getMember("user");
        if (!member) return ctx.fail("errors.memberNotFound");
        if (member.user.bot) return ctx.fail("errors.actionFailed", { details: "ما ينفع تسجّل مخالفة على بوت." });

        const allowed = ctx.app.permissions.canActOn(ctx.member, member);
        if (!allowed.ok) return ctx.fail(`errors.${allowed.reason}`);

        const record = await svc.issue({
          guild,
          officer: ctx.member,
          target: member,
          kind: ctx.interaction.options.getString("kind"),
          amount: ctx.interaction.options.getInteger("amount"),
          notes: ctx.interaction.options.getString("notes")
        });

        const outstanding = ctx.app.violations.unpaidTotal(guild.id, member.id);
        return ctx.success(
          `تم تسجيل المخالفة **#${record.number}** على <@${member.id}>\n` +
          `المبلغ: ${ctx.app.economyService.format(guild.id, record.amount)}\n` +
          `إجمالي المستحق عليه: ${ctx.app.economyService.format(guild.id, outstanding)}`
        );
      }

      if (sub === "cancel") {
        if (level < Level.MODERATOR) return ctx.fail("errors.noPermission");
        const number = ctx.interaction.options.getInteger("number");
        const result = await svc.cancel({ guild, actor: ctx.member, number });
        if (!result.ok) {
          const messages = { notFound: "ما لقيت مخالفة بهذا الرقم.", notUnpaid: "المخالفة مسددة أو ملغاة أصلًا." };
          return ctx.fail("errors.actionFailed", { details: messages[result.reason] });
        }
        return ctx.success(`تم إلغاء المخالفة **#${number}**.`);
      }

      if (sub === "recent") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");
        const rows = ctx.app.violations.recent(guild.id, 15);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه مخالفات مسجّلة بعد." });
        const icons = { unpaid: "🔴", paid: "🟢", cancelled: "⚪" };
        return ctx.reply({
          embeds: [buildEmbed({
            title: "⚠️ آخر المخالفات",
            description: rows.map((v) =>
              `${icons[v.status]} **#${v.number}** <@${v.target_id}> • ${v.kind} • ${ctx.app.economyService.format(guild.id, v.amount)}`
            ).join("\n"),
            color: ctx.color("warning")
          })]
        }, { ephemeral: true });
      }

      if (sub === "list") {
        const target = ctx.interaction.options.getUser("user");
        if (target && target.id !== ctx.user.id && level < Level.STAFF) return ctx.fail("errors.noPermission");
        const user = target || ctx.user;
        const rows = ctx.app.violations.listByTarget(guild.id, user.id, { limit: 15 });
        return ctx.reply({ embeds: [svc.listEmbed(guild, user, rows)] }, { ephemeral: !target });
      }

      // pay
      const number = ctx.interaction.options.getInteger("number");
      const result = await svc.pay({ guild, member: ctx.member, number });

      if (!result.ok) {
        const messages = {
          notFound: "ما لقيت مخالفة بهذا الرقم.",
          alreadyPaid: "هذي المخالفة مسددة من قبل.",
          cancelled: "هذي المخالفة ملغاة.",
          notYours: "هذي المخالفة مو عليك.",
          insufficient: result.needed
            ? `رصيدك ما يكفي. المطلوب ${ctx.app.economyService.format(guild.id, result.needed)} والمتاح ${ctx.app.economyService.format(guild.id, ctx.app.economyService.total(result.account))}`
            : "رصيدك غير كافٍ."
        };
        return ctx.fail("errors.actionFailed", { details: messages[result.reason] || "فشل السداد." });
      }

      const remaining = ctx.app.violations.unpaidTotal(guild.id, ctx.user.id);
      return ctx.success(
        `تم سداد المخالفة **#${number}** بمبلغ ${ctx.app.economyService.format(guild.id, result.record.amount)}\n` +
        `📊 رصيدك: ${ctx.app.economyService.format(guild.id, ctx.app.economyService.total(result.account))}` +
        (remaining > 0 ? `\n⚠️ باقي عليك: ${ctx.app.economyService.format(guild.id, remaining)}` : "\n✅ ما عليك مخالفات")
      );
    }
  }
];
