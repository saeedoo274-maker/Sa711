const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, formatDuration, timestamp } = require("../../../core/utils/helpers");

const SYSTEM = "military.enabled";

module.exports = [
  {
    name: "عسكرية",
    aliases: ["military", "عسكري"],
    description: "النظام العسكري: نقاط العسكريين، مركز العمليات (الدوام)، والبلاغات.",
    usage: "/عسكرية نقاطي",
    arguments: [
      { name: "نقاطي", required: false, description: "عرض نقاطك" },
      { name: "كشف", required: false, description: "كشف نقاط العسكريين (الصدارة)" },
      { name: "نقطة-اضافة", required: false, description: "إضافة نقاط لعسكري" },
      { name: "نقطة-ازالة", required: false, description: "إزالة نقاط من عسكري" },
      { name: "تصفير-النقاط", required: false, description: "تصفير جميع النقاط" },
      { name: "مباشرين", required: false, description: "كشف العسكريين المباشرين" },
      { name: "دوامي", required: false, description: "سجل دوامك وإجمالي ساعاتك" },
      { name: "لوحة-عمليات", required: false, description: "نشر لوحة مركز العمليات" },
      { name: "لوحة-بلاغات", required: false, description: "نشر لوحة البلاغات" },
      { name: "بلاغات", required: false, description: "عرض البلاغات وإحصائياتها" },
      { name: "اعدادات", required: false, description: "ضبط الرتب والقنوات" }
    ],
    examples: [
      "/عسكرية نقاطي",
      "/عسكرية نقطة-اضافة user:@أحمد amount:10",
      "/عسكرية لوحة-عمليات channel:#مركز-العمليات",
      "/عسكرية اعدادات duty-role:@مباشر duty-log:#سجل-الدوام"
    ],
    category: "military",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("عسكرية")
      .setDescription("النظام العسكري")
      .addSubcommand((s) => s.setName("نقاطي").setDescription("عرض نقاطك"))
      .addSubcommand((s) => s.setName("كشف").setDescription("كشف نقاط العسكريين")
        .addUserOption((o) => o.setName("user").setDescription("عسكري محدد (اختياري)")))
      .addSubcommand((s) =>
        s.setName("نقطة-اضافة").setDescription("إضافة نقاط لعسكري")
          .addUserOption((o) => o.setName("user").setDescription("العسكري").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("عدد النقاط").setRequired(true).setMinValue(1).setMaxValue(10000))
          .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(300))
      )
      .addSubcommand((s) =>
        s.setName("نقطة-ازالة").setDescription("إزالة نقاط من عسكري")
          .addUserOption((o) => o.setName("user").setDescription("العسكري").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("عدد النقاط").setRequired(true).setMinValue(1).setMaxValue(10000))
          .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(300))
      )
      .addSubcommand((s) => s.setName("تصفير-النقاط").setDescription("تصفير جميع نقاط العسكريين"))
      .addSubcommand((s) => s.setName("مباشرين").setDescription("كشف العسكريين المباشرين"))
      .addSubcommand((s) => s.setName("ترقية").setDescription("استلام ترقيتك حسب نقاطك"))
      .addSubcommand((s) => s.setName("الرتب").setDescription("عرض سلّم الرتب بالنقاط"))
      .addSubcommand((s) =>
        s.setName("رتبة-اضافة").setDescription("إضافة رتبة لسلّم الترقيات")
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة").setRequired(true))
          .addIntegerOption((o) => o.setName("points").setDescription("النقاط المطلوبة").setRequired(true).setMinValue(0))
          .addStringOption((o) => o.setName("label").setDescription("اسم المرتبة").setMaxLength(60))
      )
      .addSubcommand((s) =>
        s.setName("رتبة-حذف").setDescription("حذف رتبة من السلّم")
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة").setRequired(true))
      )
      .addSubcommand((s) => s.setName("دوامي").setDescription("سجل دوامك")
        .addUserOption((o) => o.setName("user").setDescription("عسكري آخر (للإدارة)")))
      .addSubcommand((s) =>
        s.setName("لوحة-عمليات").setDescription("نشر لوحة مركز العمليات")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) =>
        s.setName("لوحة-بلاغات").setDescription("نشر لوحة البلاغات")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) => s.setName("بلاغات").setDescription("عرض البلاغات")
        .addStringOption((o) => o.setName("status").setDescription("الحالة")
          .addChoices({ name: "مفتوح", value: "open" }, { name: "قيد المعالجة", value: "claimed" }, { name: "مغلق", value: "closed" })))
      .addSubcommand((s) =>
        s.setName("اعدادات").setDescription("ضبط الرتب والقنوات")
          .addRoleOption((o) => o.setName("military-role").setDescription("الرتبة العسكرية (من يقدر يباشر)"))
          .addRoleOption((o) => o.setName("duty-role").setDescription("رتبة تُمنح أثناء الدوام"))
          .addChannelOption((o) => o.setName("duty-log").setDescription("قناة سجل الدخول والخروج").addChannelTypes(ChannelType.GuildText))
          .addChannelOption((o) => o.setName("reports").setDescription("قناة استقبال البلاغات").addChannelTypes(ChannelType.GuildText))
          .addRoleOption((o) => o.setName("report-ping").setDescription("رتبة تُمنشن عند بلاغ جديد"))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const svc = ctx.app.militaryService;
      const level = ctx.app.permissions.resolveLevel(ctx.member);

      // ---------- عرض للجميع ----------

      if (sub === "نقاطي") {
        const record = ctx.app.military.getPoints(guildId, ctx.user.id);
        return ctx.reply({ embeds: [svc.pointsEmbed(ctx.guild, ctx.user, record, { forSelf: true })] }, { ephemeral: true });
      }

      if (sub === "كشف") {
        const target = ctx.interaction.options.getUser("user");
        if (target) {
          const record = ctx.app.military.getPoints(guildId, target.id);
          return ctx.reply({ embeds: [svc.pointsEmbed(ctx.guild, target, record, { forSelf: false })] }, { ephemeral: true });
        }
        const rows = ctx.app.military.leaderboard(guildId, 15);
        return ctx.reply({ embeds: [svc.leaderboardEmbed(ctx.guild, rows)] });
      }

      if (sub === "مباشرين") {
        const shifts = ctx.app.military.activeShifts(guildId);
        return ctx.reply({ embeds: [svc.activeShiftsEmbed(ctx.guild, shifts)] }, { ephemeral: true });
      }

      if (sub === "دوامي") {
        const target = ctx.interaction.options.getUser("user");
        if (target && target.id !== ctx.user.id && level < Level.STAFF) return ctx.fail("errors.noPermission");
        const userId = target?.id || ctx.user.id;

        const week = ctx.app.military.totalDuty(guildId, userId, 7 * 86400000);
        const all = ctx.app.military.totalDuty(guildId, userId);
        const open = ctx.app.military.openShift(guildId, userId);
        const recent = ctx.app.military.recentShifts(guildId, userId, 5);

        return ctx.reply({
          embeds: [buildEmbed({
            title: "🎖️ سجل الدوام",
            description: `العسكري: <@${userId}>`,
            color: ctx.color("primary"),
            fields: [
              { name: "الحالة", value: open ? `🟢 مباشر منذ ${timestamp(open.started_at, "R")}` : "⚪ غير مباشر", inline: false },
              { name: "آخر 7 أيام", value: `${formatDuration(week.total)} • \`${week.shifts}\` نوبة`, inline: true },
              { name: "الإجمالي", value: `${formatDuration(all.total)} • \`${all.shifts}\` نوبة`, inline: true },
              { name: "النقاط", value: `\`${ctx.app.military.getPoints(guildId, userId).points}\``, inline: true },
              {
                name: "آخر النوبات",
                value: recent.length
                  ? recent.map((s) => `• ${timestamp(s.started_at, "f")} — ${s.ended_at ? formatDuration(s.duration_ms) : "**جارية**"}`).join("\n")
                  : "لا توجد نوبات بعد"
              }
            ]
          })]
        }, { ephemeral: true });
      }

      if (sub === "الرتب") {
        return ctx.reply({ embeds: [svc.ranksEmbed(ctx.guild, ctx.app.military.listRanks(guildId))] }, { ephemeral: true });
      }

      if (sub === "ترقية") {
        if (!svc.isMilitary(guildId, ctx.member)) {
          return ctx.fail("errors.actionFailed", { details: "الترقيات مخصصة للعسكريين." });
        }
        await ctx.defer({ ephemeral: true });
        const result = await svc.promote(ctx.guild, ctx.member);

        if (!result.ok) {
          const messages = {
            noRanks: "لم يُضبط سلّم الرتب بعد — راجع الإدارة.",
            notEnough: `نقاطك **${result.points}** ولا تكفي. أقرب رتبة **${result.nextLabel}** تحتاج **${result.needed}** نقطة.`,
            already: result.next
              ? `أنت في أعلى رتبة تستحقها. الرتبة التالية تحتاج **${result.next.points}** نقطة (نقاطك الآن ${ctx.app.military.getPoints(guildId, ctx.user.id).points}).`
              : "أنت في أعلى رتبة متاحة. 🎖️",
            roleMissing: "رتبة الترقية محذوفة — راجع الإدارة.",
            roleTooHigh: "رتبة البوت أقل من رتبة الترقية — ارفعها.",
            missingPermission: "البوت يفتقد صلاحية إدارة الرتب."
          };
          return ctx.fail("errors.actionFailed", { details: messages[result.reason] || "تعذّرت الترقية." });
        }

        return ctx.reply({
          embeds: [buildEmbed({
            title: "🎖️ ترقية",
            description:
              `مبروك <@${ctx.user.id}>!\n\n` +
              (result.previous ? `**${result.previous.label}** ← ` : "") +
              `**${result.rank.label}**\n\nنقاطك: \`${result.points}\``,
            color: ctx.color("success")
          })]
        });
      }

      // ---------- إدارة النقاط: للطاقم ----------

      if (sub === "نقطة-اضافة" || sub === "نقطة-ازالة") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");

        const target = ctx.interaction.options.getUser("user");
        if (target.bot) return ctx.fail("errors.actionFailed", { details: "البوتات ما لها نقاط." });

        const amount = ctx.interaction.options.getInteger("amount");
        const reason = ctx.interaction.options.getString("reason");
        const added = sub === "نقطة-اضافة";

        if (added) {
          ctx.app.military.addPoints({ guildId, userId: target.id, amount, actorId: ctx.user.id, reason });
        } else {
          ctx.app.military.removePoints({ guildId, userId: target.id, amount, actorId: ctx.user.id, reason });
        }

        return ctx.reply({
          embeds: [svc.pointsChangeEmbed(ctx.guild, { actorId: ctx.user.id, targetId: target.id, amount, added, reason })]
        });
      }

      if (sub === "تصفير-النقاط") {
        if (level < Level.ADMIN) return ctx.fail("errors.noPermission");
        const affected = ctx.app.military.resetAll(guildId, ctx.user.id);
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🧹 تصفير النقاط",
            description: `عزيزي المسؤول <@${ctx.user.id}>\n\nتم تصفير جميع النقاط بالكامل.\nعدد العسكريين المتأثرين: **${affected}**`,
            color: ctx.color("danger")
          })]
        });
      }

      if (sub === "بلاغات") {
        if (level < Level.STAFF && !svc.isMilitary(guildId, ctx.member)) return ctx.fail("errors.noPermission");
        const status = ctx.interaction.options.getString("status");
        const rows = ctx.app.military.listReports(guildId, { status, limit: 15 });
        const stats = ctx.app.military.reportStats(guildId);

        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه بلاغات مطابقة." });

        return ctx.reply({
          embeds: [buildEmbed({
            title: "🚨 البلاغات",
            description: rows
              .map((r) => {
                const icon = { open: "🟢", claimed: "🟡", closed: "🔴" }[r.status];
                return `${icon} **#${r.number}** ${r.kind} — <@${r.reporter_id}> • ${timestamp(r.created_at, "R")}`;
              })
              .join("\n"),
            color: ctx.color("primary"),
            fields: [
              { name: "مفتوح", value: `\`${stats.open}\``, inline: true },
              { name: "قيد المعالجة", value: `\`${stats.claimed}\``, inline: true },
              { name: "مغلق", value: `\`${stats.closed}\``, inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      // ---------- إعداد ونشر اللوحات: للأدمن ----------

      if (level < Level.ADMIN) return ctx.fail("errors.noPermission");

      if (sub === "رتبة-اضافة") {
        const role = ctx.interaction.options.getRole("role");
        const points = ctx.interaction.options.getInteger("points");
        const me2 = ctx.guild.members.me;
        if (role.managed || role.position >= me2.roles.highest.position) {
          return ctx.fail("errors.actionFailed", { details: `لا أستطيع إدارة <@&${role.id}> — ارفع رتبة البوت فوقها.` });
        }
        if (ctx.app.military.getRank(guildId, role.id)) {
          return ctx.fail("errors.actionFailed", { details: "هذه الرتبة موجودة في السلّم بالفعل." });
        }
        const rank = ctx.app.military.addRank({
          guildId, roleId: role.id, label: ctx.interaction.options.getString("label") || role.name, points
        });
        return ctx.success(`أُضيفت **${rank.label}** عند **${rank.points}** نقطة.\nالسلّم الآن: \`${ctx.app.military.listRanks(guildId).length}\` رتبة.`);
      }

      if (sub === "رتبة-حذف") {
        const role = ctx.interaction.options.getRole("role");
        if (!ctx.app.military.removeRank(guildId, role.id)) {
          return ctx.fail("errors.actionFailed", { details: "هذه الرتبة ليست في السلّم." });
        }
        return ctx.success(`حُذفت <@&${role.id}> من سلّم الترقيات.`);
      }

      if (sub === "اعدادات") {
        const updates = {};
        const militaryRole = ctx.interaction.options.getRole("military-role");
        const dutyRole = ctx.interaction.options.getRole("duty-role");
        const dutyLog = ctx.interaction.options.getChannel("duty-log");
        const reports = ctx.interaction.options.getChannel("reports");
        const reportPing = ctx.interaction.options.getRole("report-ping");

        const me = ctx.guild.members.me;
        if (dutyRole) {
          if (dutyRole.managed || dutyRole.position >= me.roles.highest.position) {
            return ctx.fail("errors.actionFailed", { details: `لا أستطيع إدارة <@&${dutyRole.id}> — ارفع رتبة البوت فوقها.` });
          }
          updates["military.dutyRoleId"] = dutyRole.id;
        }
        for (const [channel, key] of [[dutyLog, "military.dutyLogChannelId"], [reports, "military.reportChannelId"]]) {
          if (!channel) continue;
          if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
            return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
          }
          updates[key] = channel.id;
        }
        if (militaryRole) updates["military.roleId"] = militaryRole.id;
        if (reportPing) updates["military.reportPingRoleId"] = reportPing.id;

        if (!Object.keys(updates).length) {
          return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
        }

        ctx.app.guildConfig.setMany(guildId, updates);
        const cfg = svc.config(guildId);
        return ctx.reply({
          embeds: [buildEmbed({
            title: "⚙️ إعدادات النظام العسكري",
            color: ctx.color("success"),
            fields: [
              { name: "الرتبة العسكرية", value: cfg.roleId ? `<@&${cfg.roleId}>` : "الجميع", inline: true },
              { name: "رتبة الدوام", value: cfg.dutyRoleId ? `<@&${cfg.dutyRoleId}>` : "غير محددة", inline: true },
              { name: "سجل الدوام", value: cfg.dutyLogChannelId ? `<#${cfg.dutyLogChannelId}>` : "غير محددة", inline: true },
              { name: "قناة البلاغات", value: cfg.reportChannelId ? `<#${cfg.reportChannelId}>` : "غير محددة", inline: true },
              { name: "منشن البلاغات", value: cfg.reportPingRoleId ? `<@&${cfg.reportPingRoleId}>` : "بلا منشن", inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      // نشر اللوحات
      const channel = ctx.interaction.options.getChannel("channel");
      const me = ctx.guild.members.me;
      if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
        return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
      }

      if (sub === "لوحة-عمليات") {
        const payload = svc.operationsPanelPayload(guildId);
        const message = await channel.send(payload).catch(() => null);
        if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر اللوحة." });

        // نحفظ موقع اللوحة ليُحدَّث عدّاد المباشرين فيها تلقائيًا
        ctx.app.guildConfig.setMany(guildId, {
          "military.panelChannelId": channel.id,
          "military.panelMessageId": message.id
        });
        return ctx.success(`تم نشر لوحة مركز العمليات في <#${channel.id}>.`);
      }

      // لوحة-بلاغات
      const message = await channel.send(svc.reportsPanelPayload()).catch(() => null);
      if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر اللوحة." });
      return ctx.success(`تم نشر لوحة البلاغات في <#${channel.id}>.`);
    }
  }
];
