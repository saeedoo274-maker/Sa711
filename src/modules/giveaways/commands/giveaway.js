const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { parseDuration, buildEmbed, timestamp } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "سحب",
    aliases: ["giveaway", "قيف"],
    description: "إدارة السحوبات: بدء، إنهاء، إعادة سحب، إلغاء، وعرض القائمة.",
    usage: "/giveaway start prize:<الجائزة> duration:<المدة> winners:<العدد>",
    arguments: [
      { name: "prize", required: true, description: "الجائزة" },
      { name: "duration", required: true, description: "مدة السحب مثل 1h أو 2d" },
      { name: "winners", required: false, description: "عدد الفائزين (افتراضي 1)" },
      { name: "required-role", required: false, description: "رتبة مطلوبة للمشاركة" },
      { name: "bonus-role", required: false, description: "رتبة تمنح فرص إضافية" },
      { name: "bonus-entries", required: false, description: "عدد الفرص لحاملي رتبة البونص" },
      { name: "min-account-age", required: false, description: "أقل عمر للحساب مثل 30d" },
      { name: "channel", required: false, description: "قناة نشر السحب" }
    ],
    examples: [
      "/giveaway start prize:نيترو duration:2h winners:2",
      "/giveaway start prize:نيترو duration:1d required-role:@عضو bonus-role:@VIP bonus-entries:3"
    ],
    category: "giveaways",
    slashOnly: true,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("سحب")
      .setDescription("إدارة السحوبات")
      .addSubcommand((s) =>
        s.setName("start").setDescription("بدء سحب جديد")
          .addStringOption((o) => o.setName("prize").setDescription("الجائزة").setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName("duration").setDescription("المدة مثل 1h أو 2d").setRequired(true))
          .addIntegerOption((o) => o.setName("winners").setDescription("عدد الفائزين").setMinValue(1).setMaxValue(20))
          .addRoleOption((o) => o.setName("required-role").setDescription("رتبة مطلوبة للمشاركة"))
          .addRoleOption((o) => o.setName("bonus-role").setDescription("رتبة تمنح فرص إضافية"))
          .addIntegerOption((o) => o.setName("bonus-entries").setDescription("عدد الفرص للبونص").setMinValue(2).setMaxValue(10))
          .addStringOption((o) => o.setName("min-account-age").setDescription("أقل عمر للحساب مثل 30d"))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة النشر").addChannelTypes(ChannelType.GuildText))
          .addIntegerOption((o) => o.setName("min-level").setDescription("أقل مستوى للمشاركة").setMinValue(1).setMaxValue(1000))
          .addIntegerOption((o) => o.setName("min-messages").setDescription("أقل عدد رسائل خلال فترة النشاط").setMinValue(1).setMaxValue(100000))
          .addIntegerOption((o) => o.setName("activity-days").setDescription("فترة النشاط بالأيام (افتراضي 30)").setMinValue(1).setMaxValue(365))
          .addIntegerOption((o) => o.setName("min-invites").setDescription("أقل عدد دعوات فعلية").setMinValue(1).setMaxValue(10000))
          .addStringOption((o) => o.setName("starts-in").setDescription("جدولة البدء بعد مدة مثل 2h"))
          .addStringOption((o) => o.setName("description").setDescription("وصف السحب").setMaxLength(500))
          .addBooleanOption((o) => o.setName("dm-winners").setDescription("إرسال رسالة خاصة للفائزين"))
      )
      .addSubcommand((s) =>
        s.setName("end").setDescription("إنهاء سحب فورًا")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم السحب").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("reroll").setDescription("إعادة سحب الفائزين")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم السحب").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("cancel").setDescription("إلغاء سحب بدون فائزين")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم السحب").setRequired(true))
      )
      .addSubcommand((s) => s.setName("list").setDescription("عرض السحوبات النشطة والمجدولة"))
      .addSubcommand((s) =>
        s.setName("info").setDescription("تفاصيل سحب")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم السحب").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("history").setDescription("سجل السحوبات أو فوز عضو")
          .addUserOption((o) => o.setName("user").setDescription("سجل فوز عضو محدد"))
      )
      .addSubcommand((s) =>
        s.setName("bonus").setDescription("رتبة فرص إضافية (1 = إزالة)")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم السحب").setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة").setRequired(true))
          .addIntegerOption((o) => o.setName("entries").setDescription("عدد الفرص").setRequired(true).setMinValue(1).setMaxValue(20))
      )
      .addSubcommand((s) =>
        s.setName("template").setDescription("قوالب السحوبات")
          .addStringOption((o) => o.setName("action").setDescription("الإجراء").setRequired(true)
            .addChoices({ name: "استخدام", value: "use" }, { name: "حفظ من سحب", value: "save" }, { name: "حذف", value: "delete" }, { name: "عرض", value: "list" }))
          .addStringOption((o) => o.setName("name").setDescription("اسم القالب").setMaxLength(32).setAutocomplete(true))
          .addIntegerOption((o) => o.setName("id").setDescription("رقم السحب (للحفظ)"))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة النشر (للاستخدام)").addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) => o.setName("starts-in").setDescription("جدولة البدء (للاستخدام)"))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async autocomplete(interaction, app) {
      const typed = String(interaction.options.getFocused() || "").toLowerCase();
      const rows = app.giveawaysPlusRepo ? app.giveawaysPlusRepo.templates(interaction.guild.id) : [];
      return interaction.respond(rows.filter((r) => r.name.includes(typed)).slice(0, 25).map((r) => ({ name: r.name, value: r.name })));
    },

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const service = ctx.app.giveawayService;
      const plus = ctx.app.giveawaysPlus && ctx.app.features.isEnabled(ctx.guild.id, "giveaways") ? ctx.app.giveawaysPlus : null;

      if (sub === "start") {
        const o = ctx.interaction.options;
        const durationMs = parseDuration(o.getString("duration"));
        if (!durationMs) return ctx.fail("errors.invalidDuration");
        if (durationMs > 30 * 86400000) return ctx.fail("errors.actionFailed", { details: "أقصى مدة للسحب 30 يومًا." });

        const minAgeRaw = o.getString("min-account-age");
        const minAccountAgeMs = minAgeRaw ? parseDuration(minAgeRaw) : null;
        if (minAgeRaw && !minAccountAgeMs) return ctx.fail("errors.invalidDuration");
        const startsRaw = o.getString("starts-in");
        const startsInMs = startsRaw ? parseDuration(startsRaw) : 0;
        if (startsRaw && !startsInMs) return ctx.fail("errors.invalidDuration");

        const channel = o.getChannel("channel") || ctx.channel;
        if (!channel.isTextBased()) return ctx.fail("errors.channelNotFound");

        const opts = {
          channel,
          prize: o.getString("prize"),
          durationMs,
          winners: o.getInteger("winners") || 1,
          hostId: ctx.user.id,
          requiredRoleId: o.getRole("required-role")?.id || null,
          bonusRoleId: o.getRole("bonus-role")?.id || null,
          bonusEntries: o.getInteger("bonus-entries") || 1,
          minAccountAgeMs,
          minLevel: o.getInteger("min-level"),
          minMessages: o.getInteger("min-messages"),
          activityDays: o.getInteger("activity-days"),
          minInvites: o.getInteger("min-invites"),
          description: o.getString("description"),
          dmWinners: o.getBoolean("dm-winners"),
          startsInMs
        };
        const usesExtras = opts.minLevel || opts.minMessages || opts.minInvites || opts.description || opts.dmWinners || startsInMs;
        if (usesExtras && !plus) return ctx.fail("errors.systemDisabled", { system: "giveaways-plus" });
        return startGiveaway(ctx, opts);
      }

      if (sub === "history") {
        if (!plus) return ctx.fail("errors.systemDisabled", { system: "giveaways-plus" });
        const user = ctx.interaction.options.getUser("user");
        return ctx.reply(plus.historyPayload(ctx.guild, user?.id || null));
      }

      if (sub === "template") {
        if (!plus) return ctx.fail("errors.systemDisabled", { system: "giveaways-plus" });
        const o = ctx.interaction.options;
        const action = o.getString("action");
        const name = (o.getString("name") || "").trim().toLowerCase();
        if (action === "list") {
          const rows = plus.repo.templates(ctx.guild.id);
          return ctx.reply({
            embeds: [ctx.embed({
              title: "🗂️ قوالب السحوبات",
              color: "info",
              description: rows.map((r) => { const d = JSON.parse(r.data); return `\`${r.name}\` — **${d.prize}** (${d.winners} فائز)`; }).join("\n") || "لا توجد قوالب."
            })]
          }, { ephemeral: true });
        }
        if (!name) return ctx.fail("errors.actionFailed", { details: "حدد اسم القالب." });
        if (action === "delete") {
          return plus.repo.deleteTemplate(ctx.guild.id, name) ? ctx.success(`تم حذف القالب \`${name}\`.`) : ctx.fail("errors.actionFailed", { details: "قالب غير موجود." });
        }
        if (action === "save") {
          const source = ctx.app.giveaways.getById(o.getInteger("id") || 0);
          if (!source || source.guild_id !== ctx.guild.id) return ctx.fail("errors.actionFailed", { details: "حدد رقم سحب صحيح من هذا السيرفر." });
          const res = plus.saveTemplate(ctx.guild.id, name, plus.constructor.templateFrom(source), ctx.user.id);
          if (!res.ok) return ctx.fail("errors.actionFailed", { details: res.reason === "maxTemplates" ? "وصلت للحد الأقصى من القوالب." : "اسم قالب غير صالح (حروف وأرقام و - _ فقط)." });
          return ctx.success(`تم حفظ القالب \`${res.name}\`.`);
        }
        // use
        const tpl = plus.repo.template(ctx.guild.id, name);
        if (!tpl) return ctx.fail("errors.actionFailed", { details: "قالب غير موجود." });
        const channel = o.getChannel("channel") || ctx.channel;
        if (!channel.isTextBased()) return ctx.fail("errors.channelNotFound");
        const startsRaw = o.getString("starts-in");
        const startsInMs = startsRaw ? parseDuration(startsRaw) : 0;
        if (startsRaw && !startsInMs) return ctx.fail("errors.invalidDuration");
        return startGiveaway(ctx, { ...tpl.data, channel, hostId: ctx.user.id, startsInMs });
      }

      const id = ctx.interaction.options.getInteger("id");
      if (sub !== "list" && !id) return ctx.fail("errors.invalidNumber");

      if (sub === "list") {
        const active = ctx.app.giveaways.listActive(ctx.guild.id);
        const scheduled = plus ? plus.repo.listScheduled(ctx.guild.id) : [];
        if (!active.length && !scheduled.length) return ctx.fail("errors.actionFailed", { details: "لا توجد سحوبات نشطة." });
        return ctx.reply({
          embeds: [
            buildEmbed({
              title: "🎁 السحوبات النشطة",
              description: active
                .map((g) => `\`#${g.id}\` **${g.prize}** — <#${g.channel_id}> — ينتهي ${timestamp(g.ends_at, "R")}`)
                .concat(scheduled.map((g) => `⏳ \`#${g.id}\` **${g.prize}** — <#${g.channel_id}> — يبدأ ${timestamp(g.starts_at, "R")}`))
                .join("\n"),
              color: ctx.color("primary")
            })
          ]
        });
      }

      const giveaway = ctx.app.giveaways.getById(id);
      if (!giveaway || giveaway.guild_id !== ctx.guild.id) {
        return ctx.fail("errors.actionFailed", { details: "لم أجد سحبًا بهذا الرقم في هذا السيرفر." });
      }

      if (sub === "info") {
        if (!plus) return ctx.fail("errors.systemDisabled", { system: "giveaways-plus" });
        return ctx.reply(plus.infoPayload(ctx.guild, giveaway), { ephemeral: true });
      }

      if (sub === "bonus") {
        if (!plus) return ctx.fail("errors.systemDisabled", { system: "giveaways-plus" });
        const res = plus.addBonusRole(giveaway, ctx.interaction.options.getRole("role").id, ctx.interaction.options.getInteger("entries"));
        if (!res.ok) return ctx.fail("errors.actionFailed", { details: res.reason === "maxBonus" ? "وصلت للحد الأقصى من رتب الفرص." : "السحب ليس نشطًا." });
        await refreshMessage(ctx.app, ctx.app.giveaways.getById(id));
        return ctx.success(`رتب الفرص: ${res.bonus.map((b) => `<@&${b.roleId}> ×${b.entries}`).join("، ") || "—"}`);
      }

      if (sub === "cancel" && giveaway.status === "scheduled" && plus) {
        if (!plus.cancelScheduled(giveaway)) return ctx.fail("errors.actionFailed", { details: "تعذر إلغاء السحب المجدول." });
        return ctx.success(`تم إلغاء السحب المجدول \`#${id}\`.`);
      }

      if (sub === "cancel") {
        if (!ctx.app.giveaways.cancel(id)) return ctx.fail("errors.actionFailed", { details: "السحب منتهٍ أو ملغى بالفعل." });
        return ctx.success(`تم إلغاء السحب \`#${id}\` بدون اختيار فائزين.`);
      }

      if (sub === "end") {
        const result = await service.end(id);
        if (!result.ok) return ctx.fail("errors.actionFailed", { details: "السحب منتهٍ بالفعل." });
        return ctx.success(`تم إنهاء السحب \`#${id}\`. عدد الفائزين: \`${result.winners.length}\``);
      }

      // reroll
      if (giveaway.status !== "ended") return ctx.fail("errors.actionFailed", { details: "لا يمكن إعادة سحب لم ينتهِ بعد." });
      const result = await service.end(id, { rerolledBy: ctx.user.id });
      return ctx.success(`تمت إعادة سحب \`#${id}\`. الفائزون الجدد: \`${result.winners.length}\``);
    }
  }
];

async function startGiveaway(ctx, opts) {
  const plus = ctx.app.giveawaysPlus;
  if (plus && ctx.app.features.isEnabled(ctx.guild.id, "giveaways")) {
    const res = await plus.create(ctx.guild, opts);
    if (!res.ok) {
      const reasons = {
        levelsDisabled: "نظام المستويات غير مفعّل في السيرفر.",
        historyDisabled: "سجل الأعضاء (عدّ الرسائل) غير مفعّل في السيرفر.",
        invitesDisabled: "تتبع الدعوات غير مفعّل في السيرفر.",
        tooLong: "أقصى مدة للسحب 30 يومًا.",
        startTooFar: "أقصى تأجيل للبدء 60 يومًا."
      };
      return ctx.fail("errors.actionFailed", { details: reasons[res.reason] || res.reason });
    }
    const g = res.giveaway;
    return ctx.reply(
      { content: res.scheduled
        ? `${ctx.emoji("success")} تمت جدولة السحب رقم \`${g.id}\` في <#${g.channel_id}> — يبدأ ${timestamp(res.startsAt, "R")}`
        : `${ctx.emoji("success")} تم بدء السحب رقم \`${g.id}\` في <#${g.channel_id}> — ينتهي ${timestamp(g.ends_at, "R")}` },
      { ephemeral: true }
    );
  }

  // المسار الأصلي عند تعطيل الإضافة
  const giveaway = ctx.app.giveaways.create({
    guildId: ctx.guild.id,
    channelId: opts.channel.id,
    prize: opts.prize,
    winnersCount: opts.winners || 1,
    hostId: ctx.user.id,
    requiredRoleId: opts.requiredRoleId,
    bonusRoleId: opts.bonusRoleId,
    bonusEntries: opts.bonusEntries || 1,
    minAccountAgeMs: opts.minAccountAgeMs,
    endsAt: Date.now() + opts.durationMs
  });
  const message = await opts.channel.send({ embeds: [ctx.app.giveawayService.buildEmbed(giveaway)], components: ctx.app.giveawayService.buttons(giveaway) });
  ctx.app.giveaways.setMessage(giveaway.id, message.id);
  ctx.app.bus.emitSafe("giveaway:created", { guildId: ctx.guild.id, giveaway, hostId: ctx.user.id });
  return ctx.reply(
    { content: `${ctx.emoji("success")} تم بدء السحب رقم \`${giveaway.id}\` في <#${opts.channel.id}> — ينتهي ${timestamp(giveaway.ends_at, "R")}` },
    { ephemeral: true }
  );
}

async function refreshMessage(app, giveaway) {
  if (!giveaway?.message_id || giveaway.status !== "active") return;
  const channel = await app.client.channels.fetch(giveaway.channel_id).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(giveaway.message_id).catch(() => null) : null;
  if (message) await message.edit({ embeds: [app.giveawayService.buildEmbed(giveaway)], components: app.giveawayService.buttons(giveaway) }).catch(() => {});
}
