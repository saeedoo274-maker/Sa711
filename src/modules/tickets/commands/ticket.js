const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "احصائيات_تذاكر",
    aliases: ["ticket-stats", "احصائيات_التذاكر"],
    description: "عرض إحصائيات التذاكر في السيرفر.",
    usage: "ticket-stats",
    arguments: [],
    examples: ["ticket-stats"],
    category: "tickets",
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("احصائيات_تذاكر")
      .setDescription("إحصائيات التذاكر")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(ctx) {
      const stats = ctx.app.tickets.stats(ctx.guild.id);
      const panels = ctx.app.tickets.listPanels(ctx.guild.id);
      return ctx.reply({
        embeds: [
          buildEmbed({
            title: `${ctx.emoji("ticket")} إحصائيات التذاكر`,
            color: ctx.color("primary"),
            fields: [
              { name: "مفتوحة", value: `\`${stats.open}\``, inline: true },
              { name: "مغلقة", value: `\`${stats.closed}\``, inline: true },
              { name: "اللوحات", value: `\`${panels.length}\``, inline: true }
            ]
          })
        ]
      });
    }
  }
];
