const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { Events } = require("../../../core/events/EventBus");

const SYSTEM = "moderation.enabled";

module.exports = [
  {
    name: "مسح",
    aliases: ["clear", "حذف", "purge"],
    description: "حذف عدد من الرسائل الأخيرة في القناة.",
    usage: "clear <العدد> [@عضو]",
    arguments: [
      { name: "العدد", required: true, description: "من 1 إلى 100" },
      { name: "عضو", required: false, description: "حذف رسائل هذا العضو فقط" }
    ],
    examples: ["clear 50", "clear 100 @أحمد"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.ManageMessages] },
    botPermissions: [PermissionFlagsBits.ManageMessages],
    slash: new SlashCommandBuilder()
      .setName("مسح")
      .setDescription("حذف رسائل من القناة")
      .addIntegerOption((o) => o.setName("amount").setDescription("عدد الرسائل (1-100)").setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption((o) => o.setName("user").setDescription("حذف رسائل هذا العضو فقط"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(ctx) {
      const max = ctx.app.config.bot.limits.maxClearMessages;
      const amount = ctx.getNumber("amount", 0);
      if (!amount || amount < 1 || amount > max) return ctx.fail("errors.invalidNumber");

      const target = await ctx.getUser("user", 1);
      await ctx.defer({ ephemeral: true });

      // ديسكورد لا يحذف الرسائل الأقدم من 14 يومًا عبر bulkDelete
      const fetched = await ctx.channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!fetched) return ctx.fail("errors.actionFailed", { details: "تعذّر قراءة الرسائل" });

      const cutoff = Date.now() - 14 * 86_400_000;
      let messages = [...fetched.values()].filter((m) => m.createdTimestamp > cutoff);
      if (target) messages = messages.filter((m) => m.author.id === target.id);
      messages = messages.slice(0, amount);

      if (!messages.length) return ctx.fail("errors.actionFailed", { details: "لا توجد رسائل قابلة للحذف" });

      const deleted = await ctx.channel.bulkDelete(messages, true).catch(() => null);
      if (!deleted) return ctx.fail("errors.actionFailed", { details: "فشل الحذف الجماعي" });

      ctx.app.bus.emitSafe(Events.MESSAGES_CLEARED, {
        guild: ctx.guild,
        executor: ctx.member,
        channel: ctx.channel,
        target,
        details: `تم حذف ${deleted.size} رسالة`
      });

      return ctx.reply(
        { content: `${ctx.emoji("success")} ${ctx.t("moderation.clear.success", { count: deleted.size })}` },
        { ephemeral: true }
      );
    }
  },

  {
    name: "قفل",
    aliases: ["lock"],
    description: "قفل القناة ومنع الأعضاء من الكتابة فيها.",
    usage: "lock [#قناة] [السبب]",
    arguments: [{ name: "قناة", required: false, description: "القناة، أو الحالية إن تُركت فارغة" }],
    examples: ["lock", "lock #عام صيانة"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.ManageChannels] },
    botPermissions: [PermissionFlagsBits.ManageChannels],
    slash: new SlashCommandBuilder()
      .setName("قفل")
      .setDescription("قفل القناة")
      .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName("reason").setDescription("السبب"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(ctx) {
      const channel = (await ctx.getChannel("channel", 0)) || ctx.channel;
      const reason = ctx.getString("reason", 1, true);

      const everyone = ctx.guild.roles.everyone;
      const current = channel.permissionOverwrites.cache.get(everyone.id);
      if (current?.deny.has(PermissionFlagsBits.SendMessages)) {
        return ctx.fail("errors.actionFailed", { details: ctx.t("moderation.lock.already") });
      }

      await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason: `${ctx.user.tag}: ${reason || "-"}` });

      ctx.app.bus.emitSafe(Events.CHANNEL_LOCKED, { guild: ctx.guild, executor: ctx.member, channel, reason });
      return ctx.success(ctx.t("moderation.lock.success", { channel: `<#${channel.id}>` }));
    }
  },

  {
    name: "فتح",
    aliases: ["unlock"],
    description: "فتح قناة مقفلة.",
    usage: "unlock [#قناة]",
    arguments: [{ name: "قناة", required: false, description: "القناة، أو الحالية إن تُركت فارغة" }],
    examples: ["unlock", "unlock #عام"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.ManageChannels] },
    botPermissions: [PermissionFlagsBits.ManageChannels],
    slash: new SlashCommandBuilder()
      .setName("فتح")
      .setDescription("فتح قناة مقفلة")
      .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(ctx) {
      const channel = (await ctx.getChannel("channel", 0)) || ctx.channel;
      const everyone = ctx.guild.roles.everyone;
      const current = channel.permissionOverwrites.cache.get(everyone.id);
      if (!current?.deny.has(PermissionFlagsBits.SendMessages)) {
        return ctx.fail("errors.actionFailed", { details: ctx.t("moderation.unlock.already") });
      }

      // null يعيد الصلاحية للوضع الموروث بدل فرض السماح
      await channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason: ctx.user.tag });

      ctx.app.bus.emitSafe(Events.CHANNEL_UNLOCKED, { guild: ctx.guild, executor: ctx.member, channel });
      return ctx.success(ctx.t("moderation.unlock.success", { channel: `<#${channel.id}>` }));
    }
  },

  {
    name: "بطيء",
    aliases: ["slowmode", "تبريد"],
    description: "ضبط الوضع البطيء للقناة.",
    usage: "slowmode <الثواني> [#قناة]",
    arguments: [{ name: "الثواني", required: true, description: "من 0 (إيقاف) إلى 21600" }],
    examples: ["slowmode 10", "slowmode 0"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.ManageChannels] },
    botPermissions: [PermissionFlagsBits.ManageChannels],
    slash: new SlashCommandBuilder()
      .setName("بطيء")
      .setDescription("ضبط الوضع البطيء")
      .addIntegerOption((o) => o.setName("seconds").setDescription("عدد الثواني (0 للإيقاف)").setRequired(true).setMinValue(0).setMaxValue(21600))
      .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(ctx) {
      const seconds = ctx.getNumber("seconds", 0);
      if (seconds === null || seconds < 0 || seconds > 21600) return ctx.fail("errors.invalidNumber");

      const channel = (await ctx.getChannel("channel", 1)) || ctx.channel;
      await channel.setRateLimitPerUser(seconds, ctx.user.tag);

      ctx.app.bus.emitSafe(Events.SLOWMODE_SET, {
        guild: ctx.guild,
        executor: ctx.member,
        channel,
        details: `${seconds} ثانية`
      });

      return ctx.success(
        seconds === 0 ? ctx.t("moderation.slowmode.off") : ctx.t("moderation.slowmode.success", { seconds })
      );
    }
  }
];
