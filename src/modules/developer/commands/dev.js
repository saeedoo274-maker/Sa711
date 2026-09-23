const { SlashCommandBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, formatDuration, timestamp, truncate } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "مطور",
    aliases: ["dev"],
    description: "أدوات المطور: الحالة، التشخيص، الأخطاء، إعادة التحميل، وضع الصيانة.",
    usage: "/dev status | /dev errors | /dev reload | /dev maintenance",
    arguments: [
      { name: "status", required: false, description: "حالة النظام والموارد" },
      { name: "diagnostics", required: false, description: "تشخيص شامل للأنظمة" },
      { name: "database", required: false, description: "حالة قاعدة البيانات" },
      { name: "errors", required: false, description: "آخر الأخطاء المسجّلة" },
      { name: "modules", required: false, description: "الأنظمة والأوامر المحمّلة" },
      { name: "reload", required: false, description: "إعادة تحميل الأوامر بدون إعادة تشغيل" },
      { name: "maintenance", required: false, description: "تشغيل أو إيقاف وضع الصيانة" }
    ],
    examples: ["/dev status", "/dev errors limit:5"],
    category: "developer",
    slashOnly: true,
    cooldown: 0,
    // الفحص المزدوج: هنا وفي CommandHandler، ولا يعتمد على إخفاء الأمر
    permissions: { developerOnly: true, level: Level.DEVELOPER },
    slash: new SlashCommandBuilder()
      .setName("مطور")
      .setDescription("أدوات المطور")
      .addSubcommand((s) => s.setName("status").setDescription("حالة النظام"))
      .addSubcommand((s) => s.setName("diagnostics").setDescription("تشخيص شامل"))
      .addSubcommand((s) => s.setName("database").setDescription("حالة قاعدة البيانات"))
      .addSubcommand((s) => s.setName("modules").setDescription("الأنظمة المحمّلة"))
      .addSubcommand((s) =>
        s.setName("errors").setDescription("آخر الأخطاء")
          .addIntegerOption((o) => o.setName("limit").setDescription("عدد الأخطاء").setMinValue(1).setMaxValue(15))
          .addStringOption((o) => o.setName("id").setDescription("عرض خطأ محدد برقمه"))
      )
      .addSubcommand((s) => s.setName("reload").setDescription("إعادة تحميل الأوامر"))
      .addSubcommand((s) =>
        s.setName("maintenance").setDescription("وضع الصيانة")
          .addBooleanOption((o) => o.setName("enabled").setDescription("مفعّل؟").setRequired(true))
      ),

    async execute(ctx) {
      // فحص إضافي من جهة الخادم، لا يعتمد على واجهة ديسكورد إطلاقًا
      if (!ctx.app.permissions.isDeveloper(ctx.user.id)) return ctx.fail("errors.developerOnly");

      const sub = ctx.interaction.options.getSubcommand();
      const app = ctx.app;

      if (sub === "status") {
        const mem = process.memoryUsage();
        return ctx.reply({
          embeds: [buildEmbed({
            title: `${ctx.emoji("developer")} ${ctx.t("developer.statusTitle")}`,
            color: ctx.color("danger"),
            fields: [
              { name: "وقت التشغيل", value: formatDuration(process.uptime() * 1000), inline: true },
              { name: "الذاكرة", value: `\`${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.rss / 1024 / 1024)} MB\``, inline: true },
              { name: "زمن الاستجابة", value: `\`${Math.round(app.client.ws.ping)} ms\``, inline: true },
              { name: "السيرفرات", value: `\`${app.client.guilds.cache.size}\``, inline: true },
              { name: "المستخدمون (تقديري)", value: `\`${app.client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}\``, inline: true },
              { name: "Node", value: `\`${process.version}\``, inline: true },
              { name: "وضع الصيانة", value: app.maintenance ? "🔴 مفعّل" : "🟢 معطّل", inline: true },
              { name: "البيئة", value: `\`${app.config.env.nodeEnv}\``, inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      if (sub === "database") {
        const stats = app.database.stats();
        return ctx.reply({
          embeds: [buildEmbed({
            title: `${ctx.emoji("developer")} ${ctx.t("developer.databaseTitle")}`,
            color: ctx.color("info"),
            description: `المسار: \`${stats.path}\`\nالحجم: \`${Math.round(stats.sizeBytes / 1024)} KB\``,
            fields: Object.entries(stats.tables).slice(0, 24).map(([name, count]) => ({
              name: `\`${name}\``, value: `${count} صف`, inline: true
            }))
          })]
        }, { ephemeral: true });
      }

      if (sub === "modules") {
        const lines = [...app.registry.modules.entries()].map(
          ([name, cmds]) => `**${name}** — \`${cmds.length}\` أمر\n${cmds.map((c) => `\`${c}\``).join(" ")}`
        );
        return ctx.reply({
          embeds: [buildEmbed({
            title: `${ctx.emoji("developer")} ${ctx.t("developer.modulesTitle")}`,
            description: lines.join("\n\n") || "لا توجد أنظمة محمّلة.",
            color: ctx.color("info"),
            footer: `الإجمالي: ${app.registry.commands.size} أمر`
          })]
        }, { ephemeral: true });
      }

      if (sub === "errors") {
        const id = ctx.interaction.options.getString("id");
        if (id) {
          const record = app.errorRepo.getById(id.toUpperCase());
          if (!record) return ctx.fail("errors.actionFailed", { details: "لم أجد خطأ بهذا الرقم." });
          return ctx.reply({
            embeds: [buildEmbed({
              title: `🐛 خطأ ${record.error_id}`,
              color: ctx.color("danger"),
              description: `\`\`\`\n${truncate(record.message, 900)}\n\`\`\``,
              fields: [
                { name: "النظام", value: `\`${record.system || "—"}\``, inline: true },
                { name: "الأمر", value: `\`${record.command || "—"}\``, inline: true },
                { name: "الوقت", value: timestamp(record.created_at, "F"), inline: true },
                { name: "Stack", value: `\`\`\`\n${truncate(record.stack || "—", 900)}\n\`\`\`` }
              ]
            })]
          }, { ephemeral: true });
        }

        const limit = ctx.interaction.options.getInteger("limit") || 5;
        const list = app.errorRepo.recent(limit);
        if (!list.length) return ctx.success("لا توجد أخطاء مسجّلة. 🎉");
        return ctx.reply({
          embeds: [buildEmbed({
            title: `${ctx.emoji("developer")} ${ctx.t("developer.errorsTitle")}`,
            color: ctx.color("danger"),
            fields: list.map((e) => ({
              name: `\`${e.error_id}\` • ${e.system || "core"}`,
              value: `${truncate(e.message, 150)}\n${timestamp(e.created_at, "R")}`
            })),
            footer: `الإجمالي: ${app.errorRepo.count()}`
          })]
        }, { ephemeral: true });
      }

      if (sub === "reload") {
        const count = app.registry.load();
        return ctx.success(ctx.t("developer.reloaded", { count }));
      }

      if (sub === "maintenance") {
        const enabled = ctx.interaction.options.getBoolean("enabled");
        app.maintenance = enabled;
        return ctx.success(ctx.t(enabled ? "developer.maintenanceOn" : "developer.maintenanceOff"));
      }

      // diagnostics
      const checks = [];
      const dbOk = (() => { try { app.database.stats(); return true; } catch { return false; } })();
      checks.push({ name: "قاعدة البيانات", value: dbOk ? "🟢 تعمل" : "🔴 خطأ", inline: true });
      checks.push({ name: "الاتصال بديسكورد", value: app.client.ws.ping >= 0 ? "🟢 متصل" : "🔴 منقطع", inline: true });
      checks.push({ name: "الأوامر", value: app.registry.commands.size > 0 ? `🟢 ${app.registry.commands.size}` : "🔴 لا توجد", inline: true });
      checks.push({ name: "معالجات التفاعل", value: `🟢 ${app.interactions.handlers.size}`, inline: true });
      checks.push({ name: "اللغات", value: `🟢 ${app.i18n.locales.size}`, inline: true });
      checks.push({ name: "المطورون", value: `\`${app.config.developerIds.length}\``, inline: true });
      checks.push({ name: "أخطاء آخر ساعة", value: `\`${app.errorRepo.countSince(Date.now() - 3600000)}\``, inline: true });
      checks.push({ name: "كاش الإعدادات", value: `\`${app.guildConfig.cache.size}\` سيرفر`, inline: true });

      return ctx.reply({
        embeds: [buildEmbed({ title: `${ctx.emoji("developer")} تشخيص شامل`, color: ctx.color("info"), fields: checks })]
      }, { ephemeral: true });
    }
  }
];
