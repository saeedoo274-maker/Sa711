const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, truncate } = require("../../../core/utils/helpers");

/**
 * نظام المساعدة يُولَّد بالكامل من البيانات الوصفية للأوامر.
 * إضافة أمر جديد تظهر هنا تلقائيًا بدون تعديل هذا الملف.
 */
const MODULE_LABELS = {
  moderation: { label: "الإدارة", emoji: "🛡️" },
  tickets: { label: "التذاكر", emoji: "🎫" },
  staff: { label: "السلم الإداري", emoji: "👥" },
  roles: { label: "الرتب", emoji: "🏷️" },
  security: { label: "الحماية", emoji: "🔐" },
  giveaways: { label: "السحوبات", emoji: "🎁" },
  polls: { label: "الاستطلاعات", emoji: "📊" },
  builder: { label: "بناء الإمبيدات والأوامر", emoji: "🎨" },
  economy: { label: "البنك والاقتصاد", emoji: "🏦" },
  violations: { label: "المخالفات", emoji: "⚠️" },
  flights: { label: "الطيران والحجز", emoji: "✈️" },
  applications: { label: "التقديمات", emoji: "📋" },
  quiz: { label: "اختبار التفعيل", emoji: "📝" },
  lifecycle: { label: "الإجازات والاستقالات والبلاغات", emoji: "🌴" },
  oversight: { label: "مراقبة السيرفرات والطوارئ", emoji: "🛡️" },
  checkup: { label: "الفحص الشامل", emoji: "🔍" },
  autoreply: { label: "الردود التلقائية", emoji: "💬" },
  starboard: { label: "لوحة النجوم", emoji: "⭐" },
  reports: { label: "التقارير الدورية", emoji: "📊" },
  evidence: { label: "توثيق العقوبات", emoji: "📁" },
  reactionreply: { label: "رد التفاعلات", emoji: "🎭" },
  featured: { label: "المنشورات المميّزة", emoji: "🌟" },
  devtools: { label: "أدوات المطور المتقدمة", emoji: "🔧" },
  broadcast: { label: "الإذاعة", emoji: "📢" },
  panel: { label: "لوحة التحكم", emoji: "⚙️" },
  help: { label: "المساعدة", emoji: "❓" },
  developer: { label: "المطور", emoji: "🧰" }
};

function overview(app, member) {
  const level = app.permissions.resolveLevel(member);
  const modules = [...app.registry.modules.keys()].filter((m) => {
    if (m === "developer" || m === "devtools" || m === "oversight") return level >= Level.DEVELOPER;
    return true;
  });

  const embed = buildEmbed({
    title: `${app.config.emoji("help")} مركز المساعدة`,
    description:
      `اختر نظامًا من القائمة بالأسفل لعرض أوامره وشرحها بالتفصيل.\n\n` +
      `**أنظمة الأوامر:**\n` +
      modules
        .map((m) => {
          const meta = MODULE_LABELS[m] || { label: m, emoji: "•" };
          return `${meta.emoji} **${meta.label}** — \`${app.registry.byModule(m).length}\` أمر`;
        })
        .join("\n") +
      `\n\n**طرق الاستدعاء:**\n` +
      "• أوامر Slash: `/اسم-الأمر`\n" +
      "• أوامر البريفكس: `!اسم-الأمر`\n" +
      "• الأوامر الإدارية الآن مجمّعة داخل `/لوحة` بدل أوامر منفصلة لكل إعداد.",
    color: app.config.color("primary"),
    footer: `مستواك: ${app.i18n.t(`levels.${level}`)} • إجمالي الأوامر: ${app.registry.commands.size}`
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("help:module")
    .setPlaceholder("اختر نظامًا لعرض أوامره")
    .addOptions(
      modules.slice(0, 25).map((m) => {
        const meta = MODULE_LABELS[m] || { label: m, emoji: "•" };
        return { label: meta.label, value: m, emoji: meta.emoji };
      })
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function moduleView(app, member, moduleName) {
  const commands = app.registry.byModule(moduleName);
  const meta = MODULE_LABELS[moduleName] || { label: moduleName, emoji: "•" };
  const level = app.permissions.resolveLevel(member);

  if (!commands.length) {
    return { embeds: [buildEmbed({ description: "لا توجد أوامر في هذا القسم.", color: app.config.color("neutral") })] };
  }

  const fields = commands.slice(0, 25).map((c) => {
    const required = c.permissions?.developerOnly ? Level.DEVELOPER : c.permissions?.level ?? Level.EVERYONE;
    const locked = level < required ? "🔒 " : "";
    const parts = [
      truncate(c.description, 200),
      `**الاستخدام:** \`${c.usage || c.name}\``
    ];
    if (c.aliases?.length) parts.push(`**بدائل:** ${c.aliases.map((a) => `\`${a}\``).join(" ")}`);
    if (c.examples?.length) parts.push(`**أمثلة:** ${c.examples.map((e) => `\`${e}\``).join(" • ")}`);
    parts.push(`**الصلاحية:** ${app.i18n.t(`levels.${required}`)}`);

    return { name: `${locked}${c.slashOnly ? "/" : ""}${c.name}`.slice(0, 256), value: truncate(parts.join("\n"), 1020) };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("help:module")
    .setPlaceholder("اختر نظامًا آخر")
    .addOptions(
      [...app.registry.modules.keys()]
        .filter((m) => (["developer", "devtools", "oversight"].includes(m) ? level >= Level.DEVELOPER : true))
        .slice(0, 25)
        .map((m) => {
          const mm = MODULE_LABELS[m] || { label: m, emoji: "•" };
          return { label: mm.label, value: m, emoji: mm.emoji };
        })
    );

  return {
    embeds: [
      buildEmbed({
        title: `${meta.emoji} ${meta.label}`,
        description: "🔒 يعني أن مستواك الحالي لا يسمح باستخدام هذا الأمر.",
        color: app.config.color("primary"),
        fields
      })
    ],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

module.exports = [
  {
    name: "مساعدة",
    aliases: ["help", "اوامر", "commands"],
    description: "مركز المساعدة: شرح كل الأنظمة والأوامر ومتغيراتها وصلاحياتها.",
    usage: "مساعدة [اسم الأمر]",
    arguments: [{ name: "command", required: false, description: "اسم أمر معيّن لعرض شرحه المفصّل" }],
    examples: ["مساعدة", "مساعدة حظر", "/مساعدة command:اسكات"],
    category: "help",
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("مساعدة")
      .setDescription("مركز المساعدة")
      .addStringOption((o) => o.setName("command").setDescription("اسم أمر معيّن")),

    async execute(ctx) {
      const name = ctx.getString("command", 0);
      if (!name) return ctx.reply(overview(ctx.app, ctx.member), { ephemeral: true });

      const command = ctx.app.registry.get(name);
      if (!command) return ctx.fail("errors.actionFailed", { details: `لا يوجد أمر باسم \`${name}\`` });

      const required = command.permissions?.developerOnly ? Level.DEVELOPER : command.permissions?.level ?? Level.EVERYONE;
      const fields = [
        { name: ctx.t("help.usage"), value: `\`${command.usage || command.name}\`` },
        { name: ctx.t("help.permission"), value: ctx.t(`levels.${required}`), inline: true },
        { name: ctx.t("help.cooldown"), value: `\`${(command.cooldown ?? ctx.app.config.bot.limits.defaultCooldownMs) / 1000}s\``, inline: true },
        { name: "النظام", value: MODULE_LABELS[command.module]?.label || command.module, inline: true }
      ];
      if (command.aliases?.length) fields.push({ name: ctx.t("help.aliases"), value: command.aliases.map((a) => `\`${a}\``).join(" ") });
      if (command.arguments?.length) {
        fields.push({
          name: ctx.t("help.arguments"),
          value: command.arguments.map((a) => `• \`${a.name}\`${a.required ? " *(مطلوب)*" : ""} — ${a.description}`).join("\n")
        });
      }
      if (command.examples?.length) fields.push({ name: ctx.t("help.examples"), value: command.examples.map((e) => `\`${e}\``).join("\n") });

      return ctx.reply({
        embeds: [buildEmbed({ title: `${ctx.emoji("help")} ${command.name}`, description: command.description, color: ctx.color("primary"), fields })]
      }, { ephemeral: true });
    }
  }
];

module.exports.overview = overview;
module.exports.moduleView = moduleView;
module.exports.MODULE_LABELS = MODULE_LABELS;
