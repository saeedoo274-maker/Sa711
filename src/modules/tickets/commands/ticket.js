const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const crypto = require("crypto");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "لوحة_تذاكر",
    aliases: ["ticket-panel"],
    description: "إنشاء لوحة تذاكر قابلة للتخصيص في قناة.",
    usage: "/ticket-panel title:<العنوان> description:<الوصف>",
    arguments: [
      { name: "title", required: false, description: "عنوان اللوحة" },
      { name: "description", required: false, description: "وصف اللوحة" },
      { name: "button", required: false, description: "نص الزر" },
      { name: "color", required: false, description: "لون الإمبيد بصيغة HEX" },
      { name: "category", required: false, description: "الكاتيغوري التي تُنشأ فيها التذاكر" }
    ],
    examples: ["/ticket-panel title:الدعم الفني button:فتح تذكرة"],
    category: "tickets",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    botPermissions: [PermissionFlagsBits.ManageChannels],
    slash: new SlashCommandBuilder()
      .setName("لوحة_تذاكر")
      .setDescription("إنشاء لوحة تذاكر")
      .addStringOption((o) => o.setName("title").setDescription("عنوان اللوحة"))
      .addStringOption((o) => o.setName("description").setDescription("وصف اللوحة"))
      .addStringOption((o) => o.setName("button").setDescription("نص الزر"))
      .addStringOption((o) => o.setName("emoji").setDescription("إيموجي الزر"))
      .addStringOption((o) => o.setName("color").setDescription("لون الإمبيد HEX مثل #5865F2"))
      .addChannelOption((o) => o.setName("category").setDescription("كاتيغوري التذاكر").addChannelTypes(ChannelType.GuildCategory))
      .addStringOption((o) => o.setName("banner").setDescription("رابط صورة البانر"))
      .addStringOption((o) => o.setName("thumbnail").setDescription("رابط الصورة المصغرة"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const cfg = ctx.app.guildConfig.get(ctx.guild.id);
      if (!cfg.tickets.enabled) {
        return ctx.fail("errors.actionFailed", { details: "فعّل نظام التذاكر أولًا من `/panel` ← الإعدادات." });
      }

      const panelId = crypto.randomBytes(6).toString("hex");
      const colorRaw = ctx.getString("color");
      let color = ctx.color("primary");
      if (colorRaw && /^#?[0-9a-fA-F]{6}$/.test(colorRaw)) color = parseInt(colorRaw.replace("#", ""), 16);

      const config = {
        title: ctx.getString("title") || "🎫 نظام التذاكر",
        description: ctx.getString("description") || "اضغط الزر أدناه لفتح تذكرة والتواصل مع الإدارة.",
        buttonLabel: ctx.getString("button") || "فتح تذكرة",
        buttonEmoji: ctx.getString("emoji") || "🎫",
        color,
        banner: ctx.getString("banner") || null,
        thumbnail: ctx.getString("thumbnail") || null,
        categoryId: ctx.getChannel ? (await ctx.getChannel("category"))?.id || null : null
      };

      const embed = buildEmbed({
        title: config.title,
        description: config.description,
        color: config.color,
        image: config.banner || undefined,
        thumbnail: config.thumbnail || undefined,
        footer: ctx.guild.name,
        timestamp: false
      });

      const button = new ButtonBuilder()
        .setCustomId(`ticket:open:${panelId}`)
        .setLabel(config.buttonLabel)
        .setStyle(ButtonStyle.Primary);
      try {
        if (config.buttonEmoji) button.setEmoji(config.buttonEmoji);
      } catch { /* إيموجي غير صالح يُتجاهل بدل إسقاط الأمر */ }

      const message = await ctx.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });

      ctx.app.tickets.savePanel({
        id: panelId,
        guildId: ctx.guild.id,
        channelId: ctx.channel.id,
        messageId: message.id,
        config
      });

      return ctx.reply({ content: `${ctx.emoji("success")} تم إنشاء لوحة التذاكر. معرّف اللوحة: \`${panelId}\`` }, { ephemeral: true });
    }
  },

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
