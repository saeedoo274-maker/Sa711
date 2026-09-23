const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");
const { servicesMenuRow } = require("../interactions");

module.exports = [
  {
    name: "خدمات",
    aliases: ["services"],
    description: "نشر لوحة خدمات للأعضاء: تقييم، اقتراح، وحاسبة ضريبة، عبر قائمة واحدة.",
    usage: "/خدمات panel channel:<القناة>",
    arguments: [
      { name: "panel", required: false, description: "نشر لوحة الخدمات في قناة" },
      { name: "channels", required: false, description: "تحديد قنوات استقبال التقييمات والاقتراحات" }
    ],
    examples: ["/خدمات panel channel:#الخدمات", "/خدمات channels ratings:#التقييمات suggestions:#الاقتراحات"],
    category: "economy",
    slashOnly: true,
    permissions: { level: Level.ADMIN },
    slash: new SlashCommandBuilder()
      .setName("خدمات")
      .setDescription("لوحة خدمات الأعضاء")
      .addSubcommand((s) =>
        s.setName("panel").setDescription("نشر لوحة الخدمات")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("channels").setDescription("تحديد قنوات الاستقبال")
          .addChannelOption((o) => o.setName("ratings").setDescription("قناة التقييمات"))
          .addChannelOption((o) => o.setName("suggestions").setDescription("قناة الاقتراحات"))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const me = ctx.guild.members.me;

      if (sub === "channels") {
        const ratings = ctx.interaction.options.getChannel("ratings");
        const suggestions = ctx.interaction.options.getChannel("suggestions");
        if (!ratings && !suggestions) {
          return ctx.fail("errors.actionFailed", { details: "حدد قناة واحدة على الأقل." });
        }

        for (const [channel, key] of [[ratings, "logs.ratings"], [suggestions, "logs.suggestions"]]) {
          if (!channel) continue;
          if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
            return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
          }
          ctx.app.guildConfig.set(guildId, key, channel.id);
        }
        return ctx.success("تم حفظ قنوات الاستقبال.");
      }

      // panel
      const channel = ctx.interaction.options.getChannel("channel");
      if (!channel?.isTextBased?.()) return ctx.fail("errors.actionFailed", { details: "اختر قناة نصية." });
      if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
        return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
      }

      const embed = buildEmbed({
        title: "🛎️ مركز الخدمات",
        description: "اختر خدمة من القائمة بالأسفل.",
        color: ctx.color("primary")
      });

      const message = await channel.send({ embeds: [embed], components: [servicesMenuRow()] }).catch(() => null);
      if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر اللوحة." });

      return ctx.success(`تم نشر لوحة الخدمات في <#${channel.id}>.`);
    }
  }
];
