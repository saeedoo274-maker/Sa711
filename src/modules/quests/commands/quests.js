const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, truncate, parseDuration, formatDuration } = require("../../../core/utils/helpers");

const SYSTEM = "quests.enabled";

module.exports = [
  {
    name: "مهام",
    aliases: ["quests", "quest"],
    description: "مهام الإدارة: تعريف، نشر، تعديل، وإحصاءات — مع تحقق آلي من الإنجاز.",
    usage: "/مهام نشر key:daily_messages channel:#المهام",
    arguments: [
      { name: "القائمة", required: false, description: "عرض كل المهام" },
      { name: "انشاء", required: false, description: "تعريف مهمة جديدة" },
      { name: "تعديل", required: false, description: "تعديل خاصية مهمة" },
      { name: "حذف", required: false, description: "حذف مهمة" },
      { name: "نشر", required: false, description: "نشر مهمة في قناة" },
      { name: "جاهزة", required: false, description: "زرع 20 مهمة جاهزة" },
      { name: "مهامي", required: false, description: "مهامك المستلمة" },
      { name: "الصدارة", required: false, description: "ترتيب منجزي المهام" },
      { name: "اعدادات", required: false, description: "ضبط النظام" }
    ],
    examples: [
      "/مهام جاهزة",
      "/مهام نشر key:daily_messages channel:#المهام",
      "/مهام تعديل key:daily_messages field:عدد المنفذين value:5"
    ],
    category: "quests",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("مهام")
      .setDescription("مهام الإدارة")
      .addSubcommand((s) =>
        s.setName("القائمة").setDescription("عرض كل المهام")
          .addStringOption((o) =>
            o.setName("kind").setDescription("النوع")
              .addChoices({ name: "يومية", value: "daily" }, { name: "أسبوعية", value: "weekly" }, { name: "خاصة", value: "special" })
          )
      )
      .addSubcommand((s) => s.setName("مهامي").setDescription("مهامك المستلمة وتقدّمك"))
      .addSubcommand((s) => s.setName("الصدارة").setDescription("ترتيب منجزي المهام"))
      .addSubcommand((s) =>
        s.setName("انشاء").setDescription("تعريف مهمة جديدة")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح إنجليزي").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("title").setDescription("عنوان المهمة").setRequired(true).setMaxLength(100))
          .addStringOption((o) =>
            o.setName("verify").setDescription("طريقة التحقق").setRequired(true)
              .addChoices(
                { name: "تصديق إداري", value: "manual" },
                { name: "عدد الرسائل", value: "messages" },
                { name: "دقائق الصوت", value: "voice_minutes" },
                { name: "تذاكر مستلمة", value: "tickets_claimed" },
                { name: "تذاكر مغلقة", value: "tickets_closed" },
                { name: "تقييمات مستلمة", value: "ratings" },
                { name: "مخالفات صادرة", value: "violations" },
                { name: "أيام حضور", value: "checkins" },
                { name: "نقاط النشاط", value: "points" }
              )
          )
          .addIntegerOption((o) => o.setName("target").setDescription("العدد المطلوب لإنجازها").setMinValue(1))
          .addIntegerOption((o) => o.setName("max-claims").setDescription("كم شخصًا ينفذها (0 = بلا حد)").setMinValue(0).setMaxValue(100))
          .addStringOption((o) => o.setName("description").setDescription("الوصف").setMaxLength(500))
          .addStringOption((o) =>
            o.setName("kind").setDescription("النوع")
              .addChoices({ name: "يومية", value: "daily" }, { name: "أسبوعية", value: "weekly" }, { name: "خاصة", value: "special" })
          )
          .addStringOption((o) =>
            o.setName("difficulty").setDescription("الصعوبة")
              .addChoices({ name: "سهلة", value: "easy" }, { name: "متوسطة", value: "normal" }, { name: "صعبة", value: "hard" }, { name: "نخبة", value: "elite" })
          )
          .addIntegerOption((o) => o.setName("points").setDescription("نقاط المكافأة").setMinValue(0))
          .addIntegerOption((o) => o.setName("money").setDescription("مكافأة مالية").setMinValue(0))
          .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(32))
          .addStringOption((o) => o.setName("timeout").setDescription("مهلة الإنجاز مثل 1h").setMaxLength(20))
      )
      .addSubcommand((s) =>
        s.setName("تعديل").setDescription("تعديل مهمة")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح المهمة").setRequired(true).setAutocomplete(true))
          .addStringOption((o) =>
            o.setName("field").setDescription("الحقل").setRequired(true)
              .addChoices(
                { name: "العنوان", value: "title" },
                { name: "الوصف", value: "description" },
                { name: "عدد المنفذين", value: "max_claims" },
                { name: "العدد المطلوب", value: "verify_target" },
                { name: "طريقة التحقق", value: "verify_type" },
                { name: "النوع", value: "kind" },
                { name: "الصعوبة", value: "difficulty" },
                { name: "نقاط المكافأة", value: "reward_points" },
                { name: "مكافأة مالية", value: "reward_money" },
                { name: "الإيموجي", value: "emoji" },
                { name: "المهلة (ms)", value: "timeout_ms" },
                { name: "مفعّلة", value: "enabled" }
              )
          )
          .addStringOption((o) => o.setName("value").setDescription("القيمة الجديدة").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("حذف").setDescription("حذف مهمة")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح المهمة").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((s) =>
        s.setName("نشر").setDescription("نشر مهمة في قناة")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح المهمة").setRequired(true).setAutocomplete(true))
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) => o.setName("closes").setDescription("تُغلق بعد مثل 24h").setMaxLength(20))
      )
      .addSubcommand((s) => s.setName("جاهزة").setDescription("زرع 20 مهمة جاهزة قابلة للقياس الآلي"))
      .addSubcommand((s) =>
        s.setName("اعدادات").setDescription("ضبط النظام")
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل النظام"))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة النشر الافتراضية").addChannelTypes(ChannelType.GuildText))
          .addChannelOption((o) => o.setName("review").setDescription("قناة مراجعة المهام اليدوية").addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) => o.setName("timeout").setDescription("المهلة الافتراضية مثل 1h").setMaxLength(20))
      ),

    async autocomplete(interaction, app) {
      const term = String(interaction.options.getFocused() || "").toLowerCase();
      const rows = app.quests.list(interaction.guild.id, { enabledOnly: false })
        .filter((q) => q.key.toLowerCase().includes(term) || q.title.toLowerCase().includes(term))
        .slice(0, 25);
      return interaction.respond(rows.map((q) => ({ name: truncate(`${q.title} (${q.key})`, 100), value: q.key })));
    },

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const app = ctx.app;
      const svc = app.questService;
      const level = app.permissions.resolveLevel(ctx.member);
      const opt = (n) => ctx.interaction.options.getString(n);

      // ---------- متاح للجميع ----------
      if (sub === "مهامي") {
        const rows = app.quests.activeClaims(guildId, ctx.user.id);
        const stats = app.quests.userStats(guildId, ctx.user.id, 30);
        return ctx.reply({
          embeds: [buildEmbed({
            title: "📋 مهامي",
            description: rows.length
              ? rows.map((c) => {
                  const quest = app.quests.getById(c.quest_id);
                  const m = svc.measure(quest, c);
                  return `${c.emoji || "•"} **${c.title}**\n-# ${m.measurable ? `${m.done}/${m.target} ${m.unit}` : "بانتظار التصديق"}`;
                }).join("\n\n")
              : "ما عندك مهام مستلمة.",
            color: ctx.color("primary"),
            fields: [
              { name: "أُنجزت (30 يوم)", value: `\`${stats.completed}\``, inline: true },
              { name: "النقاط", value: `\`${stats.points}\``, inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      if (sub === "الصدارة") {
        const top = app.quests.leaderboard(guildId, 30, 10);
        const medals = ["🥇", "🥈", "🥉"];
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🏅 صدارة المهام — آخر 30 يومًا",
            description: top.length
              ? top.map((r, i) => `${medals[i] || `**${i + 1}.**`} <@${r.user_id}> — **${r.points}** نقطة (${r.completed} مهمة)`).join("\n")
              : "لا توجد إنجازات بعد.",
            color: ctx.color("primary")
          })]
        });
      }

      if (sub === "القائمة") {
        const kind = opt("kind");
        const rows = app.quests.list(guildId, { kind, enabledOnly: false });
        if (!rows.length) {
          return ctx.fail("errors.actionFailed", { details: "ما فيه مهام بعد. جرّب `/مهام جاهزة`." });
        }
        const byKind = {};
        for (const q of rows) (byKind[q.kind] ||= []).push(q);

        const names = { daily: "☀️ يومية", weekly: "📅 أسبوعية", special: "✨ خاصة" };
        return ctx.reply({
          embeds: [buildEmbed({
            title: "📋 مهام الإدارة",
            color: ctx.color("primary"),
            fields: Object.entries(byKind).map(([k, list]) => ({
              name: `${names[k] || k} (${list.length})`,
              value: truncate(
                list.map((q) => {
                  const v = svc.verifier(q.verify_type);
                  const cap = q.max_claims > 0 ? `${q.max_claims} شخص` : "بلا حد";
                  return `${q.enabled ? "" : "⚪ "}${q.emoji || "•"} **${q.title}** \`${q.key}\`\n` +
                    `-# ${v.measurable ? `${v.label}: ${q.verify_target}` : "تصديق إداري"} • ${cap}` +
                    (q.reward_points ? ` • ⭐${q.reward_points}` : "");
                }).join("\n"),
                1000
              )
            }))
          })]
        }, { ephemeral: true });
      }

      // ---------- إداري ----------
      if (level < Level.ADMIN) return ctx.fail("errors.noPermission");

      if (sub === "جاهزة") {
        const res = svc.seed(guildId, ctx.user.id);
        return ctx.success(
          `تم زرع **${res.added}** مهمة جاهزة${res.skipped ? ` (تُخطّيت ${res.skipped} موجودة مسبقًا)` : ""}.\n` +
          "أغلبها **قابل للقياس الآلي** — البوت يتحقق بنفسه من إنجازها.\n" +
          "اعرضها بـ `/مهام القائمة` وانشرها بـ `/مهام نشر`."
        );
      }

      if (sub === "انشاء") {
        const key = opt("key").trim().toLowerCase();
        if (!/^[a-z0-9_]{2,32}$/.test(key)) {
          return ctx.fail("errors.actionFailed", { details: "المفتاح: حروف إنجليزية صغيرة وأرقام وشرطة سفلية، 2-32." });
        }
        if (app.quests.get(guildId, key)) {
          return ctx.fail("errors.actionFailed", { details: `المهمة \`${key}\` موجودة بالفعل.` });
        }

        const quest = app.quests.create({
          guildId, key,
          title: opt("title"),
          description: opt("description"),
          kind: opt("kind") || "daily",
          verifyType: opt("verify"),
          verifyTarget: ctx.interaction.options.getInteger("target") ?? 1,
          maxClaims: ctx.interaction.options.getInteger("max-claims") ?? 1,
          rewardPoints: ctx.interaction.options.getInteger("points") ?? 0,
          rewardMoney: ctx.interaction.options.getInteger("money") ?? 0,
          difficulty: opt("difficulty") || "normal",
          emoji: opt("emoji"),
          timeoutMs: opt("timeout") ? parseDuration(opt("timeout")) : null,
          createdBy: ctx.user.id
        });

        const v = svc.verifier(quest.verify_type);
        return ctx.success(
          `تم تعريف **${quest.title}** (\`${quest.key}\`)\n` +
          `التحقق: ${v.measurable ? `${v.label} — ${quest.verify_target} ${v.unit}` : "تصديق إداري"}\n` +
          `المنفذون: ${quest.max_claims > 0 ? quest.max_claims : "بلا حد"}`
        );
      }

      if (sub === "تعديل") {
        const key = opt("key").trim();
        const field = opt("field");
        let value = opt("value").trim();

        if (!app.quests.get(guildId, key)) {
          return ctx.fail("errors.actionFailed", { details: "المهمة غير موجودة." });
        }

        const numeric = ["max_claims", "verify_target", "reward_points", "reward_money", "timeout_ms"];
        if (numeric.includes(field)) {
          const n = field === "timeout_ms" && /[a-z]/i.test(value) ? parseDuration(value) : parseInt(value, 10);
          if (isNaN(n) || n < 0) return ctx.fail("errors.actionFailed", { details: "القيمة لازم تكون رقمًا موجبًا (أو مدة مثل 1h)." });
          value = n;
        } else if (field === "enabled") {
          value = ["نعم", "yes", "true", "1"].includes(value.toLowerCase()) ? 1 : 0;
        } else if (field === "verify_type" && !svc.verifier(value).label) {
          return ctx.fail("errors.actionFailed", { details: "طريقة تحقق غير معروفة." });
        }

        try {
          const updated = app.quests.update(guildId, key, field, value);
          const labels = { max_claims: "عدد المنفذين", verify_target: "العدد المطلوب", verify_type: "طريقة التحقق" };
          return ctx.success(
            `تم تعديل **${labels[field] || field}** في **${updated.title}**.` +
            (field === "max_claims"
              ? `\nيقدر ينفذها الآن: **${updated.max_claims > 0 ? updated.max_claims : "بلا حد"}**`
              : "")
          );
        } catch (err) {
          return ctx.fail("errors.actionFailed", { details: err.message });
        }
      }

      if (sub === "حذف") {
        const key = opt("key").trim();
        if (!app.quests.remove(guildId, key)) {
          return ctx.fail("errors.actionFailed", { details: "المهمة غير موجودة." });
        }
        return ctx.success(`تم حذف \`${key}\`. (سجل الإنجازات السابقة يبقى محفوظًا)`);
      }

      if (sub === "نشر") {
        const key = opt("key").trim();
        const quest = app.quests.get(guildId, key);
        if (!quest) return ctx.fail("errors.actionFailed", { details: "المهمة غير موجودة." });
        if (!quest.enabled) return ctx.fail("errors.actionFailed", { details: "هذه المهمة معطّلة — فعّلها أولًا." });

        const cfg = svc.config(guildId);
        const channel = ctx.interaction.options.getChannel("channel")
          || (cfg.channelId ? await app.client.channels.fetch(cfg.channelId).catch(() => null) : null);

        if (!channel?.isTextBased?.()) {
          return ctx.fail("errors.actionFailed", { details: "حدد قناة، أو اضبط قناة افتراضية من `/مهام اعدادات`." });
        }
        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }

        const closesRaw = opt("closes");
        const closesMs = closesRaw ? parseDuration(closesRaw) : null;

        const cycle = app.quests.openCycle({
          guildId, questId: quest.id, channelId: channel.id,
          closesAt: closesMs ? Date.now() + closesMs : null
        });

        const message = await channel.send(svc.cardPayload(ctx.guild, quest, cycle)).catch(() => null);
        if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر المهمة." });

        app.quests.setCycleMessage(cycle.id, channel.id, message.id);
        return ctx.success(
          `نُشرت **${quest.title}** في <#${channel.id}>.\n` +
          `المقاعد: ${quest.max_claims > 0 ? quest.max_claims : "بلا حد"}` +
          (closesMs ? ` • تُغلق بعد ${formatDuration(closesMs)}` : "")
        );
      }

      // اعدادات
      const updates = {};
      const enabled = ctx.interaction.options.getBoolean("enabled");
      const channel = ctx.interaction.options.getChannel("channel");
      const review = ctx.interaction.options.getChannel("review");
      const timeout = opt("timeout");
      const me = ctx.guild.members.me;

      if (enabled !== null) updates["quests.enabled"] = enabled;
      for (const [ch, key] of [[channel, "quests.channelId"], [review, "quests.logChannelId"]]) {
        if (!ch) continue;
        if (!ch.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${ch.id}>.` });
        }
        updates[key] = ch.id;
      }
      if (timeout) {
        const ms = parseDuration(timeout);
        if (!ms) return ctx.fail("errors.actionFailed", { details: "صيغة المهلة غير صالحة. مثال: `1h`" });
        updates["quests.defaultTimeoutMs"] = ms;
      }

      if (!Object.keys(updates).length) {
        return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
      }

      app.guildConfig.setMany(guildId, updates);
      const cfg = svc.config(guildId);
      return ctx.reply({
        embeds: [buildEmbed({
          title: "⚙️ إعدادات المهام",
          color: ctx.color("success"),
          fields: [
            { name: "النظام", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
            { name: "قناة النشر", value: cfg.channelId ? `<#${cfg.channelId}>` : "—", inline: true },
            { name: "قناة المراجعة", value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : "—", inline: true },
            { name: "المهلة الافتراضية", value: formatDuration(cfg.defaultTimeoutMs), inline: true }
          ]
        })]
      }, { ephemeral: true });
    }
  }
];
