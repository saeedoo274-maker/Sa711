const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");

const { METRICS } = require("../../achievements/catalog");

const metricChoices = Object.keys(METRICS).map((m) => ({ name: m, value: m }));
const periodChoices = [
  { name: "اليوم", value: "today" }, { name: "7 أيام", value: "7d" }, { name: "30 يومًا", value: "30d" },
  { name: "90 يومًا", value: "90d" }, { name: "سنة", value: "year" }
];

/**
 * أمر الإدارة المتقدمة. كل أمر فرعي يفحص تفعيل نظامه بنفسه لأن /ادارة
 * يجمع أدوات أنظمة متعددة (تعطيل أحدها لا يجب أن يعطّل البقية).
 */
module.exports = [
  {
    name: "ادارة",
    aliases: ["admin", "manage"],
    description: "أدوات الإدارة المتقدمة: التحليلات وغيرها.",
    usage: "/ادارة analytics type:server period:30d",
    arguments: [{ name: "analytics", required: false, description: "تحليلات السيرفر أو الطاقم" }],
    examples: ["/ادارة analytics type:server period:7d", "/ادارة analytics type:staff period:30d"],
    category: "admin",
    slashOnly: true,
    cooldown: 3000,
    permissions: { level: Level.ADMIN },
    featureExempt: () => true,
    slash: new SlashCommandBuilder()
      .setName("ادارة")
      .setDescription("أدوات الإدارة المتقدمة")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((s) => s.setName("analytics").setDescription("التحليلات")
        .addStringOption((o) => o.setName("type").setDescription("النوع").addChoices({ name: "السيرفر", value: "server" }, { name: "الطاقم", value: "staff" }))
        .addStringOption((o) => o.setName("period").setDescription("الفترة").addChoices(...periodChoices)))
      .addSubcommand((s) => s.setName("reward").setDescription("منح مكافأة لعضو (فعالية)")
        .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
        .addIntegerOption((o) => o.setName("money").setDescription("مال").setMinValue(1))
        .addIntegerOption((o) => o.setName("xp").setDescription("XP").setMinValue(1))
        .addRoleOption((o) => o.setName("role").setDescription("رتبة"))
        .addStringOption((o) => o.setName("badge").setDescription("مفتاح شارة").setMaxLength(32))
        .addStringOption((o) => o.setName("reason").setDescription("السبب/الفعالية").setMaxLength(100)))
      .addSubcommand((s) => s.setName("badge").setDescription("إنشاء/تعديل شارة")
        .addStringOption((o) => o.setName("key").setDescription("المفتاح").setRequired(true).setMaxLength(32))
        .addStringOption((o) => o.setName("name").setDescription("الاسم").setRequired(true).setMaxLength(50))
        .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(40))
        .addStringOption((o) => o.setName("description").setDescription("الوصف").setMaxLength(150)))
      .addSubcommandGroup((g) => g.setName("achievement").setDescription("الإنجازات")
        .addSubcommand((s) => s.setName("create").setDescription("إنجاز مخصص")
          .addStringOption((o) => o.setName("key").setDescription("المفتاح").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("name").setDescription("الاسم").setRequired(true).setMaxLength(60))
          .addStringOption((o) => o.setName("metric").setDescription("المقياس").setRequired(true).addChoices(...metricChoices))
          .addIntegerOption((o) => o.setName("target").setDescription("الهدف").setRequired(true).setMinValue(1))
          .addIntegerOption((o) => o.setName("money").setDescription("مكافأة مال").setMinValue(0))
          .addIntegerOption((o) => o.setName("xp").setDescription("مكافأة XP").setMinValue(0))
          .addRoleOption((o) => o.setName("role").setDescription("مكافأة رتبة"))
          .addStringOption((o) => o.setName("badge").setDescription("مكافأة شارة").setMaxLength(32))
          .addBooleanOption((o) => o.setName("hidden").setDescription("مخفي حتى يُفتح"))
          .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(40)))
        .addSubcommand((s) => s.setName("toggle").setDescription("تفعيل/تعطيل إنجاز (مدمج أو مخصص)")
          .addStringOption((o) => o.setName("key").setDescription("المفتاح").setRequired(true).setAutocomplete(true))
          .addBooleanOption((o) => o.setName("enabled").setDescription("مفعّل").setRequired(true)))
        .addSubcommand((s) => s.setName("remove").setDescription("حذف إنجاز مخصص")
          .addStringOption((o) => o.setName("key").setDescription("المفتاح").setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName("announce").setDescription("قناة إعلان الإنجازات")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة"))
          .addBooleanOption((o) => o.setName("dm").setDescription("إشعار خاص")))),

    async autocomplete(interaction, app) {
      const typed = String(interaction.options.getFocused() || "").toLowerCase();
      const list = (app.achievements ? app.achievements.definitions(interaction.guild.id) : [])
        .concat(app.achievementsRepo ? app.achievementsRepo.custom(interaction.guild.id).filter((c) => !c.enabled) : [])
        .map((a) => ({ name: `${a.emoji || "🏅"} ${a.name} (${a.key})`.slice(0, 100), value: a.key }));
      return interaction.respond(list.filter((x) => x.name.toLowerCase().includes(typed)).slice(0, 25));
    },

    async execute(ctx) {
      const app = ctx.app;
      const sub = ctx.subcommand();
      const need = (feature) => (app.features.isEnabled(ctx.guild.id, feature) ? null : ctx.fail("errors.systemDisabled", { system: feature }));

      if (sub === "analytics") {
        const blocked = need("analytics");
        if (blocked) return blocked;
        await ctx.defer({ ephemeral: true });
        const type = ctx.interaction.options.getString("type") || "server";
        const period = ctx.interaction.options.getString("period") || (type === "staff" ? "30d" : "7d");
        return ctx.reply(type === "staff" ? app.analytics.staffPayload(ctx.guild, period) : app.analytics.serverPayload(ctx.guild, period), { ephemeral: true });
      }
      const o = ctx.interaction.options;
      const t = (k, v) => ctx.t(k, v);

      if (sub === "reward") {
        const blocked = need("rewards");
        if (blocked) return blocked;
        const user = o.getUser("user");
        const member = await ctx.guild.members.fetch(user.id).catch(() => null);
        const reward = { money: o.getInteger("money") || 0, xp: o.getInteger("xp") || 0, roleId: o.getRole("role")?.id || null, badge: o.getString("badge") || null };
        if (reward.badge && !app.rewardsRepo.badge(ctx.guild.id, reward.badge)) return ctx.fail("errors.actionFailed", { details: t("adm.unknownBadge", { key: reward.badge }) });
        const res = await app.rewards.grant(ctx.guild.id, user.id, reward, { source: "event", ref: o.getString("reason"), actorId: ctx.user.id, member });
        if (!res.ok) return ctx.fail("errors.actionFailed", { details: res.skipped.join(", ") || "—" });
        return ctx.success(t("adm.rewardGranted", { user: `<@${user.id}>`, reward: app.rewards.describe(ctx.guild.id, { ...reward, roleId: res.applied.roleId }) }) + (res.skipped.length ? `\n-# ${res.skipped.join(", ")}` : ""));
      }

      if (sub === "badge") {
        const key = o.getString("key").toLowerCase();
        if (!/^[a-z0-9_-]{2,32}$/.test(key)) return ctx.fail("errors.actionFailed", { details: t("adm.badKey") });
        const badge = app.rewardsRepo.upsertBadge(ctx.guild.id, { key, name: o.getString("name"), emoji: o.getString("emoji"), description: o.getString("description") });
        return ctx.success(t("adm.badgeSaved", { badge: `${badge.emoji || "🏅"} ${badge.name}` }));
      }

      if (ctx.subcommandGroup() === "achievement") {
        const blocked = need("achievements");
        if (blocked) return blocked;
        const key = o.getString("key")?.toLowerCase();
        if (sub === "create") {
          if (!/^[a-z0-9_-]{2,32}$/.test(key)) return ctx.fail("errors.actionFailed", { details: t("adm.badKey") });
          const metric = o.getString("metric");
          const reward = { money: o.getInteger("money") || 0, xp: o.getInteger("xp") || 0, roleId: o.getRole("role")?.id || null, badge: o.getString("badge") || null };
          app.achievementsRepo.upsert(ctx.guild.id, {
            key, name: o.getString("name"), emoji: o.getString("emoji"), metric, category: METRICS[metric].category,
            target: o.getInteger("target"), hidden: !!o.getBoolean("hidden"), reward
          });
          app.achievements.invalidate(ctx.guild.id);
          return ctx.success(t("adm.achievementSaved", { name: o.getString("name") }));
        }
        if (sub === "toggle") {
          const { BUILTINS } = require("../../achievements/catalog");
          const builtin = BUILTINS.find((b) => b.key === key);
          const custom = app.achievementsRepo.custom(ctx.guild.id).find((c) => c.key === key);
          const base = custom || builtin;
          if (!base) return ctx.fail("errors.actionFailed", { details: t("adm.unknownAchievement") });
          app.achievementsRepo.upsert(ctx.guild.id, { ...base, enabled: o.getBoolean("enabled") });
          app.achievements.invalidate(ctx.guild.id);
          return ctx.success(t("adm.achievementToggled", { name: base.name, state: o.getBoolean("enabled") ? "✅" : "❌" }));
        }
        if (sub === "remove") {
          const removed = app.achievementsRepo.remove(ctx.guild.id, key);
          app.achievements.invalidate(ctx.guild.id);
          return removed ? ctx.success(t("adm.achievementRemoved")) : ctx.fail("errors.actionFailed", { details: t("adm.unknownAchievement") });
        }
        if (sub === "announce") {
          const updates = {};
          if (o.getChannel("channel")) updates["achievements.announceChannelId"] = o.getChannel("channel").id;
          if (o.getBoolean("dm") !== null) updates["achievements.dm"] = o.getBoolean("dm");
          if (Object.keys(updates).length) app.guildConfig.setMany(ctx.guild.id, updates);
          return ctx.success(t("adm.saved"));
        }
      }

      return ctx.fail("errors.actionFailed", { details: sub || "?" });
    }
  }
];
