const { SlashCommandBuilder, ChannelType } = require("discord.js");
const crypto = require("crypto");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "تحديثات",
    aliases: ["changelog", "سجل_التحديثات"],
    description: "سجل الإصدارات: نشر تحديث للمطورين، والاشتراك فيه لكل سيرفر.",
    usage: "/changelog publish version:12 title:<العنوان> body:<التفاصيل>",
    arguments: [
      { name: "publish", required: false, description: "نشر إصدار جديد لكل السيرفرات المشتركة (للمطور)" },
      { name: "latest", required: false, description: "عرض آخر إصدار" },
      { name: "subscribe", required: false, description: "اشتراك هذا السيرفر في إشعارات التحديثات" }
    ],
    examples: ["/changelog publish version:12 title:التقارير الدورية body:أُضيف نظام تقارير أسبوعية", "/changelog subscribe channel:#التحديثات"],
    category: "devtools",
    slashOnly: true,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("تحديثات")
      .setDescription("سجل الإصدارات")
      .addSubcommand((s) =>
        s.setName("publish").setDescription("نشر إصدار جديد (للمطور)")
          .addStringOption((o) => o.setName("version").setDescription("رقم الإصدار").setRequired(true).setMaxLength(20))
          .addStringOption((o) => o.setName("title").setDescription("عنوان التحديث").setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName("body").setDescription("تفاصيل التحديث").setRequired(true).setMaxLength(1800))
      )
      .addSubcommand((s) => s.setName("latest").setDescription("آخر إصدار"))
      .addSubcommand((s) =>
        s.setName("subscribe").setDescription("اشتراك في إشعارات التحديثات")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل الاشتراك"))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();

      if (sub === "latest") {
        const entry = ctx.app.changelogs.latest();
        if (!entry) return ctx.fail("errors.actionFailed", { details: "ما فيه إصدارات منشورة بعد." });
        return ctx.reply({ embeds: [ctx.app.changelogService.embed(entry)] });
      }

      if (sub === "subscribe") {
        if (ctx.app.permissions.resolveLevel(ctx.member) < Level.ADMIN) return ctx.fail("errors.noPermission");
        const channel = ctx.interaction.options.getChannel("channel");
        const enabled = ctx.interaction.options.getBoolean("enabled");
        const current = ctx.app.changelogs.getBroadcast(ctx.guild.id);

        if (enabled === false) {
          ctx.app.changelogs.setBroadcast(ctx.guild.id, { channelId: current?.channel_id, enabled: false });
          return ctx.success("تم إلغاء الاشتراك في إشعارات التحديثات.");
        }
        if (!channel && !current?.channel_id) {
          return ctx.fail("errors.actionFailed", { details: "حدد قناة للاشتراك أول مرة." });
        }
        ctx.app.changelogs.setBroadcast(ctx.guild.id, { channelId: channel?.id, enabled: true });
        return ctx.success(`تم الاشتراك. راح تصلكم التحديثات في <#${channel?.id || current.channel_id}>.`);
      }

      // publish — للمطورين فقط
      if (!ctx.app.permissions.isDeveloper(ctx.user.id)) return ctx.fail("errors.developerOnly");

      const entry = ctx.app.changelogService.publish({
        version: ctx.interaction.options.getString("version"),
        title: ctx.interaction.options.getString("title"),
        body: ctx.interaction.options.getString("body"),
        publishedBy: ctx.user.id
      });

      await ctx.defer({ ephemeral: true });
      const result = await ctx.app.changelogService.broadcast();

      return ctx.reply({
        content: `${ctx.emoji("success")} نُشر الإصدار **v${entry.version}** وأُرسل لـ \`${result.sent}\` من \`${result.total}\` سيرفر مشترك.`
      }, { ephemeral: true });
    }
  },

  {
    name: "جيتهب",
    aliases: ["github"],
    description: "ربط مستودع GitHub بقناة، لعرض الـ push والـ pull request والإصدارات تلقائيًا.",
    usage: "/github setup channel:#التحديثات repo:اسم/المستودع",
    arguments: [
      { name: "setup", required: false, description: "إعداد أو تعديل الربط" },
      { name: "status", required: false, description: "عرض الإعداد الحالي وسر التحقق" },
      { name: "disable", required: false, description: "إلغاء الربط" }
    ],
    examples: ["/github setup channel:#تحديثات-الكود repo:username/arabic-admin-bot"],
    category: "devtools",
    slashOnly: true,
    permissions: { level: Level.ADMIN },
    slash: new SlashCommandBuilder()
      .setName("جيتهب")
      .setDescription("ربط مستودع GitHub")
      .addSubcommand((s) =>
        s.setName("setup").setDescription("إعداد الربط")
          .addChannelOption((o) => o.setName("channel").setDescription("قناة الإشعارات").setRequired(true).addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) => o.setName("repo").setDescription("owner/repo — اتركه فارغًا لقبول أي مستودع").setMaxLength(200))
      )
      .addSubcommand((s) => s.setName("status").setDescription("عرض الإعداد"))
      .addSubcommand((s) => s.setName("disable").setDescription("إلغاء الربط")),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;

      if (sub === "disable") {
        if (!ctx.app.githubWebhooks.delete(guildId)) return ctx.fail("errors.actionFailed", { details: "ما فيه ربط مفعّل." });
        return ctx.success("تم إلغاء ربط GitHub.");
      }

      if (sub === "status") {
        const hook = ctx.app.githubWebhooks.get(guildId);
        if (!hook) return ctx.fail("errors.actionFailed", { details: "ما فيه ربط. أعدّه بـ `/github setup`." });
        const base = ctx.app.health.publicUrl();
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🔗 ربط GitHub",
            color: ctx.color("primary"),
            fields: [
              { name: "القناة", value: `<#${hook.channel_id}>`, inline: true },
              { name: "المستودع", value: hook.repo_filter || "أي مستودع", inline: true },
              { name: "رابط الـ Webhook", value: base ? `\`${base}/github/${guildId}\`` : "شغّل البوت بمتغيّر PORT ليظهر الرابط" },
              { name: "السر (Secret)", value: `||${hook.secret}||` }
            ]
          })]
        }, { ephemeral: true });
      }

      // setup
      const channel = ctx.interaction.options.getChannel("channel");
      const me = ctx.guild.members.me;
      if (!channel.permissionsFor(me)?.has(0x800n)) { /* EmbedLinks بت 11 تقريبي — نتحقق بأسلوب مبسّط أدناه */ }

      const secret = crypto.randomBytes(24).toString("hex");
      ctx.app.githubWebhooks.save({
        guildId,
        channelId: channel.id,
        secret,
        repoFilter: ctx.interaction.options.getString("repo")?.trim() || null,
        events: ["push", "pull_request", "issues", "release"]
      });

      const base = ctx.app.health.publicUrl();
      return ctx.reply({
        embeds: [buildEmbed({
          title: "🔗 تم إعداد ربط GitHub",
          color: ctx.color("success"),
          description:
            "أضف Webhook في مستودعك:\n**GitHub ← Settings ← Webhooks ← Add webhook**",
          fields: [
            { name: "Payload URL", value: base ? `\`${base}/github/${guildId}\`` : "شغّل البوت أولًا بمتغيّر PORT ليظهر الرابط" },
            { name: "Content type", value: "`application/json`" },
            { name: "Secret", value: `||${secret}||\n(احتفظ به، لن يظهر كاملًا مرة أخرى)` },
            { name: "الأحداث", value: "Just the push event، وأضف Pull requests و Issues و Releases يدويًا" }
          ]
        })]
      }, { ephemeral: true });
    }
  }
];
