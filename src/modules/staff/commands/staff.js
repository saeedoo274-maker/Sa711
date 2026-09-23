const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const adminPanel = require("../interactions");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, formatDuration, timestamp } = require("../../../core/utils/helpers");

const REASONS = {
  noRanks: "لم يتم إعداد السلم الإداري بعد. استخدم `/staff-rank add`.",
  atTop: "العضو في أعلى رتبة بالسلم الإداري.",
  notStaff: "العضو ليس ضمن الطاقم الإداري.",
  botHierarchy: "رتبة البوت أقل من الرتبة المطلوبة — ارفعها فوقها.",
  hierarchy: "ما تقدر تتصرّف بعضو رتبته مثل رتبتك أو أعلى.",
  roleNotFound: "رتبة السلم محذوفة من السيرفر — راجع `/staff-rank list`.",
  noPermission: "ما عندك صلاحية لهذا الإجراء."
};

function failReason(ctx, result) {
  if (REASONS[result.reason]) return ctx.fail("errors.actionFailed", { details: REASONS[result.reason] });
  return ctx.fail(`errors.${result.reason}`, { details: result.details });
}

module.exports = [
  {
    name: "سلم_اداري",
    aliases: ["staff-rank"],
    description: "إدارة رتب السلم الإداري: إضافة، حذف، وعرض.",
    usage: "/staff-rank add role:<رتبة> name:<الاسم> level:<1-3>",
    arguments: [
      { name: "add", required: false, description: "إضافة رتبة إلى نهاية السلم" },
      { name: "remove", required: false, description: "حذف رتبة من السلم" },
      { name: "list", required: false, description: "عرض السلم الحالي" }
    ],
    examples: ["/staff-rank add role:@Moderator name:مشرف level:2", "/staff-rank list"],
    category: "staff",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("سلم_اداري")
      .setDescription("إدارة السلم الإداري")
      .addSubcommand((s) =>
        s
          .setName("add")
          .setDescription("إضافة رتبة للسلم")
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة").setRequired(true))
          .addStringOption((o) => o.setName("name").setDescription("اسم الرتبة في السلم").setRequired(true))
          .addIntegerOption((o) => o.setName("level").setDescription("مستوى الصلاحية 1-3").setMinValue(1).setMaxValue(3))
      )
      .addSubcommand((s) =>
        s
          .setName("remove")
          .setDescription("حذف رتبة من السلم")
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة").setRequired(true))
      )
      .addSubcommand((s) => s.setName("list").setDescription("عرض السلم الإداري"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();

      if (sub === "add") {
        const role = ctx.interaction.options.getRole("role");
        const name = ctx.interaction.options.getString("name");
        const level = ctx.interaction.options.getInteger("level") || 1;

        // منع ربط السلم برتبة أعلى من البوت، وإلا ستفشل كل ترقية لاحقًا
        if (role.position >= ctx.guild.members.me.roles.highest.position) {
          return ctx.fail("errors.actionFailed", { details: "رتبة البوت أقل من هذه الرتبة، ارفع رتبة البوت أولًا." });
        }

        const position = ctx.app.staff.add(ctx.guild.id, role.id, name, level);
        return ctx.success(`تمت إضافة **${name}** (<@&${role.id}>) في الموضع \`${position}\` بمستوى \`${level}\`.`);
      }

      if (sub === "remove") {
        const role = ctx.interaction.options.getRole("role");
        const removed = ctx.app.staff.remove(ctx.guild.id, role.id);
        if (!removed) return ctx.fail("errors.roleNotFound");
        return ctx.success(`تم حذف <@&${role.id}> من السلم الإداري.`);
      }

      const ranks = ctx.app.staff.list(ctx.guild.id);
      if (!ranks.length) return ctx.fail("errors.actionFailed", { details: REASONS.noRanks });

      return ctx.reply({
        embeds: [
          buildEmbed({
            title: `${ctx.emoji("staff")} السلم الإداري`,
            description: ranks.map((r) => `\`${r.position}.\` **${r.name}** — <@&${r.role_id}> (مستوى ${r.level})`).join("\n"),
            color: ctx.color("primary"),
            footer: "الترتيب من الأدنى إلى الأعلى"
          })
        ]
      });
    }
  },

  {
    name: "ترقية",
    aliases: ["promote"],
    description: "ترقية إداري إلى الرتبة التالية في السلم.",
    usage: "promote <@عضو>",
    arguments: [{ name: "عضو", required: true, description: "الإداري المراد ترقيته" }],
    examples: ["promote @أحمد"],
    category: "staff",
    permissions: { level: Level.ADMIN },
    botPermissions: [PermissionFlagsBits.ManageRoles],
    slash: new SlashCommandBuilder()
      .setName("ترقية")
      .setDescription("ترقية إداري")
      .addUserOption((o) => o.setName("user").setDescription("الإداري").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      if (!member) return ctx.fail("errors.memberNotFound");
      const result = await ctx.app.staffService.move(ctx.member, member, "up");
      if (!result.ok) return failReason(ctx, result);
      return ctx.success(`تمت ترقية <@${member.id}> من **${result.from?.name || "بدون رتبة"}** إلى **${result.to.name}**`);
    }
  },

  {
    name: "تنزيل",
    aliases: ["demote"],
    description: "تنزيل إداري إلى الرتبة السابقة في السلم.",
    usage: "demote <@عضو>",
    arguments: [{ name: "عضو", required: true, description: "الإداري المراد تنزيله" }],
    examples: ["demote @أحمد"],
    category: "staff",
    permissions: { level: Level.ADMIN },
    botPermissions: [PermissionFlagsBits.ManageRoles],
    slash: new SlashCommandBuilder()
      .setName("تنزيل")
      .setDescription("تنزيل إداري")
      .addUserOption((o) => o.setName("user").setDescription("الإداري").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      if (!member) return ctx.fail("errors.memberNotFound");
      const result = await ctx.app.staffService.move(ctx.member, member, "down");
      if (!result.ok) return failReason(ctx, result);
      return ctx.success(`تم تنزيل <@${member.id}> من **${result.from.name}** إلى **${result.to?.name || "خارج الطاقم"}**`);
    }
  },

  {
    name: "لوحة_الادارة",
    aliases: ["admin-panel", "لوحة-الادارة"],
    description: "نشر لوحة نظام الإدارة الدائمة في قناة — إمبيد بأزرار وقوائم يستخدمها كل الطاقم.",
    usage: "/لوحة_الادارة channel:<#قناة>",
    arguments: [{ name: "channel", required: true, description: "القناة التي تُنشر فيها اللوحة" }],
    examples: ["/لوحة_الادارة channel:#لوحة-الادارة"],
    category: "staff",
    permissions: { level: Level.ADMIN },
    slash: new SlashCommandBuilder()
      .setName("لوحة_الادارة")
      .setDescription("نشر لوحة نظام الإدارة الدائمة")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const channel = ctx.interaction.options.getChannel("channel");
      const me = ctx.guild.members.me;

      if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
        return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
      }

      const payload = adminPanel.build(ctx.app, ctx.guild);
      const message = await channel.send(payload).catch(() => null);
      if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر اللوحة." });

      // نحفظ موقعها لتُحدَّث تلقائيًا بعد أي ترقية أو تنزيل أو سحب
      ctx.app.guildConfig.setMany(ctx.guild.id, {
        "staff.panelChannelId": channel.id,
        "staff.panelMessageId": message.id
      });

      return ctx.success(
        `تم نشر لوحة الإدارة في <#${channel.id}>.\n` +
        "اللوحة دائمة ويستخدمها كل الطاقم، وكل رد يظهر لصاحبه وحده.\n" +
        "تتحدّث أرقامها تلقائيًا بعد أي ترقية أو تنزيل أو سحب."
      );
    }
  },

  {
    name: "سحب_اداري",
    aliases: ["dismiss", "سحب-اداري"],
    description: "سحب عضو من الطاقم كليًا — تُزال كل رتب السلم الإداري دفعة واحدة.",
    usage: "/سحب_اداري user:<@عضو> reason:<السبب>",
    arguments: [
      { name: "user", required: true, description: "العضو المراد سحبه" },
      { name: "reason", required: false, description: "سبب السحب" }
    ],
    examples: ["/سحب_اداري user:@أحمد reason:انتهاء الخدمة"],
    category: "staff",
    permissions: { level: Level.ADMIN },
    botPermissions: [PermissionFlagsBits.ManageRoles],
    slash: new SlashCommandBuilder()
      .setName("سحب_اداري")
      .setDescription("سحب عضو من الطاقم كليًا")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(300))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      if (!member) return ctx.fail("errors.memberNotFound");

      const reason = ctx.getString("reason");
      const result = await ctx.app.staffService.dismiss(ctx.member, member, reason);
      if (!result.ok) return failReason(ctx, result);

      return ctx.success(
        `تم سحب <@${member.id}> من الطاقم.\n` +
        `كان: **${result.from.name}** • أُزيلت \`${result.removed}\` رتبة.` +
        (reason ? `\nالسبب: ${reason}` : "")
      );
    }
  },

  {
    name: "نشاط_اداري",
    aliases: ["staff-info", "نشاط"],
    description: "عرض بيانات ونشاط إداري خلال آخر 30 يومًا.",
    usage: "staff-info <@عضو>",
    arguments: [{ name: "عضو", required: true, description: "الإداري" }],
    examples: ["staff-info @أحمد"],
    category: "staff",
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("نشاط_اداري")
      .setDescription("عرض نشاط إداري")
      .addUserOption((o) => o.setName("user").setDescription("الإداري").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      if (!member) return ctx.fail("errors.memberNotFound");

      const rank = ctx.app.staffService.currentRank(member);
      const activity = ctx.app.activity.summary(ctx.guild.id, member.id, 30);
      const level = ctx.app.permissions.resolveLevel(member);

      // النقاط مقياس واحد يجمع الرسائل والتذاكر والصوت والتقييمات
      const weights = ctx.app.guildConfig.value(ctx.guild.id, "staff.points") || {};
      const pts = ctx.app.activity.points(ctx.guild.id, member.id, 30, weights);
      const b = pts.breakdown;

      const fields = [
        { name: "الرتبة الحالية", value: rank ? `**${rank.name}**\n<@&${rank.role_id}>` : "ليس ضمن الطاقم", inline: true },
        { name: "المستوى", value: ctx.t(`levels.${level}`), inline: true },
        { name: "آخر نشاط", value: activity.last_active_at ? timestamp(activity.last_active_at, "R") : "—", inline: true },
        { name: "⭐ النقاط (30 يوم)", value: `**${pts.total}**`, inline: true },
        { name: "متوسط التقييم", value: pts.raw.ratingCount ? `${pts.raw.averageStars} من 5 (${pts.raw.ratingCount} تقييم)` : "—", inline: true },
        { name: "\u200b", value: "\u200b", inline: true },
        { name: "الرسائل (30 يوم)", value: `\`${activity.messages}\``, inline: true },
        { name: "رسائل اليوم", value: `\`${activity.today.messages}\``, inline: true },
        { name: "الوقت الصوتي", value: formatDuration(activity.voice_seconds * 1000), inline: true },
        { name: "تذاكر مستلمة", value: `\`${activity.tickets_claimed}\``, inline: true },
        { name: "تذاكر مغلقة", value: `\`${activity.tickets_closed}\``, inline: true },
        {
          name: "توزيع النقاط",
          value: `رسائل \`${b.messages}\` • استلام \`${b.claims}\` • إغلاق \`${b.closes}\` • صوت \`${b.voice}\` • تقييمات \`${b.ratings}\``
        }
      ];

      return ctx.reply({
        embeds: [
          buildEmbed({
            title: `${ctx.emoji("stats")} نشاط ${member.user.username}`,
            color: ctx.color("primary"),
            thumbnail: member.user.displayAvatarURL(),
            fields
          })
        ]
      });
    }
  },

  {
    name: "الاكثر_نشاطا",
    aliases: ["staff-top"],
    description: "لوحة صدارة نشاط الطاقم الإداري.",
    usage: "/staff-top metric:<المقياس> days:<الأيام>",
    arguments: [
      { name: "metric", required: false, description: "messages أو voice_seconds أو tickets_claimed" },
      { name: "days", required: false, description: "عدد الأيام (افتراضي 7)" }
    ],
    examples: ["/staff-top metric:messages days:30"],
    category: "staff",
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("الاكثر_نشاطا")
      .setDescription("لوحة صدارة نشاط الطاقم")
      .addStringOption((o) =>
        o
          .setName("metric")
          .setDescription("المقياس")
          .addChoices(
            { name: "الرسائل", value: "messages" },
            { name: "الوقت الصوتي", value: "voice_seconds" },
            { name: "التذاكر المستلمة", value: "tickets_claimed" },
            { name: "التذاكر المغلقة", value: "tickets_closed" },
            { name: "⭐ النقاط (الشامل)", value: "points" }
          )
      )
      .addIntegerOption((o) => o.setName("days").setDescription("عدد الأيام").setMinValue(1).setMaxValue(90))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(ctx) {
      const metric = ctx.getString("metric") || "messages";
      const days = ctx.getNumber("days") || 7;

      // النقاط تُحسب لا تُجمع من عمود واحد، فلها مسار خاص
      if (metric === "points") {
        const weights = ctx.app.guildConfig.value(ctx.guild.id, "staff.points") || {};
        const top = ctx.app.activity.pointsLeaderboard(ctx.guild.id, days, 10, weights);
        if (!top.length) return ctx.fail("errors.actionFailed", { details: "لا توجد بيانات نشاط بعد." });

        const medals = ["🥇", "🥈", "🥉"];
        return ctx.reply({
          embeds: [
            buildEmbed({
              title: `${ctx.emoji("stats")} صدارة النقاط — آخر ${days} يوم`,
              description: top
                .map((r, i) => {
                  const b = r.breakdown;
                  return `${medals[i] || `**${i + 1}.**`} <@${r.userId}> — **${r.total}** نقطة\n` +
                    `-# رسائل ${b.messages} • تذاكر ${b.claims + b.closes} • صوت ${b.voice} • تقييم ${b.ratings}`;
                })
                .join("\n"),
              color: ctx.color("primary"),
              footer: "النقاط تجمع الرسائل والتذاكر والصوت والتقييمات في مقياس واحد"
            })
          ]
        });
      }

      const rows = ctx.app.activity.leaderboard(ctx.guild.id, metric, days, 10);
      if (!rows.length) return ctx.fail("errors.actionFailed", { details: "لا توجد بيانات نشاط بعد." });

      const format = (v) => (metric === "voice_seconds" ? formatDuration(v * 1000) : `\`${v}\``);
      return ctx.reply({
        embeds: [
          buildEmbed({
            title: `${ctx.emoji("stats")} صدارة النشاط — آخر ${days} يوم`,
            description: rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${format(r.total)}`).join("\n"),
            color: ctx.color("primary")
          })
        ]
      });
    }
  }
];
