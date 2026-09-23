const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { formatDuration } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "اغلاق_طارئ",
    aliases: ["lockdown", "طوارئ"],
    description: "إغلاق طارئ: قفل كل القنوات مؤقتًا عند هجوم إغراق، مع استعادة دقيقة للحالة السابقة.",
    usage: "/lockdown start reason:<السبب>  •  /lockdown end",
    arguments: [
      { name: "start", required: false, description: "قفل كل القنوات" },
      { name: "end", required: false, description: "إنهاء الإغلاق واستعادة الحالة السابقة" },
      { name: "status", required: false, description: "حالة الإغلاق الحالية" }
    ],
    examples: ["/lockdown start reason:هجوم إغراق", "/lockdown end"],
    category: "oversight",
    slashOnly: true,
    cooldown: 5000,
    // للأدمن في سيرفره فقط — إجراء حساس وواسع الأثر
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    botPermissions: [PermissionFlagsBits.ManageChannels],
    slash: new SlashCommandBuilder()
      .setName("اغلاق_طارئ")
      .setDescription("الإغلاق الطارئ للسيرفر")
      .addSubcommand((s) =>
        s.setName("start").setDescription("قفل كل القنوات")
          .addStringOption((o) => o.setName("reason").setDescription("سبب الإغلاق").setMaxLength(300))
          .addChannelOption((o) => o.setName("keep-open").setDescription("قناة تبقى مفتوحة للتواصل").addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) => s.setName("end").setDescription("إنهاء الإغلاق واستعادة الحالة"))
      .addSubcommand((s) => s.setName("status").setDescription("حالة الإغلاق"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const svc = ctx.app.lockdownService;

      if (sub === "status") {
        return ctx.reply({ embeds: [svc.statusEmbed(ctx.guild, svc.active(ctx.guild.id))] }, { ephemeral: true });
      }

      await ctx.defer({ ephemeral: true });

      if (sub === "start") {
        const keepOpen = ctx.interaction.options.getChannel("keep-open");
        const result = await svc.start({
          guild: ctx.guild,
          actor: ctx.member,
          reason: ctx.interaction.options.getString("reason"),
          exclude: keepOpen ? [keepOpen.id] : []
        });

        if (!result.ok) {
          const messages = {
            already: "فيه إغلاق طارئ نشط بالفعل. أنهه أولًا بـ `/lockdown end`.",
            missingPermission: "البوت يفتقد صلاحية إدارة القنوات."
          };
          return ctx.reply({ content: `${ctx.emoji("error")} ${messages[result.reason]}` }, { ephemeral: true });
        }

        return ctx.reply({
          content:
            `${ctx.emoji("success")} تم الإغلاق الطارئ — قُفلت \`${result.locked}\` قناة.` +
            (result.skipped ? `\n${ctx.emoji("warning")} تُخطّيت \`${result.skipped}\` قناة (صلاحيات ناقصة).` : "") +
            (keepOpen ? `\nبقيت <#${keepOpen.id}> مفتوحة.` : "") +
            `\n\nحالة كل قناة محفوظة، و \`/lockdown end\` يستعيدها بدقة.`
        }, { ephemeral: true });
      }

      // end
      const record = svc.active(ctx.guild.id);
      const result = await svc.end({ guild: ctx.guild, actor: ctx.member });

      if (!result.ok) {
        return ctx.reply({ content: `${ctx.emoji("error")} ما فيه إغلاق طارئ نشط.` }, { ephemeral: true });
      }

      return ctx.reply({
        content:
          `${ctx.emoji("success")} انتهى الإغلاق — استُعيدت \`${result.restored}\` قناة` +
          (result.missing ? ` (\`${result.missing}\` قناة محذوفة)` : "") +
          (record ? `.\nاستمر ${formatDuration(Date.now() - record.started_at)}.` : ".")
      }, { ephemeral: true });
    }
  }
];
