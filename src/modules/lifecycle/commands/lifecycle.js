const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, parseDuration, formatDuration, timestamp, truncate } = require("../../../core/utils/helpers");
const { KINDS, STATUS } = require("../LifecycleService");

/** يمنع تقديم طلب جديد قبل البت في السابق. */
async function guard(ctx, kind) {
  if (!ctx.app.lifecycleService.enabled(ctx.guild.id, kind)) {
    return { ok: false, message: `نظام ${KINDS[kind].label} معطّل في هذا السيرفر.` };
  }
  const pending = ctx.app.lifecycle.pendingFor(kind, ctx.guild.id, ctx.user.id);
  if (pending) return { ok: false, message: `عندك طلب ${KINDS[kind].label} قيد المراجعة برقم \`#${pending.number}\`.` };
  return { ok: true };
}

function historyEmbed(ctx, kind, user, rows) {
  if (!rows.length) {
    return buildEmbed({ description: `لا يوجد سجل ${KINDS[kind].label} لهذا العضو.`, color: ctx.color("neutral") });
  }
  return buildEmbed({
    title: `${KINDS[kind].emoji} سجل ${KINDS[kind].label} — ${user.username || user.id}`,
    description: rows
      .map((r) => {
        const st = STATUS[r.status] || STATUS.pending;
        const extra = r.duration_ms ? ` • ${formatDuration(r.duration_ms)}` : r.warning_level ? ` • تحذير ${r.warning_level}` : "";
        return `${st.icon} \`#${r.number}\` ${st.label}${extra}\n  ${timestamp(r.created_at, "R")}`;
      })
      .join("\n"),
    color: ctx.color("primary")
  });
}

module.exports = [
  {
    name: "اجازة",
    aliases: ["leave", "إجازة"],
    description: "طلب إجازة، وإنهاؤها، وعرض السجل. الرتب تُسحب عند القبول وتُستعاد عند الانتهاء.",
    usage: "/leave request duration:7d reason:سفر",
    arguments: [
      { name: "request", required: false, description: "تقديم طلب إجازة" },
      { name: "end", required: false, description: "إنهاء إجازتك مبكرًا" },
      { name: "list", required: false, description: "الإجازات السارية (للإدارة)" },
      { name: "history", required: false, description: "سجل إجازات عضو" }
    ],
    examples: ["/leave request duration:7d reason:ظروف دراسية", "/leave end", "/leave history user:@أحمد"],
    category: "lifecycle",
    slashOnly: true,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("اجازة")
      .setDescription("نظام الإجازات")
      .addSubcommand((s) =>
        s.setName("request").setDescription("تقديم طلب إجازة")
          .addStringOption((o) => o.setName("duration").setDescription("المدة مثل 7d أو 12h").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("سبب الإجازة").setMaxLength(500))
      )
      .addSubcommand((s) =>
        s.setName("end").setDescription("إنهاء الإجازة واستعادة الرتب")
          .addUserOption((o) => o.setName("user").setDescription("عضو آخر (للإدارة)"))
      )
      .addSubcommand((s) => s.setName("list").setDescription("الإجازات السارية"))
      .addSubcommand((s) =>
        s.setName("history").setDescription("سجل الإجازات")
          .addUserOption((o) => o.setName("user").setDescription("العضو"))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const level = ctx.app.permissions.resolveLevel(ctx.member);

      if (sub === "request") {
        const check = await guard(ctx, "leave");
        if (!check.ok) return ctx.fail("errors.actionFailed", { details: check.message });

        if (ctx.app.lifecycle.activeLeave(guildId, ctx.user.id)) {
          return ctx.fail("errors.actionFailed", { details: "أنت في إجازة سارية بالفعل." });
        }

        const durationMs = parseDuration(ctx.interaction.options.getString("duration"));
        if (!durationMs) return ctx.fail("errors.invalidDuration");

        const max = ctx.app.lifecycleService.config(guildId, "leave").maxDurationMs;
        if (max && durationMs > max) {
          return ctx.fail("errors.actionFailed", { details: `أقصى مدة مسموحة: ${formatDuration(max)}` });
        }

        const record = ctx.app.lifecycle.createLeave({
          guildId,
          userId: ctx.user.id,
          reason: ctx.interaction.options.getString("reason"),
          durationMs
        });
        const posted = await ctx.app.lifecycleService.publish(ctx.guild, "leave", record, ctx.user);

        return ctx.success(
          `تم إرسال طلب الإجازة برقم \`#${record.number}\` للمراجعة.` +
            (posted ? "" : `\n${ctx.emoji("warning")} لم تُحدَّد قناة طلبات الإجازة، فالطلب محفوظ لكنه غير منشور.`)
        );
      }

      if (sub === "end") {
        const target = ctx.interaction.options.getUser("user");
        if (target && target.id !== ctx.user.id && level < Level.MODERATOR) return ctx.fail("errors.noPermission");

        const userId = target?.id || ctx.user.id;
        const active = ctx.app.lifecycle.activeLeave(guildId, userId);
        if (!active) return ctx.fail("errors.actionFailed", { details: "ما فيه إجازة سارية." });

        await ctx.defer({ ephemeral: true });
        const result = await ctx.app.lifecycleService.endLeave({ guild: ctx.guild, record: active, actorId: ctx.user.id });
        if (!result.ok) return ctx.fail("errors.actionFailed", { details: "الإجازة منتهية بالفعل." });

        return ctx.reply(
          { content: `${ctx.emoji("success")} انتهت الإجازة \`#${active.number}\` واستُعيدت \`${result.restored}\` رتبة.` },
          { ephemeral: true }
        );
      }

      if (sub === "list") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");
        const rows = ctx.app.lifecycle.db
          .prepare("SELECT * FROM leave_requests WHERE guild_id = ? AND status = 'active' ORDER BY ends_at ASC LIMIT 20")
          .all(guildId);
        if (!rows.length) return ctx.success("ما فيه إجازات سارية حاليًا.");
        return ctx.reply({
          embeds: [
            buildEmbed({
              title: "🌴 الإجازات السارية",
              description: rows
                .map((r) => `\`#${r.number}\` <@${r.user_id}> — ${r.ends_at ? `تنتهي ${timestamp(r.ends_at, "R")}` : "بلا موعد"}`)
                .join("\n"),
              color: ctx.color("primary")
            })
          ]
        }, { ephemeral: true });
      }

      const user = ctx.interaction.options.getUser("user") || ctx.user;
      if (user.id !== ctx.user.id && level < Level.STAFF) return ctx.fail("errors.noPermission");
      return ctx.reply(
        { embeds: [historyEmbed(ctx, "leave", user, ctx.app.lifecycle.history("leave", guildId, user.id))] },
        { ephemeral: true }
      );
    }
  },

  {
    name: "استقالة",
    aliases: ["resign"],
    description: "تقديم استقالة من الطاقم الإداري. الرتب تُسحب بعد قبول الإدارة.",
    usage: "/resign request reason:<السبب>",
    arguments: [
      { name: "request", required: false, description: "تقديم استقالة" },
      { name: "history", required: false, description: "سجل الاستقالات" }
    ],
    examples: ["/resign request reason:ظروف شخصية"],
    category: "lifecycle",
    slashOnly: true,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("استقالة")
      .setDescription("نظام الاستقالات")
      .addSubcommand((s) =>
        s.setName("request").setDescription("تقديم استقالة")
          .addStringOption((o) => o.setName("reason").setDescription("سبب الاستقالة").setRequired(true).setMaxLength(500))
      )
      .addSubcommand((s) =>
        s.setName("history").setDescription("سجل الاستقالات")
          .addUserOption((o) => o.setName("user").setDescription("العضو"))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;

      if (sub === "request") {
        const check = await guard(ctx, "resign");
        if (!check.ok) return ctx.fail("errors.actionFailed", { details: check.message });

        const record = ctx.app.lifecycle.createResignation({
          guildId,
          userId: ctx.user.id,
          reason: ctx.interaction.options.getString("reason")
        });
        const posted = await ctx.app.lifecycleService.publish(ctx.guild, "resign", record, ctx.user);

        return ctx.success(
          `تم إرسال طلب الاستقالة برقم \`#${record.number}\` للمراجعة.` +
            (posted ? "" : `\n${ctx.emoji("warning")} لم تُحدَّد قناة طلبات الاستقالة.`)
        );
      }

      const level = ctx.app.permissions.resolveLevel(ctx.member);
      const user = ctx.interaction.options.getUser("user") || ctx.user;
      if (user.id !== ctx.user.id && level < Level.STAFF) return ctx.fail("errors.noPermission");
      return ctx.reply(
        { embeds: [historyEmbed(ctx, "resign", user, ctx.app.lifecycle.history("resign", guildId, user.id))] },
        { ephemeral: true }
      );
    }
  },

  {
    name: "بلاغ",
    aliases: ["report"],
    description: "رفع بلاغ على إداري مع الأدلة. التحذيرات تتصاعد تلقائيًا مع كل بلاغ مقبول.",
    usage: "/report admin user:@إداري reason:<السبب> evidence:<روابط>",
    arguments: [
      { name: "admin", required: false, description: "رفع بلاغ على إداري" },
      { name: "pending", required: false, description: "البلاغات المعلّقة (للإدارة)" },
      { name: "history", required: false, description: "سجل البلاغات على إداري" }
    ],
    examples: ["/report admin user:@أحمد reason:إساءة تصرف evidence:https://... متى:أمس"],
    category: "lifecycle",
    slashOnly: true,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("بلاغ")
      .setDescription("البلاغات على الإداريين")
      .addSubcommand((s) =>
        s.setName("admin").setDescription("رفع بلاغ على إداري")
          .addUserOption((o) => o.setName("user").setDescription("الإداري المُبلَّغ عنه").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("سبب البلاغ").setRequired(true).setMaxLength(1000))
          .addStringOption((o) => o.setName("evidence").setDescription("روابط الأدلة مفصولة بمسافة").setMaxLength(1500))
          .addStringOption((o) => o.setName("when").setDescription("متى حدثت الواقعة").setMaxLength(200))
          .addStringOption((o) => o.setName("place").setDescription("مكان الواقعة").setMaxLength(200))
          .addStringOption((o) => o.setName("witnesses").setDescription("الشهود").setMaxLength(500))
      )
      .addSubcommand((s) => s.setName("pending").setDescription("البلاغات المعلّقة"))
      .addSubcommand((s) =>
        s.setName("history").setDescription("سجل البلاغات على إداري")
          .addUserOption((o) => o.setName("user").setDescription("الإداري").setRequired(true))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const level = ctx.app.permissions.resolveLevel(ctx.member);

      if (sub === "pending") {
        if (level < Level.MODERATOR) return ctx.fail("errors.noPermission");
        const rows = ctx.app.lifecycle.listPending("report", guildId);
        if (!rows.length) return ctx.success("ما فيه بلاغات معلّقة. 🎉");
        return ctx.reply({
          embeds: [
            buildEmbed({
              title: "🚨 البلاغات المعلّقة",
              description: rows
                .map((r) => `\`#${r.number}\` <@${r.reporter_id}> ← <@${r.target_id}>\n  ${truncate(r.reason, 100)} • ${timestamp(r.created_at, "R")}`)
                .join("\n"),
              color: ctx.color("warning")
            })
          ]
        }, { ephemeral: true });
      }

      if (sub === "history") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");
        const user = ctx.interaction.options.getUser("user");
        const rows = ctx.app.lifecycle.history("report", guildId, user.id);
        const accepted = ctx.app.lifecycle.acceptedAgainst(guildId, user.id);
        const embed = historyEmbed(ctx, "report", user, rows);
        embed.addFields({ name: "البلاغات المقبولة", value: `\`${accepted}\``, inline: true });
        return ctx.reply({ embeds: [embed] }, { ephemeral: true });
      }

      const check = await guard(ctx, "report");
      if (!check.ok) return ctx.fail("errors.actionFailed", { details: check.message });

      const target = await ctx.getMember("user");
      if (!target) return ctx.fail("errors.memberNotFound");
      if (target.id === ctx.user.id) return ctx.fail("errors.actionFailed", { details: "ما تقدر تبلّغ على نفسك." });
      if (target.user.bot) return ctx.fail("errors.actionFailed", { details: "ما تقدر تبلّغ على بوت." });

      // مهلة بين البلاغات لمنع الإغراق
      const cfg = ctx.app.lifecycleService.config(guildId, "report");
      if (cfg.cooldownMs) {
        const last = ctx.app.lifecycle.lastReportBy(guildId, ctx.user.id);
        if (last && Date.now() - last.created_at < cfg.cooldownMs) {
          return ctx.fail("errors.actionFailed", {
            details: `تقدر ترفع بلاغًا جديدًا بعد ${formatDuration(cfg.cooldownMs - (Date.now() - last.created_at))}.`
          });
        }
      }

      // نقبل الروابط الآمنة فقط في الأدلة
      const evidence = (ctx.interaction.options.getString("evidence") || "")
        .split(/\s+/)
        .map((v) => v.trim())
        .filter((v) => /^https:\/\/\S+$/i.test(v))
        .slice(0, 10);

      const record = ctx.app.lifecycle.createReport({
        guildId,
        reporterId: ctx.user.id,
        targetId: target.id,
        reason: ctx.interaction.options.getString("reason"),
        incidentAt: ctx.interaction.options.getString("when"),
        place: ctx.interaction.options.getString("place"),
        witnesses: ctx.interaction.options.getString("witnesses"),
        evidence
      });
      const posted = await ctx.app.lifecycleService.publish(ctx.guild, "report", record, ctx.user);

      return ctx.reply(
        {
          content:
            `${ctx.emoji("success")} تم رفع البلاغ برقم \`#${record.number}\`` +
            (evidence.length ? ` مع \`${evidence.length}\` دليل.` : ".") +
            (posted ? "" : `\n${ctx.emoji("warning")} لم تُحدَّد قناة البلاغات.`)
        },
        { ephemeral: true }
      );
    }
  }
];
