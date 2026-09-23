const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, truncate } = require("../../../core/utils/helpers");

/**
 * الأنظمة وما يلزمها لتعمل فعليًا.
 * `requires` قنوات أو رتب لازمة، و`warns` تنبيهات لا تمنع العمل.
 */
const SYSTEMS = [
  { flag: "moderation.enabled", label: "الإدارة", logs: ["moderation"] },
  { flag: "tickets.enabled", label: "التذاكر", requires: [{ path: "tickets.categoryId", type: "category", label: "كاتيغوري التذاكر" }], logs: ["tickets"] },
  { flag: "economy.enabled", label: "البنك", logs: ["economy"] },
  { flag: "violations.enabled", label: "المخالفات", warns: [{ path: "violations.suspendRoleId", type: "role", label: "رتبة إيقاف الخدمات" }], logs: ["violations"] },
  { flag: "flights.enabled", label: "الطيران", logs: ["flights"] },
  { flag: "quiz.enabled", label: "اختبار التفعيل", warns: [{ path: "quiz.passRoleId", type: "role", label: "رتبة التفعيل" }], logs: ["quiz"] },
  { flag: "leave.enabled", label: "الإجازات", requires: [{ path: "leave.requestChannelId", type: "channel", label: "قناة طلبات الإجازة" }], warns: [{ path: "leave.leaveRoleId", type: "role", label: "رتبة الإجازة" }], logs: ["leave"] },
  { flag: "resign.enabled", label: "الاستقالات", requires: [{ path: "resign.requestChannelId", type: "channel", label: "قناة طلبات الاستقالة" }], logs: ["resign"] },
  { flag: "reports.enabled", label: "البلاغات", requires: [{ path: "reports.channelId", type: "channel", label: "قناة البلاغات" }], logs: ["reports"] },
  { flag: "security.enabled", label: "الحماية", botPerms: [PermissionFlagsBits.ViewAuditLog], logs: ["security"] },
  { flag: "autoRoles.enabled", label: "الرتب التلقائية", botPerms: [PermissionFlagsBits.ManageRoles] },
  { flag: "starboard.enabled", label: "لوحة النجوم", requires: [{ path: "starboard.channelId", type: "channel", label: "قناة لوحة النجوم" }] }
];

const CORE_PERMS = [
  { flag: PermissionFlagsBits.ManageRoles, label: "إدارة الرتب" },
  { flag: PermissionFlagsBits.ManageChannels, label: "إدارة القنوات" },
  { flag: PermissionFlagsBits.ManageMessages, label: "إدارة الرسائل" },
  { flag: PermissionFlagsBits.BanMembers, label: "الحظر" },
  { flag: PermissionFlagsBits.KickMembers, label: "الطرد" },
  { flag: PermissionFlagsBits.ModerateMembers, label: "الإسكات" },
  { flag: PermissionFlagsBits.EmbedLinks, label: "إرسال الإمبيدات" },
  { flag: PermissionFlagsBits.AttachFiles, label: "إرفاق الملفات" },
  { flag: PermissionFlagsBits.ReadMessageHistory, label: "قراءة سجل الرسائل" }
];

/** يفحص إعدادات السيرفر ويصنّف النتائج إلى أخطاء وتنبيهات وسليم. */
function runChecks(app, guild) {
  const cfg = app.guildConfig.get(guild.id);
  const me = guild.members.me;
  const errors = [];
  const warnings = [];
  const ok = [];

  const value = (path) => path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), cfg);

  const resolve = (id, type) => {
    if (!id) return null;
    if (type === "role") return guild.roles.cache.get(id) || null;
    return guild.channels.cache.get(id) || null;
  };

  // 1) صلاحيات البوت العامة
  const missingPerms = CORE_PERMS.filter((p) => !me?.permissions.has(p.flag));
  if (missingPerms.length) {
    warnings.push(`صلاحيات ناقصة للبوت: ${missingPerms.map((p) => `**${p.label}**`).join(" • ")}`);
  } else {
    ok.push("كل صلاحيات البوت الأساسية متوفرة");
  }

  // 2) موضع رتبة البوت
  const botPosition = me?.roles.highest.position ?? 0;
  const higherRoles = guild.roles.cache.filter((r) => r.position >= botPosition && r.id !== guild.id && !r.managed).size;
  if (higherRoles > 0) {
    warnings.push(`\`${higherRoles}\` رتبة أعلى من رتبة البوت — لن يقدر على إدارتها. ارفع رتبة البوت.`);
  } else {
    ok.push("رتبة البوت أعلى من كل الرتب");
  }

  // 3) رتبة الطاقم الأساسية
  const staffRoleId = value("staff.baseRoleId");
  if (!staffRoleId) {
    warnings.push("رتبة الطاقم الأساسية غير محددة — أنظمة كثيرة تعتمد عليها.");
  } else if (!resolve(staffRoleId, "role")) {
    errors.push("رتبة الطاقم الأساسية **محذوفة** من السيرفر. أعد تحديدها.");
  } else {
    ok.push("رتبة الطاقم محددة وموجودة");
  }

  // 4) الأنظمة المفعّلة ومتطلباتها
  for (const system of SYSTEMS) {
    const enabled = value(system.flag);
    if (!enabled) continue;

    for (const req of system.requires || []) {
      const id = value(req.path);
      if (!id) {
        errors.push(`**${system.label}** مفعّل لكن ${req.label} غير محددة.`);
      } else if (!resolve(id, req.type === "role" ? "role" : "channel")) {
        errors.push(`**${system.label}**: ${req.label} **محذوفة** من السيرفر.`);
      }
    }

    for (const warn of system.warns || []) {
      const id = value(warn.path);
      if (!id) warnings.push(`**${system.label}**: ${warn.label} غير محددة.`);
      else if (!resolve(id, warn.type === "role" ? "role" : "channel")) {
        warnings.push(`**${system.label}**: ${warn.label} محذوفة.`);
      }
    }

    for (const perm of system.botPerms || []) {
      if (!me?.permissions.has(perm)) {
        errors.push(`**${system.label}** يحتاج صلاحية ناقصة عند البوت.`);
      }
    }

    for (const log of system.logs || []) {
      const id = value(`logs.${log}`);
      if (!id) warnings.push(`**${system.label}**: قناة السجل غير مربوطة — لن تتوثّق العمليات.`);
      else {
        const channel = resolve(id, "channel");
        if (!channel) errors.push(`**${system.label}**: قناة السجل **محذوفة**.`);
        else if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          errors.push(`**${system.label}**: لا أملك صلاحية الإرسال في <#${id}>.`);
        }
      }
    }
  }

  // 5) مراجع محذوفة في محتوى المستخدم
  for (const type of app.applications.listTypes(guild.id)) {
    if (type.review_channel_id && !resolve(type.review_channel_id, "channel")) {
      errors.push(`تقديم **${type.label}**: قناة المراجعة محذوفة.`);
    }
    if (type.accept_role_id) {
      const role = resolve(type.accept_role_id, "role");
      if (!role) errors.push(`تقديم **${type.label}**: رتبة القبول محذوفة.`);
      else if (role.position >= botPosition) warnings.push(`تقديم **${type.label}**: رتبة القبول أعلى من رتبة البوت.`);
    }
    if (!type.questions.length) warnings.push(`تقديم **${type.label}**: بلا أسئلة.`);
  }

  for (const type of app.ticketTypes.list(guild.id)) {
    if (type.category_id && !resolve(type.category_id, "channel")) {
      warnings.push(`نوع تذكرة **${type.label}**: الكاتيغوري محذوفة.`);
    }
  }

  for (const rule of app.autoReplies.listEnabled(guild.id)) {
    if (rule.embed_id && !app.embeds.get(rule.embed_id)) {
      errors.push(`رد تلقائي **${rule.name}**: الإمبيد المرتبط محذوف.`);
    }
  }

  for (const command of app.customCommands.list(guild.id)) {
    if (command.embed_id && !app.embeds.get(command.embed_id)) {
      errors.push(`أمر مخصص **${command.name}**: الإمبيد المرتبط محذوف.`);
    }
  }

  // 6) النوايا المميزة
  const intents = app.client.options?.intents;
  if (intents && typeof intents.has === "function") {
    if (!intents.has(1 << 1)) warnings.push("نية **Server Members** غير مفعّلة — الترحيب وتتبّع النشاط لن يعملا.");
    if (!intents.has(1 << 15)) warnings.push("نية **Message Content** غير مفعّلة — أوامر البريفكس والردود التلقائية لن تعمل.");
  }

  return { errors, warnings, ok, cfg };
}

module.exports = [
  {
    name: "فحص",
    aliases: ["checkup", "تشخيص"],
    description: "فحص شامل لإعدادات السيرفر: يكشف كل ما هو ناقص أو معطوب قبل ما يصير مشكلة.",
    usage: "checkup",
    arguments: [],
    examples: ["checkup", "/checkup"],
    category: "checkup",
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("فحص")
      .setDescription("فحص شامل لإعدادات السيرفر")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      await ctx.defer({ ephemeral: true });

      const { errors, warnings, ok } = runChecks(ctx.app, ctx.guild);

      const status = errors.length
        ? { icon: "🔴", text: "فيه مشاكل تمنع بعض الأنظمة من العمل", color: "danger" }
        : warnings.length
          ? { icon: "🟡", text: "يعمل، لكن فيه تحسينات مقترحة", color: "warning" }
          : { icon: "🟢", text: "كل شي سليم", color: "success" };

      const fields = [];
      if (errors.length) {
        fields.push({
          name: `🔴 أخطاء (${errors.length})`,
          value: truncate(errors.slice(0, 10).map((e) => `• ${e}`).join("\n"), 1024)
        });
      }
      if (warnings.length) {
        fields.push({
          name: `🟡 تنبيهات (${warnings.length})`,
          value: truncate(warnings.slice(0, 10).map((w) => `• ${w}`).join("\n"), 1024)
        });
      }
      if (ok.length) {
        fields.push({ name: `🟢 سليم (${ok.length})`, value: truncate(ok.map((o) => `• ${o}`).join("\n"), 1024) });
      }

      fields.push({
        name: "📦 المحتوى المحفوظ",
        value:
          `إمبيدات: \`${ctx.app.embeds.count(ctx.guild.id)}\` • ` +
          `أوامر مخصصة: \`${ctx.app.customCommands.count(ctx.guild.id)}\` • ` +
          `ردود تلقائية: \`${ctx.app.autoReplies.count(ctx.guild.id)}\`\n` +
          `أنواع تذاكر: \`${ctx.app.ticketTypes.count(ctx.guild.id)}\` • ` +
          `أنواع تقديم: \`${ctx.app.applications.countTypes(ctx.guild.id)}\``
      });

      return ctx.reply({
        embeds: [
          buildEmbed({
            title: `${status.icon} فحص السيرفر — ${status.text}`,
            description:
              errors.length || warnings.length
                ? "عالج الأخطاء الحمراء أولًا، فهي تمنع أنظمة من العمل فعليًا."
                : "كل الأنظمة المفعّلة لها ما تحتاجه.",
            color: ctx.color(status.color),
            fields,
            footer: `${ctx.guild.name} • ${ctx.app.registry.commands.size} أمر محمّل`
          })
        ]
      }, { ephemeral: true });
    }
  }
];

module.exports.runChecks = runChecks;
