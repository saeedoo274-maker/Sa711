const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, formatDuration } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "اعدادات_تذاكر",
    aliases: ["ticket-settings", "اعدادات_التذاكر"],
    description: "ضبط الإغلاق التلقائي، التقييم، حد الاستلام، وقنوات الأرشيف.",
    usage: "/ticket-settings auto-close idle:24 grace:12 action:lock",
    arguments: [
      { name: "auto-close", required: false, description: "الإغلاق التلقائي عند الخمول" },
      { name: "rating", required: false, description: "تقييم الخدمة بعد الإغلاق" },
      { name: "limits", required: false, description: "حد التذاكر المستلمة لكل موظف" },
      { name: "channels", required: false, description: "قنوات الأرشيف والتقييم" },
      { name: "show", required: false, description: "عرض الإعدادات الحالية" }
    ],
    examples: [
      "/ticket-settings auto-close idle:24 grace:12 action:lock",
      "/ticket-settings rating enabled:true channel:#التقييمات",
      "/ticket-settings limits max-claims:3"
    ],
    category: "tickets",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("اعدادات_تذاكر")
      .setDescription("إعدادات نظام التذاكر المتقدمة")
      .addSubcommand((s) =>
        s.setName("auto-close").setDescription("الإغلاق التلقائي عند الخمول")
          .addIntegerOption((o) => o.setName("idle").setDescription("ساعات الخمول قبل التنبيه (0 = تعطيل)").setMinValue(0).setMaxValue(720))
          .addIntegerOption((o) => o.setName("grace").setDescription("ساعات المهلة بعد التنبيه").setMinValue(1).setMaxValue(168))
          .addStringOption((o) =>
            o.setName("action").setDescription("الإجراء بعد المهلة")
              .addChoices({ name: "قفل التذكرة", value: "lock" }, { name: "حذف نهائي مع أرشفة", value: "delete" })
          )
      )
      .addSubcommand((s) =>
        s.setName("rating").setDescription("تقييم الخدمة")
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل طلب التقييم"))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة نشر التقييمات").addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) =>
        s.setName("limits").setDescription("حدود الاستلام")
          .addIntegerOption((o) => o.setName("max-claims").setDescription("أقصى تذاكر مستلمة للموظف (0 = بلا حد)").setMinValue(0).setMaxValue(50).setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("channels").setDescription("قنوات النظام")
          .addChannelOption((o) => o.setName("archive").setDescription("قناة أرشيف المحادثات").addChannelTypes(ChannelType.GuildText))
          .addChannelOption((o) => o.setName("category").setDescription("كاتيغوري التذاكر الافتراضية").addChannelTypes(ChannelType.GuildCategory))
      )
      .addSubcommand((s) => s.setName("show").setDescription("عرض الإعدادات"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const cfg = ctx.app.guildConfig.value(guildId, "tickets") || {};

      if (sub === "show") {
        const stats = ctx.app.tickets.stats(guildId);
        const ratings = ctx.app.tickets.guildRatingStats(guildId);
        return ctx.reply({
          embeds: [buildEmbed({
            title: `${ctx.emoji("ticket")} إعدادات التذاكر`,
            color: ctx.color("primary"),
            fields: [
              { name: "النظام", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
              { name: "الكاتيغوري", value: cfg.categoryId ? `<#${cfg.categoryId}>` : "غير محددة", inline: true },
              { name: "حد الاستلام", value: cfg.maxClaimsPerStaff ? `\`${cfg.maxClaimsPerStaff}\`` : "بلا حد", inline: true },
              {
                name: "الإغلاق التلقائي",
                value: cfg.autoCloseIdleHours
                  ? `بعد ${formatDuration(cfg.autoCloseIdleHours * 3600000)} خمول\n` +
                    `مهلة ${formatDuration((cfg.autoCloseGraceHours || 12) * 3600000)}\n` +
                    `الإجراء: ${cfg.autoCloseAction === "delete" ? "حذف مع أرشفة" : "قفل"}`
                  : "⚪ معطّل"
              },
              { name: "التقييم", value: cfg.ratingEnabled ? `🟢 مفعّل\nالقناة: ${cfg.ratingChannelId ? `<#${cfg.ratingChannelId}>` : "غير محددة"}` : "⚪ معطّل", inline: true },
              { name: "الأرشيف", value: cfg.transcriptChannelId ? `<#${cfg.transcriptChannelId}>` : "غير محددة", inline: true },
              { name: "التذاكر", value: `مفتوحة: \`${stats.open}\` • مغلقة: \`${stats.closed}\``, inline: true },
              {
                name: "متوسط التقييم",
                value: ratings.count ? `⭐ \`${ratings.average.toFixed(2)}\` من \`${ratings.count}\` تقييم` : "لا توجد تقييمات",
                inline: true
              }
            ]
          })]
        }, { ephemeral: true });
      }

      const updates = {};

      if (sub === "auto-close") {
        const idle = ctx.interaction.options.getInteger("idle");
        const grace = ctx.interaction.options.getInteger("grace");
        const action = ctx.interaction.options.getString("action");
        if (idle !== null) updates["tickets.autoCloseIdleHours"] = idle;
        if (grace) updates["tickets.autoCloseGraceHours"] = grace;
        if (action) updates["tickets.autoCloseAction"] = action;

        if (updates["tickets.autoCloseAction"] === "delete" && !cfg.transcriptChannelId) {
          return ctx.fail("errors.actionFailed", {
            details: "الحذف التلقائي يحتاج قناة أرشيف أولًا — حدّدها بـ `/ticket-settings channels archive:#قناة`."
          });
        }
      }

      if (sub === "rating") {
        const enabled = ctx.interaction.options.getBoolean("enabled");
        const channel = ctx.interaction.options.getChannel("channel");
        if (enabled !== null) updates["tickets.ratingEnabled"] = enabled;
        if (channel) {
          const me = ctx.guild.members.me;
          if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
            return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
          }
          updates["tickets.ratingChannelId"] = channel.id;
        }
      }

      if (sub === "limits") {
        updates["tickets.maxClaimsPerStaff"] = ctx.interaction.options.getInteger("max-claims");
      }

      if (sub === "channels") {
        const archive = ctx.interaction.options.getChannel("archive");
        const category = ctx.interaction.options.getChannel("category");
        const me = ctx.guild.members.me;
        if (archive) {
          if (!archive.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
            return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${archive.id}>.` });
          }
          updates["tickets.transcriptChannelId"] = archive.id;
        }
        if (category) updates["tickets.categoryId"] = category.id;
      }

      if (!Object.keys(updates).length) {
        return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
      }

      ctx.app.guildConfig.setMany(guildId, updates);
      return ctx.success("تم حفظ إعدادات التذاكر. راجعها بـ `/ticket-settings show`.");
    }
  },

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
