const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp } = require("../../../core/utils/helpers");
const { SECTIONS, WEEKDAYS } = require("../ReportService");

module.exports = [
  {
    name: "تقرير_دوري",
    aliases: ["report-schedule", "تقارير"],
    description: "تقارير دورية تلقائية: نشاط الطاقم، التذاكر، التقييمات، وغير النشطين.",
    usage: "/report-schedule setup channel:#التقارير frequency:weekly",
    arguments: [
      { name: "setup", required: false, description: "إعداد التقرير الدوري" },
      { name: "sections", required: false, description: "اختيار أقسام التقرير" },
      { name: "now", required: false, description: "إرسال التقرير فورًا" },
      { name: "inactive", required: false, description: "عرض الطاقم غير النشط" },
      { name: "status", required: false, description: "الإعدادات الحالية" }
    ],
    examples: [
      "/report-schedule setup channel:#التقارير frequency:weekly weekday:6 hour:12",
      "/report-schedule now days:7",
      "/report-schedule inactive days:7"
    ],
    category: "reports",
    slashOnly: true,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("تقرير_دوري")
      .setDescription("التقارير الدورية")
      .addSubcommand((s) =>
        s.setName("setup").setDescription("إعداد التقرير الدوري")
          .addChannelOption((o) => o.setName("channel").setDescription("قناة التقارير").addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) =>
            o.setName("frequency").setDescription("التكرار")
              .addChoices({ name: "يومي", value: "daily" }, { name: "أسبوعي", value: "weekly" })
          )
          .addIntegerOption((o) => o.setName("hour").setDescription("الساعة بتوقيت UTC (0-23)").setMinValue(0).setMaxValue(23))
          .addIntegerOption((o) =>
            o.setName("weekday").setDescription("يوم الأسبوع (للأسبوعي)")
              .addChoices(...WEEKDAYS.map((name, value) => ({ name, value })))
          )
          .addRoleOption((o) => o.setName("mention").setDescription("رتبة تُمنشن مع التقرير"))
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل التقرير"))
      )
      .addSubcommand((s) =>
        s.setName("sections").setDescription("اختيار أقسام التقرير")
          .addStringOption((o) =>
            o.setName("section").setDescription("القسم").setRequired(true)
              .addChoices(...Object.entries(SECTIONS).map(([value, name]) => ({ name, value })))
          )
          .addBooleanOption((o) => o.setName("include").setDescription("تضمينه؟").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("now").setDescription("إرسال التقرير فورًا")
          .addIntegerOption((o) => o.setName("days").setDescription("عدد الأيام").setMinValue(1).setMaxValue(90))
      )
      .addSubcommand((s) =>
        s.setName("inactive").setDescription("الطاقم غير النشط")
          .addIntegerOption((o) => o.setName("days").setDescription("عدد الأيام").setMinValue(1).setMaxValue(90))
      )
      .addSubcommand((s) => s.setName("status").setDescription("الإعدادات الحالية"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const level = ctx.app.permissions.resolveLevel(ctx.member);

      if (sub === "now") {
        await ctx.defer();
        const days = ctx.interaction.options.getInteger("days") || 7;
        const schedule = ctx.app.reports.getSchedule(guildId);
        const embed = await ctx.app.reportService.build(ctx.guild, days, schedule?.sections || []);
        return ctx.reply({ embeds: [embed] });
      }

      if (sub === "inactive") {
        await ctx.defer({ ephemeral: true });
        const days = ctx.interaction.options.getInteger("days") || 7;
        const rows = await ctx.app.reportService.inactiveStaff(ctx.guild, days);

        if (!ctx.app.guildConfig.value(guildId, "staff.baseRoleId")) {
          return ctx.fail("errors.actionFailed", { details: "حدّد رتبة الطاقم الأساسية أولًا من `/panel`." });
        }
        if (!rows.length) return ctx.success("✅ كل الطاقم نشط.");

        const min = ctx.app.guildConfig.value(guildId, "staff.minMessages") ?? 10;
        return ctx.reply({
          embeds: [buildEmbed({
            title: `😴 الطاقم غير النشط — آخر ${days} يوم`,
            description: rows.slice(0, 25)
              .map((m) => `• <@${m.id}> — \`${m.messages}\` رسالة`)
              .join("\n"),
            color: ctx.color("warning"),
            footer: `الحد الأدنى: ${min} رسالة • الإجمالي: ${rows.length}`
          })]
        }, { ephemeral: true });
      }

      if (sub === "status") {
        const s = ctx.app.reports.getSchedule(guildId);
        if (!s) return ctx.fail("errors.actionFailed", { details: "ما فيه تقرير دوري معدّ بعد." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "📊 التقرير الدوري",
            color: s.enabled ? ctx.color("success") : ctx.color("neutral"),
            fields: [
              { name: "الحالة", value: s.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
              { name: "القناة", value: s.channel_id ? `<#${s.channel_id}>` : "غير محددة", inline: true },
              { name: "التكرار", value: s.frequency === "daily" ? "يومي" : `أسبوعي (${WEEKDAYS[s.weekday]})`, inline: true },
              { name: "الساعة", value: `\`${s.hour}:00\` UTC`, inline: true },
              { name: "المنشن", value: s.mention_role_id ? `<@&${s.mention_role_id}>` : "—", inline: true },
              { name: "آخر إرسال", value: s.last_run_at ? timestamp(s.last_run_at, "R") : "لم يُرسل بعد", inline: true },
              {
                name: "الأقسام",
                value: (s.sections.length ? s.sections : Object.keys(SECTIONS))
                  .map((k) => `• ${SECTIONS[k] || k}`).join("\n")
              }
            ]
          })]
        }, { ephemeral: true });
      }

      if (level < Level.ADMIN) return ctx.fail("errors.noPermission");

      if (sub === "sections") {
        const section = ctx.interaction.options.getString("section");
        const include = ctx.interaction.options.getBoolean("include");
        const current = ctx.app.reports.getSchedule(guildId);
        const set = new Set(current?.sections?.length ? current.sections : Object.keys(SECTIONS));

        if (include) set.add(section);
        else set.delete(section);

        if (!set.size) return ctx.fail("errors.actionFailed", { details: "لازم يبقى قسم واحد على الأقل." });

        ctx.app.reports.saveSchedule(guildId, { sections: [...set] });
        return ctx.success(
          `${include ? "أُضيف" : "أُزيل"} قسم **${SECTIONS[section]}**.\n` +
          `الأقسام الآن: ${[...set].map((k) => SECTIONS[k]).join(" • ")}`
        );
      }

      // setup
      const patch = {};
      const channel = ctx.interaction.options.getChannel("channel");
      const frequency = ctx.interaction.options.getString("frequency");
      const hour = ctx.interaction.options.getInteger("hour");
      const weekday = ctx.interaction.options.getInteger("weekday");
      const mention = ctx.interaction.options.getRole("mention");
      const enabled = ctx.interaction.options.getBoolean("enabled");

      if (channel) {
        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }
        patch.channel_id = channel.id;
      }
      if (frequency) patch.frequency = frequency;
      if (hour !== null) patch.hour = hour;
      if (weekday !== null) patch.weekday = weekday;
      if (mention) patch.mention_role_id = mention.id;
      if (enabled !== null) patch.enabled = enabled ? 1 : 0;

      if (!Object.keys(patch).length) {
        return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
      }

      const saved = ctx.app.reports.saveSchedule(guildId, patch);
      if (saved.enabled && !saved.channel_id) {
        return ctx.success("تم الحفظ.\n⚠️ التقرير مفعّل بلا قناة — حدّدها ليعمل.");
      }
      return ctx.success(
        `تم حفظ إعدادات التقرير الدوري.\n` +
        `${saved.frequency === "daily" ? "يوميًا" : `كل ${WEEKDAYS[saved.weekday]}`} الساعة \`${saved.hour}:00\` UTC.`
      );
    }
  }
];
