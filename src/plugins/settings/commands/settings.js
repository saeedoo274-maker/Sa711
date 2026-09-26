const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const I18n = require("../../../core/i18n/I18n");
const LogService = require("../../../core/logger/LogService");
const views = require("../views");

const langChoices = Object.entries(I18n.SUPPORTED).map(([value, l]) => ({ name: `${l.native} (${value})`, value }));
const colorChoices = ["primary", "success", "danger", "warning", "info", "neutral"].map((c) => ({ name: c, value: c }));
const logCategories = [...new Set(Object.values(LogService.EVENTS).map((e) => e.category))];

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
          { name: "الكل", value: "ban,timeout,warn" }, { name: "الحظر فقط", value: "ban" }, { name: "الحظر والإسكات", value: "ban,timeout" }, { name: "التحذير والإسكات", value: "timeout,warn" }))),

    async autocomplete(interaction, app) {
      const focused = interaction.options.getFocused(true);
      const typed = String(focused.value || "").toLowerCase();
      let list = [];
      if (focused.name === "name") list = app.features.list().map((f) => ({ name: `${f.name} — ${f.label}`.slice(0, 100), value: f.name }));
      if (focused.name === "event") list = [{ name: "all — الكل", value: "all" }, ...Object.entries(LogService.EVENTS).map(([k, e]) => ({ name: `${k} — ${e.label}`.slice(0, 100), value: k }))];
      return interaction.respond(list.filter((x) => x.name.toLowerCase().includes(typed)).slice(0, 25));
    },

    async execute(ctx) {
      const app = ctx.app;
      const guild = ctx.guild;
      const o = ctx.interaction.options;
      const sub = ctx.subcommand();
      const t = (k, v) => ctx.t(k, v);

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
