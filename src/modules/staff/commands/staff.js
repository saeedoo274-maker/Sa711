const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
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
    description: "إدارة رتب السلم الإداري، والأقسام، والمناوبات، والتقييمات، وملف الأداء (KPI).",
    usage: "/staff-rank add role:<رتبة> name:<الاسم> level:<1-3>",
    arguments: [
      { name: "add", required: false, description: "إضافة رتبة إلى نهاية السلم" },
      { name: "remove", required: false, description: "حذف رتبة من السلم" },
      { name: "list", required: false, description: "عرض السلم الحالي" },
      { name: "shift start/end/break/list", required: false, description: "المناوبات (للطاقم)" },
      { name: "department create/delete/assign/list", required: false, description: "الأقسام (الأدمن)" },
      { name: "evaluate / profile", required: false, description: "تقييم إداري وملف الأداء" }
    ],
    examples: ["/staff-rank add role:@Moderator name:مشرف level:2", "/staff-rank list", "/سلم_اداري shift start", "/سلم_اداري profile user:@أحمد"],
    category: "staff",
    slashOnly: true,
    // الأمر مفتوح للطاقم لأجل المناوبات؛ إدارة السلم والأقسام تُفحص لكل أمر فرعي (أدمن + Manage Guild)
    permissions: { level: Level.STAFF },
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
      .addSubcommand((s) => s.setName("evaluate").setDescription("تقييم إداري (مشرف فأعلى)")
        .addUserOption((o) => o.setName("user").setDescription("الإداري").setRequired(true))
        .addIntegerOption((o) => o.setName("score").setDescription("الدرجة 1-10").setRequired(true).setMinValue(1).setMaxValue(10))
        .addStringOption((o) => o.setName("notes").setDescription("ملاحظات").setMaxLength(500)))
      .addSubcommand((s) => s.setName("profile").setDescription("ملف الأداء (KPI)")
        .addUserOption((o) => o.setName("user").setDescription("الإداري"))
        .addIntegerOption((o) => o.setName("days").setDescription("الفترة بالأيام").setMinValue(1).setMaxValue(365)))
      .addSubcommandGroup((g) => g.setName("shift").setDescription("المناوبات")
        .addSubcommand((s) => s.setName("start").setDescription("بدء مناوبة"))
        .addSubcommand((s) => s.setName("end").setDescription("إنهاء مناوبة (أو إنهاء مناوبة إداري آخر — مشرف)")
          .addUserOption((o) => o.setName("user").setDescription("إداري آخر")))
        .addSubcommand((s) => s.setName("break").setDescription("بدء/إنهاء استراحة"))
        .addSubcommand((s) => s.setName("list").setDescription("من في المناوبة الآن")))
      .addSubcommandGroup((g) => g.setName("department").setDescription("الأقسام")
        .addSubcommand((s) => s.setName("create").setDescription("إنشاء قسم")
          .addStringOption((o) => o.setName("name").setDescription("الاسم").setRequired(true).setMaxLength(32))
          .addRoleOption((o) => o.setName("role").setDescription("رتبة القسم"))
          .addUserOption((o) => o.setName("lead").setDescription("رئيس القسم")))
        .addSubcommand((s) => s.setName("delete").setDescription("حذف قسم")
          .addStringOption((o) => o.setName("name").setDescription("الاسم").setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName("assign").setDescription("نقل إداري لقسم (فارغ = إخراج)")
          .addUserOption((o) => o.setName("user").setDescription("الإداري").setRequired(true))
          .addStringOption((o) => o.setName("name").setDescription("القسم").setAutocomplete(true)))
        .addSubcommand((s) => s.setName("list").setDescription("عرض الأقسام"))),

    async autocomplete(interaction, app) {
      const typed = String(interaction.options.getFocused() || "").toLowerCase();
      const rows = app.staffPlusRepo ? app.staffPlusRepo.departments(interaction.guild.id) : [];
      return interaction.respond(rows.filter((d) => d.name.toLowerCase().includes(typed)).slice(0, 25).map((d) => ({ name: d.name, value: d.name })));
    },

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const group = ctx.interaction.options.getSubcommandGroup(false);
      const level = ctx.app.permissions.resolveLevel(ctx.member);
      const isAdmin = level >= Level.ADMIN && (level >= Level.GUILD_OWNER || ctx.member.permissions.has(PermissionFlagsBits.ManageGuild));

      if (group || sub === "evaluate" || sub === "profile") return staffPlus(ctx, group, sub, level, isAdmin);
      if (sub !== "list" && !isAdmin) return ctx.fail("errors.noPermission");

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

async function staffPlus(ctx, group, sub, level, isAdmin) {
  const app = ctx.app;
  const svc = app.staffPlus;
  if (!svc || !app.features.isEnabled(ctx.guild.id, "staff")) return ctx.fail("errors.systemDisabled", { system: "staff-plus" });
  const o = ctx.interaction.options;
  const t = (k, v) => ctx.t(k, v);
  const done = (res, okText) => (res.ok ? ctx.success(okText) : ctx.fail("errors.actionFailed", { details: t(`stf.err.${res.reason}`) }));

  if (group === "shift") {
    if (sub === "list") return ctx.reply(svc.onShiftPayload(ctx.guild), { ephemeral: true });
    if (sub === "start") return done(svc.startShift(ctx.guild, ctx.member), t("stf.shiftStarted"));
    if (sub === "break") {
      const res = svc.toggleBreak(ctx.guild, ctx.member);
      return done(res, t(res.onBreak ? "stf.breakOn" : "stf.breakOff"));
    }
    // end
    const other = o.getUser("user");
    if (other && other.id !== ctx.user.id && level < Level.MODERATOR) return ctx.fail("errors.noPermission");
    const target = other ? await ctx.guild.members.fetch(other.id).catch(() => null) : ctx.member;
    if (!target) return ctx.fail("errors.memberNotFound");
    const res = svc.endShift(ctx.guild, target, ctx.user.id);
    return done(res, t("stf.shiftEnded", { time: res.ok ? formatDuration(res.workedMs) : "" }));
  }

  if (group === "department") {
    if (sub === "list") return ctx.reply(svc.departmentsPayload(ctx.guild), { ephemeral: true });
    if (!isAdmin) return ctx.fail("errors.noPermission");
    if (sub === "create") return done(await svc.createDepartment(ctx.guild, ctx.member, { name: o.getString("name"), role: o.getRole("role"), lead: o.getUser("lead") }), t("stf.saved"));
    if (sub === "delete") return done(svc.repo.deleteDepartment(ctx.guild.id, o.getString("name")) ? { ok: true } : { ok: false, reason: "notFound" }, t("stf.saved"));
    const member = await ctx.guild.members.fetch(o.getUser("user").id).catch(() => null);
    if (!member) return ctx.fail("errors.memberNotFound");
    return done(await svc.assignDepartment(ctx.guild, ctx.member, member, o.getString("name")), t("stf.saved"));
  }

  if (sub === "evaluate") {
    if (level < Level.MODERATOR) return ctx.fail("errors.noPermission");
    const member = await ctx.guild.members.fetch(o.getUser("user").id).catch(() => null);
    if (!member) return ctx.fail("errors.memberNotFound");
    return done(svc.evaluate(ctx.guild, ctx.member, member, o.getInteger("score"), o.getString("notes")), t("stf.saved"));
  }

  // profile: الإداري يرى ملفه، والمشرف فأعلى يرى ملفات غيره
  const user = o.getUser("user");
  if (user && user.id !== ctx.user.id && level < Level.MODERATOR) return ctx.fail("errors.noPermission");
  const member = user ? await ctx.guild.members.fetch(user.id).catch(() => null) : ctx.member;
  if (!member) return ctx.fail("errors.memberNotFound");
  return ctx.reply(svc.profilePayload(ctx.guild, member, o.getInteger("days") || 30), { ephemeral: true });
}
