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
      { name: "maintenance", required: false, description: "تشغيل أو إيقاف وضع الصيانة" },
      { name: "migrations", required: false, description: "حالة الهجرات والتراجع" },
      { name: "plugins / flags", required: false, description: "الإضافات وأعلام الميزات العامة" },
      { name: "jobs", required: false, description: "المجدول والطابور (عرض/إلغاء)" },
      { name: "maint", required: false, description: "صيانة لنظام أو أمر محدد، أو مجدولة" },
      { name: "test", required: false, description: "مركز الاختبار (فحوص ذاتية)" },
      { name: "backup", required: false, description: "نسخة احتياطية فورية لقاعدة البيانات" }
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
      )
      .addSubcommand((s) => s.setName("migrations").setDescription("الهجرات")
        .addStringOption((o) => o.setName("action").setDescription("الإجراء").addChoices(
          { name: "الحالة", value: "status" }, { name: "فحص السلامة", value: "integrity" }, { name: "تراجع", value: "rollback" }))
        .addStringOption((o) => o.setName("name").setDescription("اسم الهجرة (للتراجع)").setAutocomplete(true))
        .addBooleanOption((o) => o.setName("confirm").setDescription("تأكيد التراجع")))
      .addSubcommand((s) => s.setName("plugins").setDescription("الإضافات وصحتها"))
      .addSubcommand((s) => s.setName("flags").setDescription("أعلام الميزات العامة")
        .addStringOption((o) => o.setName("name").setDescription("الميزة").setAutocomplete(true))
        .addStringOption((o) => o.setName("state").setDescription("الحالة").addChoices(
          { name: "تشغيل", value: "on" }, { name: "إيقاف عام", value: "off" }, { name: "الافتراضي", value: "default" })))
      .addSubcommand((s) => s.setName("jobs").setDescription("المجدول والطابور")
        .addStringOption((o) => o.setName("cancel").setDescription("إلغاء: s:<id> مهمة مجدولة أو q:<id> مهمة طابور").setMaxLength(30)))
      .addSubcommand((s) => s.setName("maint").setDescription("صيانة محددة")
        .addStringOption((o) => o.setName("scope").setDescription("النطاق").setRequired(true).addChoices(
          { name: "عام", value: "global" }, { name: "نظام", value: "module" }, { name: "أمر", value: "command" }))
        .addBooleanOption((o) => o.setName("enabled").setDescription("مفعّل؟").setRequired(true))
        .addStringOption((o) => o.setName("target").setDescription("اسم النظام أو الأمر").setMaxLength(40))
        .addStringOption((o) => o.setName("message").setDescription("رسالة للمستخدمين").setMaxLength(200))
        .addStringOption((o) => o.setName("duration").setDescription("ينتهي بعد (مثل 30m)").setMaxLength(10)))
      .addSubcommand((s) => s.setName("test").setDescription("مركز الاختبار"))
      .addSubcommand((s) => s.setName("backup").setDescription("نسخة احتياطية فورية")),

    async autocomplete(interaction, app) {
      if (!app.permissions.isDeveloper(interaction.user.id)) return interaction.respond([]);
      const focused = interaction.options.getFocused(true);
      const typed = String(focused.value || "").toLowerCase();
      const list = focused.name === "name" && interaction.options.getSubcommand() === "migrations"
        ? app.database.migrationStatus().filter((m) => m.appliedAt && m.reversible).map((m) => m.name)
        : app.features.list().map((f) => f.name);
      return interaction.respond(list.filter((x) => x.toLowerCase().includes(typed)).slice(-25).map((x) => ({ name: x.slice(0, 100), value: x.slice(0, 100) })));
    },

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

      if (["migrations", "plugins", "flags", "jobs", "maint", "test", "backup"].includes(sub)) return devConsole(ctx, sub);

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

const { parseDuration } = require("../../../core/utils/helpers");

async function devConsole(ctx, sub) {
  const app = ctx.app;
  const o = ctx.interaction.options;
  const embed = (title, lines, color = "info") => ctx.reply({ embeds: [buildEmbed({ title, description: truncate(lines.join("\n"), 4000) || "—", color: ctx.color(color) })] }, { ephemeral: true });

  if (sub === "migrations") {
    const action = o.getString("action") || "status";
    if (action === "integrity") {
      const res = app.database.integrityCheck();
      return embed("🩺 Integrity", [res.ok ? "✅ ok" : `❌ ${JSON.stringify(res.integrity).slice(0, 500)}`, `FK issues: ${res.foreignKeys.length}`], res.ok ? "success" : "danger");
    }
    if (action === "rollback") {
      const name = o.getString("name");
      if (!name || !o.getBoolean("confirm")) return ctx.fail("errors.actionFailed", { details: "حدد اسم الهجرة و confirm:true — التراجع يحذف جداول/أعمدة تلك الهجرة." });
      const res = app.database.rollback(name);
      app.logger.warn(`تراجع عن هجرة ${name} بواسطة ${ctx.user.id}: ${res.ok}`);
      return res.ok ? ctx.success(`تم التراجع عن \`${res.name}\`. أعد تشغيل البوت لإعادة تطبيقها أو استخدم npm run migrate.`) : ctx.fail("errors.actionFailed", { details: res.reason });
    }
    const rows = app.database.migrationStatus();
    const pending = rows.filter((m) => !m.appliedAt);
    return embed(`🧱 Migrations — ${rows.length - pending.length}/${rows.length}`, [
      ...pending.map((m) => `… ${m.name}`),
      ...rows.filter((m) => m.appliedAt).slice(-15).map((m) => `✓${m.reversible ? " ↺" : ""} ${m.name}`)
    ]);
  }

  if (sub === "plugins") {
    const rows = await app.plugins.health();
    return embed(`🧩 Plugins (${rows.length})`, rows.map((r) => `${r.ok ? "🟢" : "🔴"} **${r.name}** \`${r.version || "?"}\` ${r.status}${r.details ? ` — ${truncate(r.details, 80)}` : ""}${r.error ? ` — ${truncate(r.error, 120)}` : ""}`));
  }

  if (sub === "flags") {
    const name = o.getString("name");
    const state = o.getString("state");
    if (name && state) {
      if (!app.features.isKnown(name)) return ctx.fail("errors.actionFailed", { details: "ميزة غير معروفة." });
      app.features.setGlobal(name, state === "default" ? null : state === "on");
      app.logger.warn(`علم عام ${name} = ${state} بواسطة ${ctx.user.id}`);
    }
    return embed("🚩 Global flags", app.features.list().map((f) => `${app.features.globallyEnabled(f.name) ? "🟢" : "🔴"} \`${f.name}\` (${f.source}, default ${f.default ? "on" : "off"})`));
  }

  if (sub === "jobs") {
    const cancel = o.getString("cancel");
    if (cancel) {
      const [kind, idRaw] = cancel.split(":");
      const id = parseInt(idRaw, 10);
      const ok = kind === "s" ? app.scheduler.cancel(id) : kind === "q" ? app.queue.cancel(id) : false;
      return ok ? ctx.success(`تم إلغاء ${cancel}.`) : ctx.fail("errors.actionFailed", { details: "لم يُلغَ (غير موجود أو منتهٍ)." });
    }
    const sch = app.scheduler.status();
    const q = app.queue.status();
    const upcoming = app.db.prepare("SELECT id, type, run_at, attempts FROM scheduled_jobs WHERE status = 'pending' ORDER BY run_at ASC LIMIT 8").all();
    const running = app.db.prepare("SELECT id, queue, status, progress, total FROM queue_jobs WHERE status IN ('pending','running') ORDER BY id DESC LIMIT 8").all();
    return embed("⏱️ Jobs", [
      `**Scheduler** running=${sch.running} ticks=${sch.ticks} executed=${sch.executed} failed=${sch.failed}`,
      `counts: ${JSON.stringify(sch.counts)}`,
      ...upcoming.map((j) => `s:${j.id} \`${j.type}\` <t:${Math.floor(j.run_at / 1000)}:R>${j.attempts ? ` (retry ${j.attempts})` : ""}`),
      "",
      `**Queue** processed=${q.processed} failed=${q.failed}`,
      ...running.map((j) => `q:${j.id} \`${j.queue}\` ${j.status} ${j.total ? `${j.progress}/${j.total}` : ""}`)
    ]);
  }

  if (sub === "maint") {
    const scope = o.getString("scope");
    const target = o.getString("target");
    if (scope !== "global" && !target) return ctx.fail("errors.actionFailed", { details: "حدد اسم النظام أو الأمر." });
    const dur = o.getString("duration");
    const ms = dur ? parseDuration(dur) : null;
    if (dur && !ms) return ctx.fail("errors.invalidDuration");
    app.maintenanceService.set(scope, scope === "global" ? null : target, {
      enabled: o.getBoolean("enabled"), message: o.getString("message"), endsAt: ms ? Date.now() + ms : null, actorId: ctx.user.id
    });
    return ctx.success(`صيانة \`${scope}${target ? `:${target}` : ""}\` = ${o.getBoolean("enabled") ? "🔴 مفعّلة" : "🟢 متوقفة"}${ms ? ` حتى <t:${Math.floor((Date.now() + ms) / 1000)}:R>` : ""}`);
  }

  if (sub === "backup") {
    const res = await app.backups.run();
    return res?.ok === false ? ctx.fail("errors.actionFailed", { details: res.error }) : ctx.success("تم إنشاء نسخة احتياطية.");
  }

  // test
  const report = await app.testCenter.run();
  const icon = { pass: "🟢", warn: "🟡", fail: "🔴" };
  return embed(
    `🧪 Test Center — ${report.summary.pass}✅ ${report.summary.warn}⚠️ ${report.summary.fail}❌ (${report.ms}ms)`,
    report.results.map((r) => `${icon[r.status]} \`${r.name}\` ${r.details ? `— ${truncate(String(r.details), 150)}` : ""}`),
    report.summary.fail ? "danger" : report.summary.warn ? "warning" : "success"
  );
}
