const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");

const RULES = {
  antiChannelCreate: "منع إنشاء القنوات الجماعي",
  antiChannelDelete: "منع حذف القنوات الجماعي",
  antiRoleCreate: "منع إنشاء الرتب الجماعي",
  antiRoleDelete: "منع حذف الرتب الجماعي",
  antiHighRoleGrant: "منع منح رتبة إدارية بغير صلاحية",
  antiPermissionEscalation: "منع تصعيد صلاحيات الرتب",
  antiBotAbuse: "مراقبة إساءة استخدام البوتات"
};

module.exports = [
  {
    name: "حماية",
    aliases: ["security"],
    description: "إدارة نظام الحماية وقواعده.",
    usage: "/security rule rule:<القاعدة> enabled:<true|false>",
    arguments: [
      { name: "toggle", required: false, description: "تفعيل أو تعطيل النظام كاملًا" },
      { name: "rule", required: false, description: "ضبط قاعدة معينة" },
      { name: "whitelist", required: false, description: "إضافة أو إزالة عضو من القائمة البيضاء" },
      { name: "status", required: false, description: "عرض حالة الحماية" }
    ],
    examples: ["/security toggle enabled:true", "/security rule rule:antiChannelDelete enabled:true threshold:2"],
    category: "security",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("حماية")
      .setDescription("إدارة نظام الحماية")
      .addSubcommand((s) =>
        s.setName("toggle").setDescription("تفعيل أو تعطيل نظام الحماية")
          .addBooleanOption((o) => o.setName("enabled").setDescription("مفعّل؟").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("rule").setDescription("ضبط قاعدة حماية")
          .addStringOption((o) =>
            o.setName("rule").setDescription("القاعدة").setRequired(true)
              .addChoices(...Object.entries(RULES).map(([value, name]) => ({ name, value })))
          )
          .addBooleanOption((o) => o.setName("enabled").setDescription("مفعّلة؟").setRequired(true))
          .addIntegerOption((o) => o.setName("threshold").setDescription("عدد الإجراءات المسموح").setMinValue(1).setMaxValue(50))
          .addIntegerOption((o) => o.setName("seconds").setDescription("النافذة الزمنية بالثواني").setMinValue(5).setMaxValue(600))
          .addStringOption((o) =>
            o.setName("action").setDescription("الإجراء الوقائي")
              .addChoices(
                { name: "سحب الرتب الإدارية", value: "removeRoles" },
                { name: "طرد", value: "kick" },
                { name: "حظر", value: "ban" },
                { name: "تنبيه فقط", value: "notify" }
              )
          )
      )
      .addSubcommand((s) =>
        s.setName("whitelist").setDescription("القائمة البيضاء")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addBooleanOption((o) => o.setName("add").setDescription("إضافة؟ (false للإزالة)").setRequired(true))
      )
      .addSubcommand((s) => s.setName("status").setDescription("عرض حالة الحماية"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;

      if (sub === "toggle") {
        const enabled = ctx.interaction.options.getBoolean("enabled");
        ctx.app.guildConfig.set(guildId, "security.enabled", enabled);
        if (enabled && !ctx.app.guildConfig.value(guildId, "logs.security")) {
          return ctx.success(`تم تفعيل نظام الحماية.\n${ctx.emoji("warning")} لم تُحدَّد قناة سجل الحماية بعد — حدّدها من \`/panel\` ← السجلات.`);
        }
        return ctx.success(`نظام الحماية الآن: **${enabled ? ctx.t("common.enabled") : ctx.t("common.disabled")}**`);
      }

      if (sub === "rule") {
        const rule = ctx.interaction.options.getString("rule");
        const enabled = ctx.interaction.options.getBoolean("enabled");
        const threshold = ctx.interaction.options.getInteger("threshold");
        const seconds = ctx.interaction.options.getInteger("seconds");
        const action = ctx.interaction.options.getString("action");

        const updates = { [`security.rules.${rule}.enabled`]: enabled };
        if (threshold) updates[`security.rules.${rule}.threshold`] = threshold;
        if (seconds) updates[`security.rules.${rule}.windowMs`] = seconds * 1000;
        if (action) updates[`security.rules.${rule}.action`] = action;
        ctx.app.guildConfig.setMany(guildId, updates);

        return ctx.success(`تم تحديث قاعدة **${RULES[rule]}**.`);
      }

      if (sub === "whitelist") {
        const user = ctx.interaction.options.getUser("user");
        const add = ctx.interaction.options.getBoolean("add");
        const list = new Set(ctx.app.guildConfig.value(guildId, "security.whitelist") || []);
        if (add) list.add(user.id);
        else list.delete(user.id);
        ctx.app.guildConfig.set(guildId, "security.whitelist", [...list]);
        return ctx.success(`${add ? "تمت إضافة" : "تمت إزالة"} <@${user.id}> ${add ? "إلى" : "من"} القائمة البيضاء.`);
      }

      const cfg = ctx.app.guildConfig.get(guildId);
      const lines = Object.entries(RULES).map(([key, label]) => {
        const r = cfg.security.rules?.[key] || {};
        const state = r.enabled ? "🟢" : "⚪";
        const extra = r.threshold ? ` — ${r.threshold} خلال ${Math.round((r.windowMs || 10000) / 1000)}ث → \`${r.action}\`` : ` — \`${r.action || "notify"}\``;
        return `${state} **${label}**${extra}`;
      });

      return ctx.reply({
        embeds: [
          buildEmbed({
            title: `${ctx.emoji("shield")} حالة نظام الحماية`,
            description: `الحالة العامة: **${cfg.security.enabled ? ctx.t("common.enabled") : ctx.t("common.disabled")}**\n\n${lines.join("\n")}`,
            color: cfg.security.enabled ? ctx.color("success") : ctx.color("neutral"),
            fields: [
              { name: "قناة سجل الحماية", value: cfg.logs.security ? `<#${cfg.logs.security}>` : "غير محددة", inline: true },
              { name: "القائمة البيضاء", value: (cfg.security.whitelist || []).map((id) => `<@${id}>`).join(" ") || "—", inline: true }
            ]
          })
        ]
      });
    }
  }
];
