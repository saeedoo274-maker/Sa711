const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const I18n = require("../../../core/i18n/I18n");
const LogService = require("../../../core/logger/LogService");
const views = require("../views");

const langChoices = Object.entries(I18n.SUPPORTED).map(([value, l]) => ({ name: `${l.native} (${value})`, value }));
const colorChoices = ["primary", "success", "danger", "warning", "info", "neutral"].map((c) => ({ name: c, value: c }));
const logCategories = [...new Set(Object.values(LogService.EVENTS).map((e) => e.category))];
const AUTO = {
  triggers: [["member_join", "دخول عضو"], ["member_leave", "خروج عضو"], ["message_keyword", "كلمة في رسالة"], ["role_added", "رتبة جديدة"], ["voice_join", "دخول صوت"],
    ["level_up", "مستوى جديد"], ["ticket_created", "فتح تذكرة"], ["ticket_closed", "إغلاق تذكرة"], ["suggestion_created", "اقتراح جديد"], ["giveaway_ended", "انتهاء سحب"],
    ["schedule_daily", "يوميًا (HH:MM UTC)"], ["schedule_interval", "كل N دقيقة"]],
  conditions: [["has_role", "يملك رتبة"], ["missing_role", "لا يملك رتبة"], ["in_channel", "في قناة"], ["min_account_days", "عمر الحساب ≥ أيام"], ["min_level", "المستوى ≥"], ["chance", "احتمال %"]],
  actions: [["message", "رسالة"], ["dm", "رسالة خاصة"], ["add_role", "إعطاء رتبة"], ["remove_role", "سحب رتبة"], ["add_xp", "XP"], ["add_money", "مال"], ["react", "تفاعل"], ["wait", "انتظار (دقائق)"]]
};
const autoChoices = (list) => list.map(([value, name]) => ({ name, value }));

module.exports = [
  {
    name: "اعداد",
    aliases: ["settings", "config", "setup-server", "اعدادات"],
    description: "مركز إعدادات السيرفر: اللغة، الأنظمة، الثيم، السجلات، الترحيب، التحقق، والإشعارات.",
    usage: "/اعداد features | /اعداد theme color-name:primary color:#5865F2 | /اعداد welcome channel:#welcome",
    arguments: [
      { name: "language", required: false, description: "لغة البوت في السيرفر" },
      { name: "features", required: false, description: "تشغيل/إيقاف الأنظمة" },
      { name: "theme", required: false, description: "ألوان وتذييل وشعار الإمبيدات" },
      { name: "logs", required: false, description: "قنوات وأنواع السجلات" },
      { name: "welcome", required: false, description: "الترحيب" },
      { name: "goodbye", required: false, description: "الوداع" },
      { name: "welcome-button", required: false, description: "أزرار روابط الترحيب" },
      { name: "verify", required: false, description: "التحقق" },
      { name: "notifications", required: false, description: "قنوات إشعارات الطاقم والإدارة" }
    ],
    examples: ["/اعداد language lang:en", "/اعداد features name:levels enabled:true", "/اعداد logs event:messageDelete enabled:false"],
    category: "settings",
    slashOnly: true,
    cooldown: 2000,
    permissions: { level: Level.ADMIN },
    slash: new SlashCommandBuilder()
      .setName("اعداد")
      .setDescription("إعدادات السيرفر")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((s) => s.setName("setup").setDescription("معالج الإعداد خطوة بخطوة مع معاينة"))
      .addSubcommand((s) => s.setName("language").setDescription("لغة البوت")
        .addStringOption((o) => o.setName("lang").setDescription("اللغة").addChoices(...langChoices)))
      .addSubcommand((s) => s.setName("features").setDescription("تشغيل/إيقاف الأنظمة")
        .addStringOption((o) => o.setName("name").setDescription("النظام").setAutocomplete(true))
        .addBooleanOption((o) => o.setName("enabled").setDescription("مفعّل؟")))
      .addSubcommand((s) => s.setName("theme").setDescription("ثيم الإمبيدات")
        .addStringOption((o) => o.setName("color-name").setDescription("أي لون").addChoices(...colorChoices))
        .addStringOption((o) => o.setName("color").setDescription("#RRGGBB").setMaxLength(7))
        .addStringOption((o) => o.setName("footer").setDescription("نص التذييل").setMaxLength(200))
        .addStringOption((o) => o.setName("logo").setDescription("رابط الشعار https://").setMaxLength(500))
        .addStringOption((o) => o.setName("banner").setDescription("رابط البانر https://").setMaxLength(500))
        .addBooleanOption((o) => o.setName("reset").setDescription("إعادة الافتراضي")))
      .addSubcommand((s) => s.setName("logs").setDescription("السجلات")
        .addStringOption((o) => o.setName("event").setDescription("نوع السجل (all = الكل)").setAutocomplete(true))
        .addBooleanOption((o) => o.setName("enabled").setDescription("مفعّل؟"))
        .addStringOption((o) => o.setName("category").setDescription("فئة القناة").addChoices(...logCategories.map((c) => ({ name: c, value: c }))))
        .addChannelOption((o) => o.setName("channel").setDescription("قناة الفئة").addChannelTypes(ChannelType.GuildText)))
      .addSubcommand((s) => s.setName("welcome").setDescription("الترحيب")
        .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addChannelOption((o) => o.setName("rules").setDescription("قناة القوانين (زر)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption((o) => o.setName("embed").setDescription("إمبيد"))
        .addBooleanOption((o) => o.setName("image").setDescription("صورة ترحيب"))
        .addBooleanOption((o) => o.setName("dm").setDescription("رسالة خاصة"))
        .addStringOption((o) => o.setName("edit").setDescription("تعديل النصوص").addChoices(
          { name: "الرسالة والإمبيد", value: "welcome" }, { name: "الرسالة الخاصة", value: "dm" }, { name: "نص الصورة وخلفيتها", value: "image" }))
        .addBooleanOption((o) => o.setName("test").setDescription("معاينة على حسابك")))
      .addSubcommand((s) => s.setName("goodbye").setDescription("الوداع")
        .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
        .addBooleanOption((o) => o.setName("embed").setDescription("إمبيد"))
        .addBooleanOption((o) => o.setName("image").setDescription("صورة"))
        .addBooleanOption((o) => o.setName("edit").setDescription("تعديل النصوص"))
        .addBooleanOption((o) => o.setName("test").setDescription("معاينة")))
      .addSubcommand((s) => s.setName("welcome-button").setDescription("زر رابط في الترحيب")
        .addStringOption((o) => o.setName("label").setDescription("النص").setRequired(true).setMaxLength(80))
        .addStringOption((o) => o.setName("url").setDescription("https:// (فارغ = حذف)").setMaxLength(500)))
      .addSubcommand((s) => s.setName("verify").setDescription("التحقق")
        .addRoleOption((o) => o.setName("role").setDescription("رتبة المتحقق"))
        .addRoleOption((o) => o.setName("unverified").setDescription("رتبة غير المتحقق"))
        .addChannelOption((o) => o.setName("publish").setDescription("نشر لوحة التحقق في").addChannelTypes(ChannelType.GuildText))
        .addBooleanOption((o) => o.setName("edit").setDescription("تعديل نص اللوحة")))
      .addSubcommand((s) => s.setName("notifications").setDescription("قنوات الإشعارات")
        .addChannelOption((o) => o.setName("staff").setDescription("قناة الطاقم").addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName("admin").setDescription("قناة الإدارة").addChannelTypes(ChannelType.GuildText)))
      .addSubcommand((s) => s.setName("appeals").setDescription("الاستئنافات")
        .addChannelOption((o) => o.setName("channel").setDescription("قناة مراجعة الاستئنافات").addChannelTypes(ChannelType.GuildText))
        .addIntegerOption((o) => o.setName("cooldown-days").setDescription("أيام الانتظار بعد الرفض").setMinValue(0).setMaxValue(365))
        .addIntegerOption((o) => o.setName("max").setDescription("أقصى استئنافات لكل قضية").setMinValue(1).setMaxValue(10))
        .addStringOption((o) => o.setName("types").setDescription("الأنواع المسموحة").addChoices(
          { name: "الكل", value: "ban,timeout,warn" }, { name: "الحظر فقط", value: "ban" }, { name: "الحظر والإسكات", value: "ban,timeout" }, { name: "التحذير والإسكات", value: "timeout,warn" })))
      .addSubcommand((s) => s.setName("permissions").setDescription("منشئ الصلاحيات (رتبة/قناة ← نظام/أمر/أمر فرعي)")
        .addStringOption((o) => o.setName("action").setDescription("الإجراء").setRequired(true).addChoices(
          { name: "سماح", value: "allow" }, { name: "منع", value: "deny" }, { name: "حذف قاعدة", value: "remove" },
          { name: "عرض", value: "list" }, { name: "مسح", value: "clear" }, { name: "اختبار عضو", value: "test" }))
        .addStringOption((o) => o.setName("target").setDescription("system:نظام أو أمر أو أمر:فرعي").setAutocomplete(true).setMaxLength(80))
        .addRoleOption((o) => o.setName("role").setDescription("الرتبة"))
        .addChannelOption((o) => o.setName("channel").setDescription("القناة"))
        .addUserOption((o) => o.setName("user").setDescription("العضو (للاختبار)")))
      .addSubcommandGroup((g) => g.setName("automation").setDescription("منشئ الأتمتة")
        .addSubcommand((s) => s.setName("create").setDescription("أتمتة جديدة")
          .addStringOption((o) => o.setName("name").setDescription("الاسم").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("trigger").setDescription("المُشغِّل").setRequired(true).addChoices(...autoChoices(AUTO.triggers)))
          .addStringOption((o) => o.setName("value").setDescription("كلمة / وقت / دقائق / آيدي").setMaxLength(100))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة المُشغِّل أو النشر"))
          .addIntegerOption((o) => o.setName("cooldown").setDescription("تبريد بالثواني").setMinValue(0).setMaxValue(86400)))
        .addSubcommand((s) => s.setName("condition").setDescription("إضافة شرط")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم الأتمتة").setRequired(true))
          .addStringOption((o) => o.setName("type").setDescription("الشرط").setRequired(true).addChoices(...autoChoices(AUTO.conditions)))
          .addStringOption((o) => o.setName("value").setDescription("القيمة").setMaxLength(10))
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة"))
          .addChannelOption((o) => o.setName("channel").setDescription("القناة")))
        .addSubcommand((s) => s.setName("action").setDescription("إضافة إجراء")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم الأتمتة").setRequired(true))
          .addStringOption((o) => o.setName("type").setDescription("الإجراء").setRequired(true).addChoices(...autoChoices(AUTO.actions)))
          .addStringOption((o) => o.setName("value").setDescription("نص / رقم / إيموجي").setMaxLength(1800))
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة"))
          .addChannelOption((o) => o.setName("channel").setDescription("القناة")))
        .addSubcommand((s) => s.setName("remove-step").setDescription("حذف خطوة")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم الأتمتة").setRequired(true))
          .addStringOption((o) => o.setName("kind").setDescription("النوع").setRequired(true).addChoices({ name: "شرط", value: "condition" }, { name: "إجراء", value: "action" }))
          .addIntegerOption((o) => o.setName("index").setDescription("الرقم").setRequired(true).setMinValue(1)))
        .addSubcommand((s) => s.setName("list").setDescription("الأتمتات"))
        .addSubcommand((s) => s.setName("info").setDescription("تفاصيل").addIntegerOption((o) => o.setName("id").setDescription("الرقم").setRequired(true)))
        .addSubcommand((s) => s.setName("toggle").setDescription("تفعيل/إيقاف").addIntegerOption((o) => o.setName("id").setDescription("الرقم").setRequired(true)))
        .addSubcommand((s) => s.setName("delete").setDescription("حذف").addIntegerOption((o) => o.setName("id").setDescription("الرقم").setRequired(true))))
      .addSubcommand((s) => s.setName("api").setDescription("مفاتيح REST API (للمالك)")
        .addStringOption((o) => o.setName("action").setDescription("الإجراء").setRequired(true).addChoices(
          { name: "إنشاء", value: "create" }, { name: "عرض", value: "list" }, { name: "إلغاء", value: "revoke" }))
        .addStringOption((o) => o.setName("name").setDescription("اسم المفتاح").setMaxLength(32))
        .addStringOption((o) => o.setName("scopes").setDescription("الصلاحيات").addChoices(
          { name: "قراءة فقط", value: "read" }, { name: "قراءة + الإشراف", value: "read,read:moderation" },
          { name: "قراءة + تعديل الإعدادات", value: "read,write:config" }, { name: "كل الصلاحيات", value: "read,read:moderation,write:config,write:features" }))
        .addIntegerOption((o) => o.setName("id").setDescription("رقم المفتاح (للإلغاء)").setMinValue(1)))
      .addSubcommand((s) => s.setName("backup").setDescription("نسخ السيرفر الاحتياطي")
        .addStringOption((o) => o.setName("action").setDescription("الإجراء").setRequired(true).addChoices(
          { name: "إنشاء", value: "create" }, { name: "عرض", value: "list" }, { name: "مقارنة", value: "compare" },
          { name: "استعادة", value: "restore" }, { name: "تصدير", value: "export" }, { name: "استيراد", value: "import" },
          { name: "حذف", value: "delete" }, { name: "جدولة", value: "schedule" }))
        .addIntegerOption((o) => o.setName("id").setDescription("رقم النسخة").setMinValue(1))
        .addStringOption((o) => o.setName("name").setDescription("اسم النسخة").setMaxLength(64))
        .addStringOption((o) => o.setName("parts").setDescription("ما يُستعاد").addChoices(
          { name: "الكل", value: "config,roles,channels" }, { name: "إعدادات البوت", value: "config" }, { name: "الرتب", value: "roles" },
          { name: "القنوات", value: "channels" }, { name: "الرتب والقنوات", value: "roles,channels" }))
        .addAttachmentOption((o) => o.setName("file").setDescription("ملف نسخة JSON (للاستيراد)"))
        .addStringOption((o) => o.setName("frequency").setDescription("الجدولة").addChoices({ name: "إيقاف", value: "off" }, { name: "يومي", value: "daily" }, { name: "أسبوعي", value: "weekly" }))
        .addBooleanOption((o) => o.setName("confirm").setDescription("تأكيد الاستعادة"))),

    async autocomplete(interaction, app) {
      const focused = interaction.options.getFocused(true);
      const typed = String(focused.value || "").toLowerCase();
      let list = [];
      if (focused.name === "name") list = app.features.list().map((f) => ({ name: `${f.name} — ${f.label}`.slice(0, 100), value: f.name }));
      if (focused.name === "target") {
        list = [
          ...app.features.list().map((f) => ({ name: `system:${f.name} — ${f.label}`.slice(0, 100), value: `system:${f.name}` })),
          ...app.registry.all().map((c) => ({ name: `${c.name} — ${String(c.description || "").slice(0, 60)}`.slice(0, 100), value: c.name }))
        ];
      }
      if (focused.name === "event") list = [{ name: "all — الكل", value: "all" }, ...Object.entries(LogService.EVENTS).map(([k, e]) => ({ name: `${k} — ${e.label}`.slice(0, 100), value: k }))];
      return interaction.respond(list.filter((x) => x.name.toLowerCase().includes(typed)).slice(0, 25));
    },

    async execute(ctx) {
      const app = ctx.app;
      const guild = ctx.guild;
      const o = ctx.interaction.options;
      const sub = ctx.subcommand();
      const t = (k, v) => ctx.t(k, v);

      if (sub === "setup") return ctx.reply(app.setupWizard.start(ctx.member), { ephemeral: true });

      if (sub === "language") {
        const lang = o.getString("lang");
        if (lang) app.guildConfig.set(guild.id, "language", lang);
        return ctx.reply(views.languagePayload(app, guild), { ephemeral: true });
      }

      if (sub === "features") {
        const name = o.getString("name");
        const enabled = o.getBoolean("enabled");
        if (name && enabled !== null) {
          if (!app.features.isKnown(name)) return ctx.fail("errors.actionFailed", { details: t("cfg.unknownFeature", { name }) });
          if (!app.features.globallyEnabled(name)) return ctx.fail("errors.actionFailed", { details: t("cfg.globallyDisabled", { name }) });
          app.features.setForGuild(guild.id, name, enabled);
        }
        return ctx.reply(views.featuresPayload(app, guild), { ephemeral: true });
      }

      if (sub === "theme") {
        if (o.getBoolean("reset")) app.theme.reset(guild.id);
        const patch = {};
        const colorName = o.getString("color-name");
        const color = o.getString("color");
        if (colorName && color) patch.colors = { [colorName]: color };
        else if (color || colorName) return ctx.fail("errors.actionFailed", { details: t("cfg.colorPair") });
        if (o.getString("footer") !== null) patch.footer = o.getString("footer");
        if (o.getString("logo") !== null) patch.logoUrl = o.getString("logo");
        if (o.getString("banner") !== null) patch.bannerUrl = o.getString("banner");
        if (Object.keys(patch).length) {
          const res = app.theme.update(guild.id, patch);
          if (!res.ok) return ctx.fail("errors.actionFailed", { details: res.errors.join("\n") });
        }
        return ctx.reply(views.themePayload(app, guild), { ephemeral: true });
      }

      if (sub === "logs") {
        const event = o.getString("event");
        const enabled = o.getBoolean("enabled");
        const category = o.getString("category");
        const channel = o.getChannel("channel");
        if (event && enabled !== null) {
          const keys = event === "all" ? Object.keys(LogService.EVENTS) : [event];
          for (const key of keys) {
            if (!app.logs.setEnabled(guild.id, key, enabled)) return ctx.fail("errors.actionFailed", { details: t("cfg.unknownLog", { name: key }) });
          }
        }
        if (category && channel) {
          const me = guild.members.me;
          if (me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
            return ctx.fail("errors.missingBotPermission", { permission: "SendMessages" });
          }
          app.guildConfig.set(guild.id, `logs.${category}`, channel.id);
        }
        return ctx.reply(views.logsPayload(app, guild), { ephemeral: true });
      }

      if (sub === "welcome" || sub === "goodbye") {
        const base = sub === "welcome" ? "welcome" : "welcome.goodbye";
        const edit = sub === "welcome" ? o.getString("edit") : o.getBoolean("edit") ? "goodbye" : null;
        if (edit) return views.openWelcomeModal(ctx, edit);
        const updates = {};
        if (o.getChannel("channel")) updates[`${base}.channelId`] = o.getChannel("channel").id;
        if (sub === "welcome" && o.getChannel("rules")) updates["welcome.rulesChannelId"] = o.getChannel("rules").id;
        if (o.getBoolean("embed") !== null) updates[`${base}.embed.enabled`] = o.getBoolean("embed");
        if (o.getBoolean("image") !== null) updates[`${base}.image.enabled`] = o.getBoolean("image");
        if (sub === "welcome" && o.getBoolean("dm") !== null) updates["welcome.dm.enabled"] = o.getBoolean("dm");
        if (Object.keys(updates).length) app.guildConfig.setMany(guild.id, updates);
        if (o.getBoolean("test")) {
          const payload = await app.welcome.buildPayload(ctx.member, sub);
          return ctx.reply({ ...payload, content: `🧪 ${t("cfg.preview")}\n${payload.content || ""}`.slice(0, 2000), allowedMentions: { parse: [] } }, { ephemeral: true });
        }
        return ctx.reply(views.welcomePayload(app, guild), { ephemeral: true });
      }

      if (sub === "welcome-button") {
        const label = o.getString("label");
        const url = o.getString("url");
        const buttons = (app.welcome.config(guild.id).buttons || []).filter((b) => b.label !== label);
        if (url) {
          if (!require("../../welcome/WelcomeService").validButton(label, url)) return ctx.fail("errors.actionFailed", { details: t("cfg.badUrl") });
          if (buttons.length >= 4) return ctx.fail("errors.actionFailed", { details: t("cfg.maxButtons") });
          buttons.push({ label, url });
        }
        app.guildConfig.set(guild.id, "welcome.buttons", buttons);
        return ctx.reply(views.welcomePayload(app, guild), { ephemeral: true });
      }

      if (sub === "verify") {
        if (o.getBoolean("edit")) return views.openVerifyModal(ctx);
        const updates = {};
        for (const [opt, key] of [["role", "roleId"], ["unverified", "unverifiedRoleId"]]) {
          const role = o.getRole(opt);
          if (!role) continue;
          const me = guild.members.me;
          if (role.managed || (me && role.position >= me.roles.highest.position)) return ctx.fail("moderation.role.botCannotManage");
          updates[`verification.${key}`] = role.id;
        }
        if (Object.keys(updates).length) app.guildConfig.setMany(guild.id, updates);
        const channel = o.getChannel("publish");
        if (channel) {
          if (!app.verification.config(guild.id).roleId) return ctx.fail("errors.actionFailed", { details: t("cfg.verifyNeedsRole") });
          await app.verification.publish(guild, channel);
        }
        return ctx.reply(views.verifyPayload(app, guild), { ephemeral: true });
      }

      if (sub === "notifications") {
        const updates = {};
        if (o.getChannel("staff")) updates["notifications.staffChannelId"] = o.getChannel("staff").id;
        if (o.getChannel("admin")) updates["notifications.adminChannelId"] = o.getChannel("admin").id;
        if (Object.keys(updates).length) app.guildConfig.setMany(guild.id, updates);
        const c = app.guildConfig.value(guild.id, "notifications") || {};
        return ctx.reply({
          embeds: [ctx.embed({
            title: `🔔 ${t("cfg.notifTitle")}`,
            color: "info",
            fields: [
              { name: t("cfg.staffChannel"), value: c.staffChannelId ? `<#${c.staffChannelId}>` : "—", inline: true },
              { name: t("cfg.adminChannel"), value: c.adminChannelId ? `<#${c.adminChannelId}>` : "—", inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      if (sub === "permissions") {
        if (!app.permissionRules) return ctx.fail("errors.systemDisabled", { system: "permissions" });
        const pr = app.permissionRules;
        const action = o.getString("action");
        const target = o.getString("target");
        const role = o.getRole("role");
        const channel = o.getChannel("channel");
        const reasons = { invalid: t("perm.err.invalid"), unknownTarget: t("perm.err.unknownTarget"), protectedCommand: t("perm.err.protected"), maxRules: t("perm.err.max"), notFound: t("perm.err.notFound") };
        if (action === "list") {
          const rows = pr.list(guild.id);
          return ctx.reply({
            embeds: [ctx.embed({
              title: `🛡️ ${t("perm.title")}`,
              color: "info",
              description: rows.map((r) => `${r.effect === "allow" ? "✅" : "⛔"} \`${r.target}\` ← ${r.subject_type === "role" ? `<@&${r.subject_id}>` : `<#${r.subject_id}>`}`).join("\n").slice(0, 4000) || t("ui.empty")
            })],
            allowedMentions: { parse: [] }
          }, { ephemeral: true });
        }
        if (action === "clear") return ctx.success(t("perm.cleared", { count: pr.clear(guild.id, target) }));
        if (action === "test") {
          const user = o.getUser("user");
          const member = user ? await guild.members.fetch(user.id).catch(() => null) : ctx.member;
          const key = pr.normalizeTarget(target);
          if (!member || !key || key.startsWith("system:")) return ctx.fail("errors.actionFailed", { details: reasons.unknownTarget });
          const [name, subName] = key.split(":");
          const command = app.registry.get(name);
          const res = pr.evaluate({ guild, member, channel: channel || ctx.channel, command, subcommand: subName || null, feature: command.feature || command.module });
          const base = app.permissions.check(member, command.permissions || {});
          const final = res.decision === "deny" ? false : res.decision === "allow" ? true : base.ok;
          return ctx.reply({ content: `${final ? "✅" : "⛔"} <@${member.id}> → \`${key}\` — ${res.decision ? `${t("perm.byRule")} \`${res.target}\` (${res.decision}${res.reason ? `/${res.reason}` : ""})` : t("perm.byDefault")}`, allowedMentions: { parse: [] } }, { ephemeral: true });
        }
        if (!target || (!role && !channel)) return ctx.fail("errors.actionFailed", { details: t("perm.err.needSubject") });
        const subjects = [role ? ["role", role.id] : null, channel ? ["channel", channel.id] : null].filter(Boolean);
        const results = subjects.map(([type, id]) => (action === "remove" ? pr.remove(guild.id, target, type, id) : pr.add(guild.id, { target, subjectType: type, subjectId: id, effect: action, userId: ctx.user.id })));
        const failed = results.find((r) => !r.ok);
        if (failed) return ctx.fail("errors.actionFailed", { details: reasons[failed.reason] || failed.reason });
        app.bus.emitSafe("permissions:changed", { guild, actorId: ctx.user.id, action, target });
        return ctx.success(t("perm.saved"));
      }

      if (ctx.subcommandGroup() === "automation") return automationCommand(ctx, sub);
      if (sub === "backup") return backupCommand(ctx);
      if (sub === "api") {
        if (app.permissions.resolveLevel(ctx.member) < Level.GUILD_OWNER) return ctx.fail("errors.noPermission");
        const keys = app.web.keys;
        const action = o.getString("action");
        if (action === "create") {
          const res = keys.create(guild.id, { name: o.getString("name") || "key", scopes: (o.getString("scopes") || "read").split(","), userId: ctx.user.id });
          if (!res.ok) return ctx.fail("errors.actionFailed", { details: t(`api.err.${res.reason}`) });
          app.logger.info(`مفتاح API جديد #${res.id} للسيرفر ${guild.id} بواسطة ${ctx.user.id}`);
          return ctx.reply({ content: `🔑 ${t("api.created", { id: res.id, scopes: res.scopes.join(", ") })}\n\`\`\`\n${res.key}\n\`\`\`` }, { ephemeral: true });
        }
        if (action === "revoke") return keys.revoke(guild.id, o.getInteger("id") || 0) ? ctx.success(t("api.revoked")) : ctx.fail("errors.actionFailed", { details: t("api.err.notFound") });
        const rows = keys.list(guild.id);
        return ctx.reply({
          embeds: [ctx.embed({ title: "🔑 API", color: "info", description: `${rows.map((k) => `\`#${k.id}\` **${k.name}** \`${k.prefix}…\` — ${JSON.parse(k.scopes).join(", ")}${k.last_used_at ? ` • <t:${Math.floor(k.last_used_at / 1000)}:R>` : ""}`).join("\n") || t("ui.empty")}\n\n-# /api/v1/guilds/${guild.id}` })]
        }, { ephemeral: true });
      }

      if (sub === "appeals") {
        if (!app.appeals) return ctx.fail("errors.systemDisabled", { system: "appeals" });
        const updates = {};
        if (o.getChannel("channel")) updates["appeals.channelId"] = o.getChannel("channel").id;
        if (o.getInteger("cooldown-days") !== null) updates["appeals.cooldownMs"] = o.getInteger("cooldown-days") * 86_400_000;
        if (o.getInteger("max") !== null) updates["appeals.maxPerCase"] = o.getInteger("max");
        if (o.getString("types")) updates["appeals.types"] = o.getString("types").split(",");
        if (Object.keys(updates).length) app.guildConfig.setMany(guild.id, updates);
        const c = app.appeals.config(guild.id);
        const pending = app.appeals.pendingPayload(guild);
        pending.embeds[0].addFields(
          { name: "⚙️", value: `${c.channelId ? `<#${c.channelId}>` : "—"} • ${c.types.join(", ")} • max ${c.maxPerCase} • ${Math.round(c.cooldownMs / 86_400_000)}d` }
        );
        return ctx.reply(pending, { ephemeral: true });
      }

      return ctx.fail("errors.actionFailed", { details: sub || "?" });
    }
  }
];

async function backupCommand(ctx) {
  const app = ctx.app;
  const svc = app.guildBackups;
  if (!svc || !app.features.isEnabled(ctx.guild.id, "backups")) return ctx.fail("errors.systemDisabled", { system: "guild-backup" });
  const o = ctx.interaction.options;
  const t = (k, v) => ctx.t(k, v);
  const guild = ctx.guild;
  const action = o.getString("action");
  const owner = app.permissions.resolveLevel(ctx.member) >= Level.GUILD_OWNER;
  const fail = (reason) => ctx.fail("errors.actionFailed", { details: t(`bkp.err.${reason}`) });
  // العمليات التي تكتب على السيرفر أو تُخرج إعداداته كاملة: للمالك فقط
  if (["restore", "import", "export", "delete"].includes(action) && !owner) return ctx.fail("errors.noPermission");

  if (action === "create") {
    const res = svc.create(guild, { name: o.getString("name"), userId: ctx.user.id });
    return res.ok ? ctx.success(t("bkp.created", { id: res.id, kb: Math.ceil(res.size / 1024) })) : fail(res.reason);
  }
  if (action === "list") {
    const rows = svc.list(guild.id);
    return ctx.reply({
      embeds: [ctx.embed({
        title: `💾 ${t("bkp.title")}`,
        color: "info",
        description: rows.map((r) => {
          const s = JSON.parse(r.summary || "{}");
          return `\`#${r.id}\` **${r.name}** (${r.kind}) — <t:${Math.floor(r.created_at / 1000)}:R> • 🎭 ${s.roles} • # ${s.channels} • ${Math.ceil(r.size_bytes / 1024)}KB`;
        }).join("\n") || t("ui.empty"),
        footer: `${t("bkp.schedule")}: ${svc.config(guild.id).schedule || "—"}`
      })]
    }, { ephemeral: true });
  }
  if (action === "schedule") {
    const freq = o.getString("frequency") || "off";
    svc.setSchedule(guild.id, freq === "off" ? null : freq);
    return ctx.success(t("bkp.scheduled", { freq }));
  }
  if (action === "import") {
    const att = o.getAttachment("file");
    if (!att || att.size > svc.config(guild.id).maxBytes || !/\.json$/i.test(att.name || "")) return fail("file");
    const res = await require("../../../core/utils/safeFetch").safeFetch(att.url, { json: true, maxBytes: svc.config(guild.id).maxBytes, timeoutMs: 10_000 });
    if (!res.ok) return fail("file");
    const stored = svc.import(guild, res.json, ctx.user.id);
    return stored.ok ? ctx.success(t("bkp.imported", { id: stored.id })) : fail(stored.reason);
  }

  const id = o.getInteger("id");
  const backup = id ? svc.get(guild.id, id) : null;
  if (!backup) return fail("notFound");

  if (action === "delete") return svc.delete(guild.id, id) ? ctx.success(t("bkp.deleted", { id })) : fail("notFound");
  if (action === "export") {
    const { AttachmentBuilder } = require("discord.js");
    return ctx.reply({ files: [new AttachmentBuilder(Buffer.from(JSON.stringify(backup.data, null, 2), "utf8"), { name: `guild-backup-${id}.json` })] }, { ephemeral: true });
  }
  if (action === "compare") {
    const d = svc.compare(guild, backup.data);
    const line = (x) => `➖ ${x.missing.length} • ➕ ${x.extra.length} • ✏️ ${x.changed.length}${x.missing.length ? `\n-# ${x.missing.slice(0, 10).join("، ")}` : ""}`;
    return ctx.reply({
      embeds: [ctx.embed({
        title: `🔍 ${t("bkp.compareTitle", { id })}`,
        color: "info",
        fields: [
          { name: t("bkp.roles"), value: line(d.roles) },
          { name: t("bkp.channels"), value: line(d.channels) },
          { name: t("bkp.config"), value: d.config.length ? `✏️ ${d.config.length}\n-# ${d.config.slice(0, 10).join("، ")}` : "✅" }
        ],
        footer: t("bkp.compareHint")
      })]
    }, { ephemeral: true });
  }
  // restore
  if (!o.getBoolean("confirm")) return fail("confirm");
  const parts = (o.getString("parts") || "config").split(",");
  const res = svc.startRestore(guild, id, parts, ctx.user.id);
  return res.ok ? ctx.success(t("bkp.restoreQueued", { job: res.jobId, parts: parts.join(", ") })) : fail(res.reason);
}

async function automationCommand(ctx, sub) {
  const app = ctx.app;
  const svc = app.automation;
  if (!svc || !app.features.isEnabled(ctx.guild.id, "automation")) return ctx.fail("errors.systemDisabled", { system: "automation" });
  const o = ctx.interaction.options;
  const t = (k, v) => ctx.t(k, v);
  const guild = ctx.guild;
  const fail = (reason) => ctx.fail("errors.actionFailed", { details: t(`auto.err.${reason}`) });

  if (sub === "list") {
    const rows = svc.list(guild.id);
    return ctx.reply({
      embeds: [ctx.embed({
        title: `⚙️ ${t("auto.title")}`,
        color: "info",
        description: rows.map((a) => `${a.enabled ? "🟢" : "⚪"} \`#${a.id}\` **${a.name}** — ${t(`auto.trigger.${a.trigger.type}`)} • ${a.conditions.length}🔎 ${a.actions.length}⚡ • ▶️ ${a.runs}${a.last_error ? " ⚠️" : ""}`).join("\n") || t("ui.empty")
      })]
    }, { ephemeral: true });
  }
  if (sub === "create") {
    const res = svc.create(guild, ctx.member, { name: o.getString("name"), trigger: o.getString("trigger"), value: o.getString("value"), channelId: o.getChannel("channel")?.id || null, cooldownMs: (o.getInteger("cooldown") || 0) * 1000 });
    return res.ok ? ctx.success(t("auto.created", { id: res.id })) : fail(res.reason);
  }
  const auto = svc.get(guild.id, o.getInteger("id"));
  if (!auto) return fail("notFound");
  if (sub === "condition") {
    const res = svc.addCondition(guild, auto, { type: o.getString("type"), value: o.getString("value"), roleId: o.getRole("role")?.id, channelId: o.getChannel("channel")?.id });
    return res.ok ? ctx.success(t("auto.saved")) : fail(res.reason);
  }
  if (sub === "action") {
    const res = svc.addAction(guild, auto, { type: o.getString("type"), value: o.getString("value"), role: o.getRole("role"), channelId: o.getChannel("channel")?.id });
    return res.ok ? ctx.success(t("auto.saved")) : fail(res.reason);
  }
  if (sub === "remove-step") {
    const res = svc.removeStep(auto, o.getString("kind"), o.getInteger("index"));
    return res.ok ? ctx.success(t("auto.saved")) : fail(res.reason);
  }
  if (sub === "toggle") return ctx.success(t(svc.toggle(guild.id, auto.id) ? "auto.enabled" : "auto.disabled", { id: auto.id }));
  if (sub === "delete") return svc.delete(guild.id, auto.id) ? ctx.success(t("auto.deleted", { id: auto.id })) : fail("notFound");
  const d = svc.describe(auto, t);
  return ctx.reply({
    embeds: [ctx.embed({
      title: `⚙️ #${auto.id} ${auto.name}`,
      color: auto.enabled ? "primary" : "neutral",
      fields: [
        { name: t("auto.whenLabel"), value: d.trig },
        { name: t("auto.ifLabel"), value: d.cond.join("\n") || "—" },
        { name: t("auto.thenLabel"), value: d.acts.join("\n") || "—" },
        { name: "▶️", value: `${auto.runs}${auto.last_run_at ? ` • <t:${Math.floor(auto.last_run_at / 1000)}:R>` : ""}${auto.last_error ? `\n⚠️ ${auto.last_error.slice(0, 200)}` : ""}` }
      ]
    })],
    allowedMentions: { parse: [] }
  }, { ephemeral: true });
}
