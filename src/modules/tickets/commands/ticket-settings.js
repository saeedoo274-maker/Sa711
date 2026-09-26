const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "تقييم_تذاكر",
    aliases: ["ticket-rating", "تقييمات"],
    description: "تقييمات خدمة التذاكر: متوسط كل إداري ولوحة الصدارة.",
    usage: "/ticket-rating staff:@إداري",
    arguments: [{ name: "staff", required: false, description: "إداري معيّن، أو الصدارة إن تُرك فارغًا" }],
    examples: ["/ticket-rating", "/ticket-rating staff:@أحمد"],
    category: "tickets",
    slashOnly: true,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("تقييم_تذاكر")
      .setDescription("تقييمات خدمة التذاكر")
      .addUserOption((o) => o.setName("staff").setDescription("الإداري"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(ctx) {
      const guildId = ctx.guild.id;
      const staff = ctx.interaction.options.getUser("staff");

      if (staff) {
        const r = ctx.app.tickets.staffRating(guildId, staff.id);
        if (!r.count) return ctx.fail("errors.actionFailed", { details: `ما فيه تقييمات لـ <@${staff.id}> بعد.` });
        const stars = Math.round(r.average);
        return ctx.reply({
          embeds: [buildEmbed({
            title: `⭐ تقييم ${staff.username}`,
            description: `${"⭐".repeat(stars)}${"☆".repeat(5 - stars)}  **${r.average.toFixed(2)}** من 5`,
            color: ctx.color(r.average >= 4 ? "success" : r.average >= 3 ? "warning" : "danger"),
            thumbnail: staff.displayAvatarURL(),
            fields: [
              { name: "عدد التقييمات", value: `\`${r.count}\``, inline: true },
              { name: "تقييمات 5 نجوم", value: `\`${r.five}\``, inline: true },
              { name: "تقييمات منخفضة", value: `\`${r.low}\``, inline: true }
            ]
          })]
        });
      }

      const rows = ctx.app.tickets.ratingLeaderboard(guildId, 10, 1);
      if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه تقييمات بعد." });

      const overall = ctx.app.tickets.guildRatingStats(guildId);
      return ctx.reply({
        embeds: [buildEmbed({
          title: "⭐ صدارة تقييم الخدمة",
          description: rows
            .map((r, i) => `**${i + 1}.** <@${r.staff_id}> — ⭐ \`${r.average.toFixed(2)}\` من \`${r.count}\` تقييم`)
            .join("\n"),
          color: ctx.color("primary"),
          footer: `متوسط السيرفر: ${overall.average.toFixed(2)} من ${overall.count} تقييم`
        })]
      });
    }
  }
];
