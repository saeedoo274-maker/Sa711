const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "لوحة_نجوم",
    aliases: ["starboard", "لوحة_النجوم", "نجوم"],
    description: "لوحة النجوم: الرسائل المميزة تُنشر تلقائيًا عند تجاوز عدد نجوم محدد.",
    usage: "/starboard settings channel:#المميز threshold:3",
    arguments: [
      { name: "settings", required: false, description: "ضبط القناة والحد والإيموجي" },
      { name: "status", required: false, description: "عرض الإعدادات الحالية" },
      { name: "top", required: false, description: "أكثر الرسائل نجومًا" },
      { name: "ignore", required: false, description: "استثناء قناة من اللوحة" }
    ],
    examples: ["/starboard settings channel:#المميز threshold:5 emoji:⭐", "/starboard top"],
    category: "starboard",
    slashOnly: true,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("لوحة_نجوم")
      .setDescription("لوحة النجوم")
      .addSubcommand((s) =>
        s.setName("settings").setDescription("ضبط لوحة النجوم")
          .addChannelOption((o) => o.setName("channel").setDescription("قناة اللوحة").addChannelTypes(ChannelType.GuildText))
          .addIntegerOption((o) => o.setName("threshold").setDescription("عدد النجوم المطلوب").setMinValue(1).setMaxValue(50))
          .addStringOption((o) => o.setName("emoji").setDescription("الإيموجي المستخدم").setMaxLength(32))
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل النظام"))
          .addBooleanOption((o) => o.setName("self-star").setDescription("السماح للعضو بتنجيم رسالته"))
      )
      .addSubcommand((s) => s.setName("status").setDescription("الإعدادات الحالية"))
      .addSubcommand((s) => s.setName("top").setDescription("أكثر الرسائل نجومًا"))
      .addSubcommand((s) =>
        s.setName("ignore").setDescription("استثناء قناة")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const level = ctx.app.permissions.resolveLevel(ctx.member);

      if (sub === "top") {
        const rows = ctx.app.starboard.top(guildId, 10);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه رسائل في اللوحة بعد." });
        const cfg = ctx.app.starboardService.config(guildId);
        return ctx.reply({
          embeds: [buildEmbed({
            title: `${cfg.emoji || "⭐"} أكثر الرسائل نجومًا`,
            description: rows.map((r, i) =>
              `**${i + 1}.** ${cfg.emoji || "⭐"} \`${r.stars}\` — <@${r.author_id}> في <#${r.source_channel_id}>`
            ).join("\n"),
            color: ctx.color("warning")
          })]
        });
      }

      if (sub === "status") {
        const cfg = ctx.app.starboardService.config(guildId);
        return ctx.reply({
          embeds: [buildEmbed({
            title: "⭐ لوحة النجوم",
            color: cfg.enabled ? ctx.color("success") : ctx.color("neutral"),
            fields: [
              { name: "الحالة", value: cfg.enabled ? "🟢 مفعّلة" : "⚪ معطّلة", inline: true },
              { name: "القناة", value: cfg.channelId ? `<#${cfg.channelId}>` : "⚠️ غير محددة", inline: true },
              { name: "الإيموجي", value: cfg.emoji || "⭐", inline: true },
              { name: "الحد المطلوب", value: `\`${cfg.threshold || 3}\` نجوم`, inline: true },
              { name: "تنجيم النفس", value: cfg.allowSelfStar ? "مسموح" : "ممنوع", inline: true },
              { name: "الرسائل المنشورة", value: `\`${ctx.app.starboard.count(guildId)}\``, inline: true },
              { name: "القنوات المستثناة", value: (cfg.ignoredChannels || []).map((c) => `<#${c}>`).join(" ") || "—" }
            ]
          })]
        }, { ephemeral: true });
      }

      if (level < Level.ADMIN) return ctx.fail("errors.noPermission");

      if (sub === "ignore") {
        const channel = ctx.interaction.options.getChannel("channel");
        const current = new Set(ctx.app.guildConfig.value(guildId, "starboard.ignoredChannels") || []);
        if (current.has(channel.id)) current.delete(channel.id);
        else current.add(channel.id);
        ctx.app.guildConfig.set(guildId, "starboard.ignoredChannels", [...current]);
        return ctx.success(`${current.has(channel.id) ? "تم استثناء" : "تمت إعادة"} <#${channel.id}> ${current.has(channel.id) ? "من" : "إلى"} لوحة النجوم.`);
      }

      // settings
      const updates = {};
      const channel = ctx.interaction.options.getChannel("channel");
      const threshold = ctx.interaction.options.getInteger("threshold");
      const emoji = ctx.interaction.options.getString("emoji");
      const enabled = ctx.interaction.options.getBoolean("enabled");
      const selfStar = ctx.interaction.options.getBoolean("self-star");

      if (channel) {
        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }
        updates["starboard.channelId"] = channel.id;
      }
      if (threshold) updates["starboard.threshold"] = threshold;
      if (emoji) updates["starboard.emoji"] = emoji.trim();
      if (enabled !== null) updates["starboard.enabled"] = enabled;
      if (selfStar !== null) updates["starboard.allowSelfStar"] = selfStar;

      if (!Object.keys(updates).length) {
        return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
      }

      ctx.app.guildConfig.setMany(guildId, updates);
      const cfg = ctx.app.starboardService.config(guildId);
      if (cfg.enabled && !cfg.channelId) {
        return ctx.success("تم الحفظ.\n⚠️ النظام مفعّل لكن ما فيه قناة محددة — حدّدها ليعمل.");
      }
      return ctx.success("تم حفظ إعدادات لوحة النجوم.");
    }
  }
];
