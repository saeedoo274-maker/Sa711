const { SlashCommandBuilder, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");

const weekdays = [
  { name: "الأحد", value: 0 }, { name: "الإثنين", value: 1 }, { name: "الثلاثاء", value: 2 }, { name: "الأربعاء", value: 3 },
  { name: "الخميس", value: 4 }, { name: "الجمعة", value: 5 }, { name: "السبت", value: 6 }
];
const targetChoices = [{ name: "الخاص", value: "dm" }, { name: "هذه القناة", value: "channel" }];

let tzCache = null;
function timezones() {
  if (!tzCache) {
    try {
      tzCache = Intl.supportedValuesOf("timeZone");
    } catch {
      tzCache = ["UTC", "Asia/Riyadh", "Asia/Dubai", "Africa/Cairo", "Europe/Istanbul", "Europe/London", "America/New_York"];
    }
  }
  return tzCache;
}

function failReason(ctx, res) {
  return ctx.fail("errors.actionFailed", { details: ctx.t(`remind.err.${res.reason}`, { max: res.max }) });
}

module.exports = [
  {
    name: "تذكير",
    aliases: ["remind", "reminder", "remindme", "ذكرني"],
    subAliases: { بعد: "in", في: "at", تكرار: "repeat", القائمة: "list", حذف: "delete", تعديل: "edit", منطقة: "timezone", طاقم: "staff" },
    description: "تذكيرات بعد مدة أو بتاريخ، أو متكررة يوميًا/أسبوعيًا/شهريًا — للخاص أو القناة.",
    usage: "/تذكير in time:30m content:... | !remind in 2h اجتماع",
    arguments: [
      { name: "in", required: false, description: "بعد مدة (10m, 2h, 1d)" },
      { name: "at", required: false, description: "بتاريخ/وقت (2026-10-01 18:30 أو 18:30)" },
      { name: "repeat", required: false, description: "تذكير متكرر" },
      { name: "list", required: false, description: "تذكيراتك" },
      { name: "edit", required: false, description: "تعديل تذكير" },
      { name: "delete", required: false, description: "حذف تذكير" },
      { name: "timezone", required: false, description: "منطقتك الزمنية" },
      { name: "staff", required: false, description: "تذكير للطاقم في قناة مع منشن رتبة" }
    ],
    examples: ["/تذكير in time:45m content:الاجتماع", "!remind in 2h شرب الماء", "/تذكير repeat kind:daily time:08:00 content:ورد الصباح", "/تذكير timezone zone:Asia/Riyadh"],
    category: "reminders",
    cooldown: 3000,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("تذكير")
      .setDescription("التذكيرات")
      .addSubcommand((s) => s.setName("in").setDescription("تذكير بعد مدة")
        .addStringOption((o) => o.setName("time").setDescription("المدة: 10m, 2h, 1d").setRequired(true).setMaxLength(20))
        .addStringOption((o) => o.setName("content").setDescription("نص التذكير").setRequired(true).setMaxLength(1500))
        .addStringOption((o) => o.setName("target").setDescription("أين؟").addChoices(...targetChoices)))
      .addSubcommand((s) => s.setName("at").setDescription("تذكير بتاريخ/وقت (بمنطقتك الزمنية)")
        .addStringOption((o) => o.setName("when").setDescription("2026-10-01 18:30 أو 18:30").setRequired(true).setMaxLength(20))
        .addStringOption((o) => o.setName("content").setDescription("نص التذكير").setRequired(true).setMaxLength(1500))
        .addStringOption((o) => o.setName("target").setDescription("أين؟").addChoices(...targetChoices)))
      .addSubcommand((s) => s.setName("repeat").setDescription("تذكير متكرر")
        .addStringOption((o) => o.setName("kind").setDescription("التكرار").setRequired(true).addChoices(
          { name: "يومي", value: "daily" }, { name: "أسبوعي", value: "weekly" }, { name: "شهري", value: "monthly" }))
        .addStringOption((o) => o.setName("time").setDescription("الساعة HH:MM").setRequired(true).setMaxLength(5))
        .addStringOption((o) => o.setName("content").setDescription("نص التذكير").setRequired(true).setMaxLength(1500))
        .addIntegerOption((o) => o.setName("weekday").setDescription("اليوم (للأسبوعي)").addChoices(...weekdays))
        .addIntegerOption((o) => o.setName("day").setDescription("يوم الشهر (للشهري)").setMinValue(1).setMaxValue(31))
        .addStringOption((o) => o.setName("target").setDescription("أين؟").addChoices(...targetChoices)))
      .addSubcommand((s) => s.setName("list").setDescription("تذكيراتك"))
      .addSubcommand((s) => s.setName("edit").setDescription("تعديل تذكير")
        .addIntegerOption((o) => o.setName("id").setDescription("رقم التذكير").setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName("content").setDescription("نص جديد").setMaxLength(1500))
        .addStringOption((o) => o.setName("time").setDescription("مدة جديدة من الآن (30m)").setMaxLength(20))
        .addStringOption((o) => o.setName("when").setDescription("موعد جديد (2026-10-01 18:30)").setMaxLength(20)))
      .addSubcommand((s) => s.setName("delete").setDescription("حذف تذكير")
        .addIntegerOption((o) => o.setName("id").setDescription("رقم التذكير").setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName("timezone").setDescription("منطقتك الزمنية")
        .addStringOption((o) => o.setName("zone").setDescription("مثل Asia/Riyadh").setAutocomplete(true).setMaxLength(64)))
      .addSubcommand((s) => s.setName("staff").setDescription("تذكير طاقم في قناة")
        .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((o) => o.setName("content").setDescription("النص").setRequired(true).setMaxLength(1500))
        .addStringOption((o) => o.setName("time").setDescription("بعد مدة (30m)").setMaxLength(20))
        .addStringOption((o) => o.setName("when").setDescription("أو بتاريخ (2026-10-01 18:30)").setMaxLength(20))
        .addStringOption((o) => o.setName("repeat").setDescription("تكرار").addChoices(
          { name: "يومي", value: "daily" }, { name: "أسبوعي", value: "weekly" }, { name: "شهري", value: "monthly" }))
        .addRoleOption((o) => o.setName("role").setDescription("رتبة تُمنشن"))),

    async autocomplete(interaction) {
      const typed = (interaction.options.getFocused() || "").toLowerCase();
      const list = timezones().filter((z) => z.toLowerCase().includes(typed)).slice(0, 25);
      return interaction.respond(list.map((z) => ({ name: z, value: z })));
    },

    async execute(ctx) {
      const app = ctx.app;
      const svc = app.reminders;
      const sub = ctx.subcommand();
      const t = (k, v) => ctx.t(k, v);
      const opt = (name) => (ctx.isSlash ? ctx.interaction.options.getString(name) : null);
      const targetOf = () => opt("target") || "dm";

      const done = (res) => {
        if (!res.ok) return failReason(ctx, res);
        return ctx.reply({ content: `${ctx.emoji("success")} ${t("remind.created")}\n${svc.describe(res.reminder, t)}`, allowedMentions: { parse: [] } }, { ephemeral: true });
      };

      if (sub === "in") {
        const time = ctx.isSlash ? opt("time") : ctx.args[0];
        const content = ctx.isSlash ? opt("content") : ctx.args.slice(1).join(" ");
        return done(await svc.create(ctx.member, { content, inText: time, target: targetOf(), channel: ctx.channel }));
      }

      if (sub === "at") {
        // بريفكس: "!remind at 2026-10-01 18:30 النص" أو "!remind at 18:30 النص"
        let when = opt("when");
        let content = opt("content");
        if (!ctx.isSlash) {
          const dateLike = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(ctx.args[0] || "") && /^\d{1,2}:\d{2}$/.test(ctx.args[1] || "");
          when = dateLike ? `${ctx.args[0]} ${ctx.args[1]}` : ctx.args[0];
          content = ctx.args.slice(dateLike ? 2 : 1).join(" ");
        }
        return done(await svc.create(ctx.member, { content, atText: when, target: targetOf(), channel: ctx.channel }));
      }

      if (sub === "repeat") {
        const kind = ctx.isSlash ? opt("kind") : ctx.args[0];
        const time = ctx.isSlash ? opt("time") : ctx.args[1];
        const content = ctx.isSlash ? opt("content") : ctx.args.slice(2).join(" ");
        if (!["daily", "weekly", "monthly"].includes(kind) || !/^\d{1,2}:\d{2}$/.test(time || "")) return failReason(ctx, { reason: "invalidRepeat" });
        const repeat = { kind, time };
        if (ctx.isSlash) {
          if (kind === "weekly") repeat.weekday = ctx.interaction.options.getInteger("weekday") ?? new Date().getUTCDay();
          if (kind === "monthly") repeat.dayOfMonth = ctx.interaction.options.getInteger("day") ?? new Date().getUTCDate();
        }
        return done(await svc.create(ctx.member, { content, repeat, target: targetOf(), channel: ctx.channel }));
      }

      if (sub === "list") {
        const staff = app.permissions.resolveLevel(ctx.member) >= (svc.config(ctx.guild.id).staffLevel ?? 1);
        const rows = svc.repo.listForUser(ctx.guild.id, ctx.user.id, { includeStaff: staff });
        return ctx.reply({
          embeds: [ctx.embed({
            title: `⏰ ${t("remind.listTitle")}`,
            description: rows.map((r) => svc.describe(r, t)).join("\n\n").slice(0, 4000) || t("ui.empty"),
            color: "info",
            footer: `${t("remind.tzLabel")}: ${svc.timezoneFor(ctx.guild.id, ctx.user.id)}`
          })],
          allowedMentions: { parse: [] }
        }, { ephemeral: true });
      }

      if (sub === "delete") {
        const res = svc.delete(ctx.member, ctx.getNumber("id", 0));
        if (!res.ok) return failReason(ctx, res);
        return ctx.reply({ content: `${ctx.emoji("success")} ${t("remind.deleted", { id: res.reminder.id })}` }, { ephemeral: true });
      }

      if (sub === "edit") {
        const id = ctx.getNumber("id", 0);
        const res = svc.edit(ctx.member, id, {
          content: ctx.isSlash ? opt("content") : ctx.args.slice(1).join(" ") || null,
          inText: opt("time"),
          atText: opt("when")
        });
        if (!res.ok) return failReason(ctx, res);
        return ctx.reply({ content: `${ctx.emoji("success")} ${t("remind.edited")}\n${svc.describe(res.reminder, t)}`, allowedMentions: { parse: [] } }, { ephemeral: true });
      }

      if (sub === "timezone") {
        const zone = ctx.isSlash ? opt("zone") : ctx.args[0];
        if (!zone) return ctx.reply({ content: `🌍 ${t("remind.tzLabel")}: \`${svc.timezoneFor(ctx.guild.id, ctx.user.id)}\`` }, { ephemeral: true });
        if (!svc.setTimezone(ctx.user.id, zone)) return failReason(ctx, { reason: "invalidTimezone" });
        const local = new Intl.DateTimeFormat("en-GB", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
        return ctx.reply({ content: `${ctx.emoji("success")} ${t("remind.tzSet", { zone, local })}` }, { ephemeral: true });
      }

      if (sub === "staff") {
        if (app.permissions.resolveLevel(ctx.member) < (svc.config(ctx.guild.id).staffLevel ?? 1)) return ctx.fail("errors.noPermission");
        const o = ctx.interaction?.options;
        if (!o) return failReason(ctx, { reason: "slashOnly" });
        const kind = o.getString("repeat");
        const timeText = o.getString("time");
        const whenText = o.getString("when");
        let repeat = null;
        if (kind) {
          const hhmm = (whenText || "").match(/(\d{1,2}:\d{2})$/)?.[1];
          if (!hhmm) return failReason(ctx, { reason: "invalidRepeat" });
          repeat = { kind, time: hhmm, weekday: new Date().getUTCDay(), dayOfMonth: new Date().getUTCDate() };
        }
        return done(await svc.create(ctx.member, {
          content: o.getString("content"), inText: repeat ? null : timeText, atText: repeat ? null : whenText, repeat,
          target: "channel", channel: o.getChannel("channel"), staff: true, mentionRole: o.getRole("role")
        }));
      }

      return ctx.fail("errors.actionFailed", { details: sub || "?" });
    }
  }
];
