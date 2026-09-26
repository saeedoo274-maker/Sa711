const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");

const { METRICS } = require("../../achievements/catalog");

const { parseDuration } = require("../../../core/utils/common");
const { parseDateTime, zonedParts, isValidTimezone } = require("../../../core/utils/time");

/** خيارات تأليف الإعلان المشتركة بين الإرسال والجدولة والقوالب. */
function composeOptions(s, { withTarget = true } = {}) {
  s.addStringOption((o) => o.setName("message").setDescription("نص الإعلان (يدعم المتغيرات)").setMaxLength(2000))
    .addStringOption((o) => o.setName("title").setDescription("عنوان (يجعله إمبيد)").setMaxLength(256))
    .addStringOption((o) => o.setName("image").setDescription("رابط صورة https").setMaxLength(400))
    .addStringOption((o) => o.setName("color").setDescription("لون الإمبيد").addChoices(
      { name: "أساسي", value: "primary" }, { name: "نجاح", value: "success" }, { name: "تحذير", value: "warning" },
      { name: "خطر", value: "danger" }, { name: "معلومة", value: "info" }))
    .addStringOption((o) => o.setName("embed").setDescription("إمبيد محفوظ بالاسم").setMaxLength(64))
    .addStringOption((o) => o.setName("mention").setDescription("المنشن").addChoices(
      { name: "بدون", value: "none" }, { name: "@everyone", value: "everyone" }, { name: "@here", value: "here" }, { name: "رتبة", value: "role" }))
    .addRoleOption((o) => o.setName("role").setDescription("رتبة المنشن"))
    .addStringOption((o) => o.setName("button-label").setDescription("زر رابط").setMaxLength(80))
    .addStringOption((o) => o.setName("button-url").setDescription("رابط الزر https").setMaxLength(400))
    .addStringOption((o) => o.setName("template").setDescription("تحميل قالب").setAutocomplete(true));
  if (withTarget) {
    s.addChannelOption((o) => o.setName("channel").setDescription("القناة (افتراضي الحالية)"))
      .addStringOption((o) => o.setName("target").setDescription("الوجهة").addChoices({ name: "قناة", value: "channel" }, { name: "خاص أعضاء رتبة", value: "dm" }))
      .addRoleOption((o) => o.setName("dm-role").setDescription("الرتبة المستهدفة للخاص"));
  }
  return s;
}

const providerChoices = [
  ["rss", "RSS / Atom"], ["youtube", "YouTube"], ["github", "GitHub"], ["steam", "Steam"], ["x", "X (RSS bridge)"], ["tiktok", "TikTok (RSS bridge)"],
  ["twitch", "Twitch"], ["minecraft", "Minecraft"], ["fivem", "FiveM"], ["roblox", "Roblox"], ["api", "API (JSON)"], ["webhook", "Webhook صادر"]
].map(([value, name]) => ({ name, value }));

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
          .addBooleanOption((o) => o.setName("dm").setDescription("إشعار خاص"))))
      .addSubcommandGroup((g) => g.setName("announcement").setDescription("الإعلانات")
        .addSubcommand((s) => composeOptions(s.setName("send").setDescription("إعلان الآن (مع معاينة)")))
        .addSubcommand((s) => composeOptions(s.setName("schedule").setDescription("جدولة إعلان (مع معاينة)"))
          .addStringOption((o) => o.setName("at").setDescription("التاريخ/الوقت مثل 2026-10-01 18:00 أو 18:00").setMaxLength(20))
          .addStringOption((o) => o.setName("in").setDescription("بعد مدة مثل 2h").setMaxLength(10))
          .addStringOption((o) => o.setName("repeat").setDescription("التكرار").addChoices(
            { name: "بدون", value: "none" }, { name: "يومي", value: "daily" }, { name: "أسبوعي", value: "weekly" }, { name: "شهري", value: "monthly" })))
        .addSubcommand((s) => s.setName("list").setDescription("المجدولة والقوالب"))
        .addSubcommand((s) => s.setName("cancel").setDescription("إلغاء إعلان مجدول")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم الإعلان").setRequired(true)))
        .addSubcommand((s) => composeOptions(s.setName("template").setDescription("حفظ/حذف قالب")
          .addStringOption((o) => o.setName("name").setDescription("اسم القالب").setRequired(true).setMaxLength(32)), { withTarget: false })
          .addBooleanOption((o) => o.setName("delete").setDescription("حذف القالب"))))
      .addSubcommandGroup((g) => g.setName("integration").setDescription("التكاملات")
        .addSubcommand((s) => s.setName("add").setDescription("اشتراك جديد")
          .addStringOption((o) => o.setName("provider").setDescription("المزوّد").setRequired(true).addChoices(...providerChoices))
          .addStringOption((o) => o.setName("source").setDescription("رابط/معرّف/عنوان المصدر").setRequired(true).setMaxLength(300))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة النشر"))
          .addRoleOption((o) => o.setName("role").setDescription("رتبة للمنشن"))
          .addIntegerOption((o) => o.setName("interval").setDescription("الفحص كل (دقائق)").setMinValue(5).setMaxValue(1440))
          .addStringOption((o) => o.setName("template").setDescription("نص الرسالة: {title} {url} {author} {name} {players} {status}").setMaxLength(500))
          .addStringOption((o) => o.setName("events").setDescription("للـ Webhook: أحداث مفصولة بفواصل (فارغ = الكل)").setMaxLength(400))
          .addStringOption((o) => o.setName("secret").setDescription("للـ Webhook: سر التوقيع HMAC").setMaxLength(128))
          .addStringOption((o) => o.setName("id-path").setDescription("للـ API: مسار المعرّف").setMaxLength(100))
          .addStringOption((o) => o.setName("title-path").setDescription("للـ API: مسار العنوان").setMaxLength(100))
          .addStringOption((o) => o.setName("url-path").setDescription("للـ API: مسار الرابط").setMaxLength(100)))
        .addSubcommand((s) => s.setName("list").setDescription("الاشتراكات"))
        .addSubcommand((s) => s.setName("remove").setDescription("حذف اشتراك").addIntegerOption((o) => o.setName("id").setDescription("الرقم").setRequired(true)))
        .addSubcommand((s) => s.setName("toggle").setDescription("تفعيل/إيقاف").addIntegerOption((o) => o.setName("id").setDescription("الرقم").setRequired(true)))
        .addSubcommand((s) => s.setName("test").setDescription("فحص الآن (معاينة)").addIntegerOption((o) => o.setName("id").setDescription("الرقم").setRequired(true)))),

    async autocomplete(interaction, app) {
      const typed = String(interaction.options.getFocused() || "").toLowerCase();
      if (interaction.options.getSubcommandGroup(false) === "announcement") {
        const rows = app.announcementsRepo ? app.announcementsRepo.list(interaction.guild.id, ["template"]) : [];
        return interaction.respond(rows.filter((r) => r.name.includes(typed)).slice(0, 25).map((r) => ({ name: r.name, value: r.name })));
      }
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

      if (ctx.subcommandGroup() === "integration") {
        const blocked = need("integrations");
        if (blocked) return blocked;
        return integration(ctx, sub);
      }

      if (ctx.subcommandGroup() === "announcement") {
        const blocked = need("announcements");
        if (blocked) return blocked;
        return announcement(ctx, sub);
      }

      return ctx.fail("errors.actionFailed", { details: sub || "?" });
    }
  }
];

async function announcement(ctx, sub) {
  const app = ctx.app;
  const svc = app.announcements;
  const o = ctx.interaction.options;
  const t = (k, v) => ctx.t(k, v);
  const fail = (reason) => ctx.fail("errors.actionFailed", { details: t(`ann.err.${reason}`) });

  if (sub === "list") return ctx.reply(svc.listPayload(ctx.guild), { ephemeral: true });
  if (sub === "cancel") {
    const res = svc.cancelScheduled(ctx.guild.id, o.getInteger("id"));
    return res.ok ? ctx.success(t("ann.cancelledScheduled", { id: o.getInteger("id") })) : fail(res.reason);
  }

  // تأليف المواصفات: القالب أولًا ثم ما يحدده المستخدم فوقه
  let spec = {};
  const templateName = o.getString("template");
  if (templateName) {
    const tpl = app.announcementsRepo.template(ctx.guild.id, templateName.trim().toLowerCase());
    if (!tpl) return fail("template");
    spec = { ...tpl.spec };
  }
  const embedName = o.getString("embed");
  if (embedName) {
    const record = app.embeds.getByName(ctx.guild.id, embedName.trim());
    if (!record) return fail("embedMissing");
    spec.embedId = record.id;
  }
  for (const [opt, key] of [["message", "content"], ["title", "title"], ["image", "image"], ["color", "color"], ["mention", "mention"]]) {
    if (o.getString(opt)) spec[key] = o.getString(opt);
  }
  if (o.getRole("role")) spec.mentionRoleId = o.getRole("role").id;
  if (o.getString("button-label") || o.getString("button-url")) spec.buttons = [{ label: o.getString("button-label"), url: o.getString("button-url") }];

  if (sub === "template") {
    const name = o.getString("name").trim().toLowerCase();
    if (o.getBoolean("delete")) {
      return app.announcementsRepo.deleteTemplate(ctx.guild.id, name) ? ctx.success(t("ann.templateDeleted", { name })) : fail("template");
    }
    const res = svc.saveTemplate(ctx.member, name, spec);
    return res.ok ? ctx.success(t("ann.templateSaved", { name: res.name })) : fail(res.reason);
  }

  const target = o.getString("target") || "channel";
  const channel = o.getChannel("channel") || ctx.channel;
  let runAt = null;
  let repeat = null;
  if (sub === "schedule") {
    const own = app.platform.userTimezone(ctx.user.id);
    const guildTz = app.guildConfig.value(ctx.guild.id, "reminders.defaultTimezone");
    const tz = isValidTimezone(own) ? own : isValidTimezone(guildTz) ? guildTz : "UTC";
    const inText = o.getString("in");
    const atText = o.getString("at");
    runAt = inText ? Date.now() + (parseDuration(inText) || 0) : atText ? parseDateTime(atText, tz) : null;
    if (!runAt || runAt <= Date.now() + 30_000 || runAt - Date.now() > 366 * 86_400_000) return fail("time");
    const kind = o.getString("repeat");
    if (kind && kind !== "none") {
      const p = zonedParts(runAt, tz);
      repeat = { kind, time: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`, tz };
      if (kind === "weekly") repeat.weekday = p.weekday;
      if (kind === "monthly") repeat.dayOfMonth = p.day;
    }
  }
  const res = svc.draft(ctx.member, { spec, target, channel, dmRole: o.getRole("dm-role"), runAt, repeat });
  if (!res.ok) return fail(res.reason);
  return ctx.reply(res.preview, { ephemeral: true });
}

async function integration(ctx, sub) {
  const app = ctx.app;
  const svc = app.integrations;
  const o = ctx.interaction.options;
  const t = (k, v) => ctx.t(k, v);
  const fail = (reason, extra = "") => ctx.fail("errors.actionFailed", { details: `${t(`intg.err.${reason}`)}${extra}` });

  if (sub === "list") {
    const rows = svc.list(ctx.guild.id);
    return ctx.reply({
      embeds: [ctx.embed({
        title: `🔌 ${t("intg.title")}`,
        color: "info",
        description: rows.map((r) => {
          const p = svc.providers.get(r.provider);
          return `${r.enabled ? "🟢" : "⚪"} \`#${r.id}\` ${p?.emoji || ""} **${p?.label || r.provider}** — \`${r.source.slice(0, 80)}\`${r.channel_id ? ` → <#${r.channel_id}>` : ""} • ${Math.round(r.interval_ms / 60000)}m${r.fail_count ? ` • ⚠️ ${r.fail_count}` : ""}${r.last_error ? `\n-# ${r.last_error.slice(0, 100)}` : ""}`;
        }).join("\n") || t("ui.empty")
      })],
      allowedMentions: { parse: [] }
    }, { ephemeral: true });
  }

  if (sub === "add") {
    const res = svc.add(ctx.guild, ctx.member, {
      provider: o.getString("provider"),
      source: o.getString("source"),
      channel: o.getChannel("channel") || ctx.channel,
      role: o.getRole("role"),
      intervalMinutes: o.getInteger("interval"),
      template: o.getString("template"),
      options: { events: o.getString("events"), secret: o.getString("secret"), idPath: o.getString("id-path"), titlePath: o.getString("title-path"), urlPath: o.getString("url-path") }
    });
    return res.ok ? ctx.success(t("intg.added", { id: res.id })) : fail(res.reason);
  }

  const id = o.getInteger("id");
  const record = svc.get(ctx.guild.id, id);
  if (!record) return fail("notFound");
  if (sub === "remove") return svc.remove(ctx.guild.id, id) ? ctx.success(t("intg.removed", { id })) : fail("notFound");
  if (sub === "toggle") return ctx.success(t(svc.toggle(ctx.guild.id, id) ? "intg.enabled" : "intg.disabled", { id }));
  // test
  await ctx.defer({ ephemeral: true });
  try {
    const res = await svc.test(record);
    if (res.delivered) return ctx.success(t("intg.delivered"));
    if (!res.payload) return ctx.reply({ content: t("intg.noItems") }, { ephemeral: true });
    return ctx.reply({ ...res.payload, content: `🧪 ${t("intg.preview")}\n${res.payload.content || ""}`.slice(0, 2000), allowedMentions: { parse: [] } }, { ephemeral: true });
  } catch (error) {
    return fail("fetch", `: ${String(error.message).slice(0, 200)}`);
  }
}
