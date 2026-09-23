const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { parseDuration, formatDuration } = require("../../../core/utils/helpers");

const SYSTEM = "moderation.enabled";

/** رد موحّد بعد نجاح أي عقوبة، مع رقم القضية. */
async function respond(ctx, messageKey, vars, record) {
  return ctx.success(
    `${ctx.t(messageKey, vars)}  •  ${ctx.t("common.caseNumber")} \`#${record.case_number}\``
  );
}

module.exports = [
  {
    name: "حظر",
    aliases: ["ban", "بان"],
    description: "حظر عضو من السيرفر نهائيًا مع تسجيل قضية.",
    usage: "ban <@عضو|آيدي> [السبب]",
    arguments: [
      { name: "عضو", required: true, description: "العضو المراد حظره (منشن أو آيدي)" },
      { name: "السبب", required: false, description: "سبب الحظر، يُسجَّل في القضية" }
    ],
    examples: ["ban @أحمد إعلانات مزعجة", "/ban user:@أحمد reason:مخالفة القوانين"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.BanMembers] },
    botPermissions: [PermissionFlagsBits.BanMembers],
    slash: new SlashCommandBuilder()
      .setName("حظر")
      .setDescription("حظر عضو من السيرفر")
      .addUserOption((o) => o.setName("user").setDescription("العضو المراد حظره").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("سبب الحظر"))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      const user = member ? member.user : await ctx.getUser("user", 0);
      if (!user) return ctx.fail("errors.userNotFound");

      const reason = ctx.getString("reason", 1, true);
      const result = await ctx.app.moderation.punish({
        type: "ban",
        guild: ctx.guild,
        executor: ctx.member,
        target: member,
        targetUser: user,
        reason
      });
      if (!result.ok) return ctx.fail(`errors.${result.reason}`, { details: result.details });
      return respond(ctx, "moderation.ban.success", { target: `<@${user.id}>` }, result.case);
    }
  },

  {
    name: "فك_حظر",
    aliases: ["unban", "الغاء_حظر"],
    description: "فك الحظر عن مستخدم محظور.",
    usage: "unban <آيدي>",
    arguments: [{ name: "آيدي", required: true, description: "آيدي المستخدم المحظور" }],
    examples: ["unban 123456789012345678"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.BanMembers] },
    botPermissions: [PermissionFlagsBits.BanMembers],
    slash: new SlashCommandBuilder()
      .setName("فك_حظر")
      .setDescription("فك الحظر عن مستخدم")
      .addStringOption((o) => o.setName("user").setDescription("آيدي المستخدم المحظور").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("سبب فك الحظر"))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(ctx) {
      const user = await ctx.getUser("user", 0);
      if (!user) return ctx.fail("errors.userNotFound");

      const ban = await ctx.guild.bans.fetch(user.id).catch(() => null);
      if (!ban) return ctx.reply({ content: `${ctx.emoji("error")} ${ctx.t("moderation.unban.notBanned")}` }, { ephemeral: true });

      const result = await ctx.app.moderation.punish({
        type: "unban",
        guild: ctx.guild,
        executor: ctx.member,
        targetUser: user,
        reason: ctx.getString("reason", 1, true)
      });
      if (!result.ok) return ctx.fail(`errors.${result.reason}`, { details: result.details });
      return respond(ctx, "moderation.unban.success", { target: `\`${user.tag}\`` }, result.case);
    }
  },

  {
    name: "طرد",
    aliases: ["kick", "كيك"],
    description: "طرد عضو من السيرفر.",
    usage: "kick <@عضو> [السبب]",
    arguments: [
      { name: "عضو", required: true, description: "العضو المراد طرده" },
      { name: "السبب", required: false, description: "سبب الطرد" }
    ],
    examples: ["kick @أحمد سلوك غير لائق"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.KickMembers] },
    botPermissions: [PermissionFlagsBits.KickMembers],
    slash: new SlashCommandBuilder()
      .setName("طرد")
      .setDescription("طرد عضو من السيرفر")
      .addUserOption((o) => o.setName("user").setDescription("العضو المراد طرده").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("سبب الطرد"))
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      if (!member) return ctx.fail("errors.memberNotFound");

      const result = await ctx.app.moderation.punish({
        type: "kick",
        guild: ctx.guild,
        executor: ctx.member,
        target: member,
        reason: ctx.getString("reason", 1, true)
      });
      if (!result.ok) return ctx.fail(`errors.${result.reason}`, { details: result.details });
      return respond(ctx, "moderation.kick.success", { target: `<@${member.id}>` }, result.case);
    }
  },

  {
    name: "اسكات",
    aliases: ["timeout", "ميوت", "mute"],
    description: "إسكات عضو لمدة محددة (Discord Timeout).",
    usage: "timeout <@عضو> <المدة> [السبب]",
    arguments: [
      { name: "عضو", required: true, description: "العضو المراد إسكاته" },
      { name: "المدة", required: true, description: "مثال: 10m أو 2h أو 7d (الحد الأقصى 28 يوم)" },
      { name: "السبب", required: false, description: "سبب الإسكات" }
    ],
    examples: ["timeout @أحمد 2h سبام", "/timeout user:@أحمد duration:30m"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.ModerateMembers] },
    botPermissions: [PermissionFlagsBits.ModerateMembers],
    slash: new SlashCommandBuilder()
      .setName("اسكات")
      .setDescription("إسكات عضو لمدة محددة")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .addStringOption((o) => o.setName("duration").setDescription("المدة، مثال: 10m أو 2h").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("السبب"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      if (!member) return ctx.fail("errors.memberNotFound");

      const durationMs = parseDuration(ctx.getString("duration", 1));
      if (!durationMs) return ctx.fail("errors.invalidDuration");

      const MAX = 28 * 86_400_000; // حد ديسكورد الأقصى
      if (durationMs > MAX) return ctx.fail("errors.invalidDuration");

      const result = await ctx.app.moderation.punish({
        type: "timeout",
        guild: ctx.guild,
        executor: ctx.member,
        target: member,
        durationMs,
        reason: ctx.getString("reason", 2, true)
      });
      if (!result.ok) return ctx.fail(`errors.${result.reason}`, { details: result.details });
      return respond(
        ctx,
        "moderation.timeout.success",
        { target: `<@${member.id}>`, duration: formatDuration(durationMs) },
        result.case
      );
    }
  },

  {
    name: "فك_اسكات",
    aliases: ["untimeout", "unmute"],
    description: "فك الإسكات عن عضو.",
    usage: "untimeout <@عضو> [السبب]",
    arguments: [{ name: "عضو", required: true, description: "العضو المُسكَت" }],
    examples: ["untimeout @أحمد"],
    category: "moderation",
    systemFlag: SYSTEM,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.ModerateMembers] },
    botPermissions: [PermissionFlagsBits.ModerateMembers],
    slash: new SlashCommandBuilder()
      .setName("فك_اسكات")
      .setDescription("فك الإسكات عن عضو")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("السبب"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      if (!member) return ctx.fail("errors.memberNotFound");

      const result = await ctx.app.moderation.punish({
        type: "untimeout",
        guild: ctx.guild,
        executor: ctx.member,
        target: member,
        reason: ctx.getString("reason", 1, true)
      });
      if (!result.ok) return ctx.fail(`errors.${result.reason}`, { details: result.details });
      return respond(ctx, "moderation.untimeout.success", { target: `<@${member.id}>` }, result.case);
    }
  }
];
