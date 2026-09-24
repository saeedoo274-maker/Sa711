const { SlashCommandBuilder, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { confirmRow, stamp } = require("../../../core/interactions/ui");
const { leaderboardPayload, rewardsPayload, statusPayload } = require("../views");

const periodChoices = [
  { name: "الكل", value: "all" },
  { name: "هذا الأسبوع", value: "weekly" },
  { name: "اليوم", value: "daily" },
  { name: "الصوت", value: "voice" },
  { name: "الرسائل", value: "messages" }
];

function isAdmin(ctx) {
  return ctx.app.permissions.resolveLevel(ctx.member) >= Level.ADMIN;
}

module.exports = [
  {
    name: "مستوى",
    aliases: ["level", "levels", "rank", "xp", "leaderboard", "lb", "top", "level-rewards", "مستويات", "رانك"],
    aliasRoutes: {
      rank: { sub: "rank" }, xp: { sub: "rank" }, "رانك": { sub: "rank" },
      levels: { sub: "top" }, leaderboard: { sub: "top" }, lb: { sub: "top" }, top: { sub: "top" }, "مستويات": { sub: "top" },
      "level-rewards": { sub: "rewards" }
    },
    subAliases: { رتبة: "rank", متصدرين: "top", مكافآت: "rewards", ادارة: "admin" },
    defaultSubcommand: "rank",
    description: "نظام المستويات: بطاقة الرتبة، المتصدرين، المكافآت، وإدارة الـXP.",
    usage: "/مستوى rank [user] | /مستوى top [period] | /مستوى admin ...",
    arguments: [
      { name: "rank", required: false, description: "بطاقة رتبتك أو رتبة عضو" },
      { name: "top", required: false, description: "لوحة المتصدرين (الكل/الأسبوع/اليوم/الصوت/الرسائل)" },
      { name: "rewards", required: false, description: "مكافآت المستويات" },
      { name: "admin", required: false, description: "إدارة XP والإعدادات (أدمن)" }
    ],
    examples: ["/مستوى rank", "!rank @عضو", "!top weekly", "/مستوى admin give user:@عضو amount:500"],
    category: "levels",
    cooldown: 3000,
    permissions: { level: Level.EVERYONE },
    // إعدادات النظام تعمل وهو معطّل حتى يمكن تفعيله منها
    featureExempt: (ctx) => ctx.subcommandGroup() === "admin" && ["settings", "status"].includes(ctx.subcommand()),
    slash: new SlashCommandBuilder()
      .setName("مستوى")
      .setDescription("نظام المستويات والخبرة")
      .addSubcommand((s) => s.setName("rank").setDescription("بطاقة الرتبة")
        .addUserOption((o) => o.setName("user").setDescription("العضو")))
      .addSubcommand((s) => s.setName("top").setDescription("لوحة المتصدرين")
        .addStringOption((o) => o.setName("period").setDescription("الفترة").addChoices(...periodChoices))
        .addIntegerOption((o) => o.setName("page").setDescription("الصفحة").setMinValue(1)))
      .addSubcommand((s) => s.setName("rewards").setDescription("مكافآت المستويات"))
      .addSubcommandGroup((g) => g.setName("admin").setDescription("إدارة المستويات (أدمن)")
        .addSubcommand((s) => s.setName("give").setDescription("إضافة XP")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("الكمية").setRequired(true).setMinValue(1).setMaxValue(10_000_000)))
        .addSubcommand((s) => s.setName("take").setDescription("خصم XP")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("الكمية").setRequired(true).setMinValue(1).setMaxValue(10_000_000)))
        .addSubcommand((s) => s.setName("set").setDescription("تعيين XP")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("القيمة").setRequired(true).setMinValue(0).setMaxValue(100_000_000)))
        .addSubcommand((s) => s.setName("reset").setDescription("تصفير XP عضو أو السيرفر كله")
          .addUserOption((o) => o.setName("user").setDescription("العضو (فارغ = الكل)")))
        .addSubcommand((s) => s.setName("transfer").setDescription("نقل XP بين عضوين")
          .addUserOption((o) => o.setName("from").setDescription("من").setRequired(true))
          .addUserOption((o) => o.setName("to").setDescription("إلى").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("الكمية").setRequired(true).setMinValue(1)))
        .addSubcommand((s) => s.setName("reward-add").setDescription("مكافأة مستوى")
          .addIntegerOption((o) => o.setName("level").setDescription("المستوى").setRequired(true).setMinValue(1).setMaxValue(1000))
          .addRoleOption((o) => o.setName("role").setDescription("رتبة"))
          .addIntegerOption((o) => o.setName("money").setDescription("مال").setMinValue(1)))
        .addSubcommand((s) => s.setName("reward-remove").setDescription("حذف مكافآت مستوى")
          .addIntegerOption((o) => o.setName("level").setDescription("المستوى").setRequired(true).setMinValue(1))
          .addRoleOption((o) => o.setName("role").setDescription("رتبة محددة فقط")))
        .addSubcommand((s) => s.setName("multiplier").setDescription("مضاعف XP لرتبة أو قناة (1 = إزالة)")
          .addNumberOption((o) => o.setName("value").setDescription("المضاعف").setRequired(true).setMinValue(0).setMaxValue(10))
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة"))
          .addChannelOption((o) => o.setName("channel").setDescription("القناة")))
        .addSubcommand((s) => s.setName("blacklist").setDescription("منع/سماح عضو بكسب XP")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(200)))
        .addSubcommand((s) => s.setName("ignore").setDescription("تجاهل قناة/رتبة أو حصر XP في قناة")
          .addStringOption((o) => o.setName("mode").setDescription("النوع").setRequired(true).addChoices(
            { name: "تجاهل قناة", value: "channel" }, { name: "تجاهل رتبة", value: "role" }, { name: "قناة XP حصرية", value: "only" }))
          .addChannelOption((o) => o.setName("channel").setDescription("القناة"))
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة")))
        .addSubcommand((s) => s.setName("settings").setDescription("إعدادات النظام")
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل النظام"))
          .addStringOption((o) => o.setName("levelup").setDescription("إعلان الترقية").addChoices(
            { name: "نفس القناة", value: "current" }, { name: "قناة محددة", value: "channel" }, { name: "الخاص", value: "dm" }, { name: "بلا إعلان", value: "off" }))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة الإعلان").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
          .addStringOption((o) => o.setName("message").setDescription("نص الإعلان (يدعم {USER} {LEVEL})").setMaxLength(500).setAutocomplete(true))
          .addIntegerOption((o) => o.setName("min-xp").setDescription("أقل XP للرسالة").setMinValue(0).setMaxValue(1000))
          .addIntegerOption((o) => o.setName("max-xp").setDescription("أعلى XP للرسالة").setMinValue(0).setMaxValue(1000))
          .addIntegerOption((o) => o.setName("cooldown").setDescription("التبريد بالثواني").setMinValue(0).setMaxValue(3600))
          .addIntegerOption((o) => o.setName("voice-xp").setDescription("XP لكل دقيقة صوت").setMinValue(0).setMaxValue(500))
          .addIntegerOption((o) => o.setName("daily-cap").setDescription("سقف يومي (0 = بلا)").setMinValue(0))
          .addBooleanOption((o) => o.setName("stack").setDescription("تكديس رتب المكافآت")))
        .addSubcommand((s) => s.setName("status").setDescription("عرض الإعدادات والإحصاءات"))),

    /** اقتراح المتغيرات أثناء كتابة نص الإعلان. */
    async autocomplete(interaction) {
      const { suggest } = require("../../../core/utils/variables");
      const typed = interaction.options.getFocused() || "";
      return interaction.respond(suggest(typed, 25).map((v) => ({ name: v.slice(0, 100), value: v.slice(0, 100) })));
    },

    async execute(ctx) {
      const app = ctx.app;
      const guild = ctx.guild;
      const group = ctx.subcommandGroup();
      const sub = ctx.subcommand() || "rank";

      if (!group) {
        if (sub === "rank") {
          const member = (await ctx.getMember("user", 0)) || ctx.member;
          if (member.user.bot) return ctx.fail("errors.botTarget");
          await ctx.defer();
          return ctx.reply(await app.levels.rankPayload(guild, member.user, member));
        }
        if (sub === "top") {
          const period = ctx.getString("period", 0) || "all";
          const page = ctx.getNumber("page", 1) || 1;
          return ctx.reply(leaderboardPayload(app, guild, { period, page, ownerId: ctx.user.id }));
        }
        if (sub === "rewards") return ctx.reply(rewardsPayload(app, guild));
      }

      // ---- الإدارة ----
      if (!isAdmin(ctx)) return ctx.fail("errors.noPermission");
      const t = (k, v) => ctx.t(k, v);

      if (sub === "status") return ctx.reply(statusPayload(app, guild), { ephemeral: true });

      if (["give", "take", "set"].includes(sub)) {
        const member = await ctx.getMember("user", 0);
        const amount = ctx.getNumber("amount", 1);
        if (!member) return ctx.fail("errors.memberNotFound");
        if (member.user.bot) return ctx.fail("errors.botTarget");
        if (amount === null || amount < 0) return ctx.fail("errors.invalidNumber");
        const result = sub === "set"
          ? app.levels.setXp(guild.id, member.id, amount, ctx.user.id)
          : app.levels.addXp(guild.id, member.id, sub === "give" ? amount : -amount, { reason: `admin:${sub}`, actorId: ctx.user.id });
        app.bus.emitSafe("levels:admin", { guildId: guild.id, userId: member.id, actorId: ctx.user.id, action: sub, amount });
        return ctx.success(t("xp.adjusted", { user: `<@${member.id}>`, xp: result.xp, level: result.newLevel }));
      }

      if (sub === "reset") {
        const member = await ctx.getMember("user", 0);
        if (member) {
          app.levels.repo.resetUser(guild.id, member.id, ctx.user.id);
          app.bus.emitSafe("levels:admin", { guildId: guild.id, userId: member.id, actorId: ctx.user.id, action: "reset" });
          return ctx.success(t("xp.resetUser", { user: `<@${member.id}>` }));
        }
        const s = stamp();
        return ctx.reply({
          content: `${ctx.emoji("warning")} ${t("xp.resetGuildConfirm", { count: app.levels.count(guild.id) })}`,
          components: [confirmRow(`lvl:reset:${ctx.user.id}:${s}:yes`, `lvl:reset:${ctx.user.id}:${s}:no`, { yes: t("xp.resetYes"), no: ctx.t("common.cancel") })]
        }, { ephemeral: true });
      }

      if (sub === "transfer") {
        const from = await ctx.getMember("from", 0);
        const to = await ctx.getMember("to", 1);
        const amount = ctx.getNumber("amount", 2);
        if (!from || !to) return ctx.fail("errors.memberNotFound");
        if (to.user.bot) return ctx.fail("errors.botTarget");
        const result = app.levels.transfer(guild.id, from.id, to.id, amount, ctx.user.id);
        if (!result.ok) return ctx.fail("errors.actionFailed", { details: t(`xp.transferError.${result.reason}`, { available: result.available ?? 0 }) });
        return ctx.success(t("xp.transferred", { amount, from: `<@${from.id}>`, to: `<@${to.id}>` }));
      }

      if (sub === "reward-add") {
        const level = ctx.getNumber("level", 0);
        const role = await ctx.getRole("role", 1);
        const money = ctx.isSlash ? ctx.interaction.options.getInteger("money") : ctx.getNumber("money", 2);
        if (!level || level < 1) return ctx.fail("errors.invalidNumber");
        if (!role && !(money > 0)) return ctx.fail("errors.actionFailed", { details: t("xp.rewardNeedsSomething") });
        if (role) {
          const me = guild.members.me;
          if (role.managed || (me && role.position >= me.roles.highest.position)) return ctx.fail("moderation.role.botCannotManage");
        }
        app.levels.repo.addReward(guild.id, { level, roleId: role?.id || null, money: money || 0 });
        return ctx.success(t("xp.rewardAdded", { level, reward: app.rewards.describe(guild.id, { roleId: role?.id, money }) }));
      }

      if (sub === "reward-remove") {
        const level = ctx.getNumber("level", 0);
        const role = await ctx.getRole("role", 1);
        const removed = app.levels.repo.removeRewards(guild.id, level, role?.id || null);
        return removed ? ctx.success(t("xp.rewardRemoved", { level, count: removed })) : ctx.fail("errors.actionFailed", { details: t("xp.noRewards") });
      }

      if (sub === "multiplier") {
        const value = ctx.isSlash ? ctx.interaction.options.getNumber("value") : parseFloat(ctx.args[0]);
        const role = await ctx.getRole("role", 1);
        const channel = role ? null : await ctx.getChannel("channel", 1);
        if (!Number.isFinite(value) || value < 0 || value > 10) return ctx.fail("errors.invalidNumber");
        if (!role && !channel) return ctx.fail("errors.actionFailed", { details: t("xp.needRoleOrChannel") });
        app.levels.repo.setMultiplier(guild.id, role ? "role" : "channel", (role || channel).id, value);
        app.levels.invalidate(guild.id);
        return ctx.success(t("xp.multiplierSet", { target: role ? `<@&${role.id}>` : `<#${channel.id}>`, value }));
      }

      if (sub === "blacklist") {
        const member = await ctx.getMember("user", 0);
        if (!member) return ctx.fail("errors.memberNotFound");
        const added = app.levels.repo.toggleBlacklist(guild.id, member.id, { reason: ctx.getString("reason", 1, true), actorId: ctx.user.id });
        app.levels.invalidate(guild.id);
        return ctx.success(t(added ? "xp.blacklisted" : "xp.unblacklisted", { user: `<@${member.id}>` }));
      }

      if (sub === "ignore") {
        const mode = ctx.getString("mode", 0);
        const key = { channel: "ignoredChannels", role: "ignoredRoles", only: "xpChannels" }[mode];
        if (!key) return ctx.fail("errors.actionFailed", { details: "channel | role | only" });
        const target = mode === "role" ? await ctx.getRole("role", 1) : await ctx.getChannel("channel", 1);
        if (!target) return ctx.fail(mode === "role" ? "errors.roleNotFound" : "errors.channelNotFound");
        const set = new Set(app.levels.config(guild.id)[key] || []);
        const added = !set.has(target.id);
        if (added) set.add(target.id);
        else set.delete(target.id);
        app.guildConfig.set(guild.id, `levels.${key}`, [...set]);
        return ctx.success(t(added ? "xp.listAdded" : "xp.listRemoved", { target: mode === "role" ? `<@&${target.id}>` : `<#${target.id}>`, list: t(`xp.list.${mode}`) }));
      }

      if (sub === "settings") {
        const o = ctx.isSlash ? ctx.interaction.options : null;
        if (!o) return ctx.reply(statusPayload(app, guild), { ephemeral: true });
        const updates = {};
        const enabled = o.getBoolean("enabled");
        const mode = o.getString("levelup");
        const channel = o.getChannel("channel");
        const message = o.getString("message");
        const min = o.getInteger("min-xp");
        const max = o.getInteger("max-xp");
        const cooldown = o.getInteger("cooldown");
        const voice = o.getInteger("voice-xp");
        const cap = o.getInteger("daily-cap");
        const stack = o.getBoolean("stack");
        if (mode) updates["levels.levelUp.mode"] = mode;
        if (channel) updates["levels.levelUp.channelId"] = channel.id;
        if (message) updates["levels.levelUp.message"] = message;
        if (min !== null) updates["levels.messageXpMin"] = min;
        if (max !== null) updates["levels.messageXpMax"] = max;
        if (cooldown !== null) updates["levels.cooldownMs"] = cooldown * 1000;
        if (voice !== null) updates["levels.voiceXpPerMinute"] = voice;
        if (cap !== null) updates["levels.dailyCap"] = cap;
        if (stack !== null) updates["levels.stackRewards"] = stack;
        const nextMin = min ?? app.levels.config(guild.id).messageXpMin;
        const nextMax = max ?? app.levels.config(guild.id).messageXpMax;
        if (nextMin > nextMax) return ctx.fail("errors.actionFailed", { details: t("xp.minMax") });
        if ((mode || app.levels.config(guild.id).levelUp?.mode) === "channel" && !(channel || app.levels.config(guild.id).levelUp?.channelId)) {
          return ctx.fail("errors.actionFailed", { details: t("xp.needChannel") });
        }
        if (Object.keys(updates).length) app.guildConfig.setMany(guild.id, updates);
        if (enabled !== null) app.features.setForGuild(guild.id, "levels", enabled);
        if (!Object.keys(updates).length && enabled === null) return ctx.reply(statusPayload(app, guild), { ephemeral: true });
        return ctx.reply(statusPayload(app, guild), { ephemeral: true });
      }

      return ctx.fail("errors.actionFailed", { details: sub });
    }
  }
];
