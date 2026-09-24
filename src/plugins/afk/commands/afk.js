const { SlashCommandBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { parseDuration, formatDuration } = require("../../../core/utils/common");

module.exports = [
  {
    name: "afk",
    aliases: ["غياب", "away"],
    subAliases: { حالة: "set", القائمة: "list", ازالة: "clear", اعدادات: "settings" },
    defaultSubcommand: "set",
    description: "حالة الغياب: سبب ومدة، تُزال تلقائيًا عند كتابتك، وتنبّه من يمنشنك.",
    usage: "/afk set [reason] [duration] | !afk نايم",
    arguments: [
      { name: "set", required: false, description: "تفعيل الغياب بسبب ومدة اختيارية" },
      { name: "list", required: false, description: "الغائبون الآن" },
      { name: "clear", required: false, description: "إزالة غياب عضو (مشرف)" },
      { name: "settings", required: false, description: "إعدادات النظام (أدمن)" }
    ],
    examples: ["/afk set reason:اجتماع duration:1h", "!afk نايم", "!afk list"],
    category: "afk",
    cooldown: 5000,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("afk")
      .setDescription("حالة الغياب")
      .addSubcommand((s) => s.setName("set").setDescription("تفعيل الغياب")
        .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(200))
        .addStringOption((o) => o.setName("duration").setDescription("المدة (مثل 30m أو 2h) — تُزال بعدها تلقائيًا")))
      .addSubcommand((s) => s.setName("list").setDescription("الغائبون الآن"))
      .addSubcommand((s) => s.setName("clear").setDescription("إزالة غياب عضو (مشرف)")
        .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true)))
      .addSubcommand((s) => s.setName("settings").setDescription("إعدادات الغياب (أدمن)")
        .addBooleanOption((o) => o.setName("nickname").setDescription("إضافة بادئة للاسم"))
        .addStringOption((o) => o.setName("prefix").setDescription("البادئة").setMaxLength(12))
        .addChannelOption((o) => o.setName("ignore-channel").setDescription("تجاهل/إلغاء تجاهل قناة للتنبيهات"))),

    async execute(ctx) {
      const app = ctx.app;
      const sub = ctx.subcommand() || "set";
      const t = (k, v) => ctx.t(k, v);

      if (sub === "set") {
        let reason = ctx.isSlash ? ctx.interaction.options.getString("reason") : ctx.args.join(" ") || null;
        let durationRaw = ctx.isSlash ? ctx.interaction.options.getString("duration") : null;
        // بريفكس: "!afk 2h نايم" ← أول وسيط مدة إن كان صالحًا
        if (!ctx.isSlash && ctx.args[0] && /^\d+[a-zأ-ي]*$/i.test(ctx.args[0]) && parseDuration(ctx.args[0])) {
          durationRaw = ctx.args[0];
          reason = ctx.args.slice(1).join(" ") || null;
        }
        const durationMs = durationRaw ? parseDuration(durationRaw) : null;
        if (durationRaw && !durationMs) return ctx.fail("errors.invalidDuration");
        if (durationMs && durationMs > 30 * 86_400_000) return ctx.fail("errors.actionFailed", { details: t("afk.tooLong") });
        await app.afk.setAfk(ctx.member, { reason, durationMs });
        return ctx.reply({
          content: `💤 ${t("afk.set", { user: `<@${ctx.user.id}>` })}${reason ? `\n${t("afk.reasonLabel")}: ${reason}` : ""}${durationMs ? `\n${t("afk.durationLabel")}: ${formatDuration(durationMs)}` : ""}`,
          allowedMentions: { parse: [] }
        });
      }

      if (sub === "list") {
        const rows = app.afk.repo.list(ctx.guild.id, 25);
        return ctx.reply({
          embeds: [ctx.embed({
            title: `💤 ${t("afk.listTitle")}`,
            description: rows.map((r) => `<@${r.user_id}> — <t:${Math.floor(r.since / 1000)}:R>${r.reason ? ` — ${r.reason}` : ""} (${r.mentions} 🔔)`).join("\n") || t("ui.empty"),
            color: "neutral"
          })]
        }, { ephemeral: true });
      }

      const level = app.permissions.resolveLevel(ctx.member);
      if (sub === "clear") {
        if (level < Level.MODERATOR) return ctx.fail("errors.noPermission");
        const user = await ctx.getUser("user", 0);
        if (!user) return ctx.fail("errors.userNotFound");
        const removed = await app.afk.clear(ctx.guild, user.id, { reason: "moderator" });
        return removed ? ctx.success(t("afk.cleared", { user: `<@${user.id}>` })) : ctx.fail("errors.actionFailed", { details: t("afk.notAfk") });
      }

      if (sub === "settings") {
        if (level < Level.ADMIN) return ctx.fail("errors.noPermission");
        const o = ctx.isSlash ? ctx.interaction.options : null;
        const updates = {};
        if (o?.getBoolean("nickname") !== null && o?.getBoolean("nickname") !== undefined) updates["afk.setNickname"] = o.getBoolean("nickname");
        if (o?.getString("prefix")) updates["afk.nickPrefix"] = `${o.getString("prefix").trim()} `;
        const ch = o?.getChannel("ignore-channel");
        if (ch) {
          const set = new Set(app.afk.config(ctx.guild.id).ignoredChannels || []);
          if (set.has(ch.id)) set.delete(ch.id);
          else set.add(ch.id);
          updates["afk.ignoredChannels"] = [...set];
        }
        if (Object.keys(updates).length) app.guildConfig.setMany(ctx.guild.id, updates);
        const cfg = app.afk.config(ctx.guild.id);
        return ctx.reply({
          embeds: [ctx.embed({
            title: `⚙️ ${t("afk.settingsTitle")}`,
            color: "info",
            fields: [
              { name: t("afk.nickLabel"), value: cfg.setNickname ? `✅ \`${cfg.nickPrefix}\`` : "❌", inline: true },
              { name: t("afk.ignoredLabel"), value: (cfg.ignoredChannels || []).map((c) => `<#${c}>`).join(" ") || "—", inline: true }
            ]
          })]
        }, { ephemeral: true });
      }
      return ctx.fail("errors.actionFailed", { details: sub });
    }
  }
];
