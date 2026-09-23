const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, parseDuration, formatDuration, timestamp, truncate } = require("../../../core/utils/helpers");

const SYSTEM = "rp.enabled";

/** أوامر الشرطة: السجن والمطلوبون. */
module.exports = [
  {
    name: "سجن",
    aliases: ["jail"],
    description: "سجن عضو مع حفظ رتبه واستعادتها تلقائيًا عند انتهاء المدة.",
    usage: "/سجن user:@عضو duration:30m reason:السبب",
    arguments: [
      { name: "user", required: true, description: "العضو" },
      { name: "duration", required: true, description: "المدة مثل 30m أو 2h" },
      { name: "reason", required: false, description: "السبب" }
    ],
    examples: ["/سجن user:@أحمد duration:30m reason:سرقة مسلحة"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("سجن")
      .setDescription("سجن عضو")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .addStringOption((o) => o.setName("duration").setDescription("المدة مثل 30m").setRequired(true).setMaxLength(20))
      .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(500))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const user = ctx.interaction.options.getUser("user");
      if (user.bot) return ctx.fail("errors.actionFailed", { details: "ما تقدر تسجن بوتًا." });

      const member = await ctx.guild.members.fetch(user.id).catch(() => null);
      if (!member) return ctx.fail("errors.memberNotFound");

      const durationMs = parseDuration(ctx.interaction.options.getString("duration"));
      if (!durationMs || durationMs < 60000) {
        return ctx.fail("errors.actionFailed", { details: "المدة غير صالحة. أقلها دقيقة، مثل `30m` أو `2h`." });
      }

      // لا يُسجن من هو أعلى أو مساوٍ في التسلسل الإداري
      const check = ctx.app.permissions.canActOn(ctx.member, member);
      if (!check.ok) return ctx.fail("errors.actionFailed", { details: "ما تقدر تسجن عضوًا بمستواك أو أعلى." });

      await ctx.defer();
      const result = await ctx.app.rpService.jail(ctx.guild, member, {
        reason: ctx.interaction.options.getString("reason"),
        durationMs,
        jailedBy: ctx.user.id
      });

      if (!result.ok) {
        const messages = {
          alreadyJailed: "هذا العضو مسجون بالفعل.",
          missingPermission: "البوت يفتقد صلاحية إدارة الرتب."
        };
        return ctx.fail("errors.actionFailed", { details: messages[result.reason] || "تعذّر السجن." });
      }

      return ctx.reply({ embeds: [ctx.app.rpService.jailEmbed(ctx.guild, result.record)] });
    }
  },

  {
    name: "فك_سجن",
    aliases: ["unjail", "فك"],
    description: "إطلاق سراح عضو مسجون واستعادة رتبه المحفوظة.",
    usage: "/فك_سجن user:@عضو",
    arguments: [{ name: "user", required: true, description: "العضو" }],
    examples: ["/فك_سجن user:@أحمد"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("فك_سجن")
      .setDescription("إطلاق سراح مسجون")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const user = ctx.interaction.options.getUser("user");
      const record = ctx.app.rp.activeJail(ctx.guild.id, user.id);
      if (!record) return ctx.fail("errors.actionFailed", { details: `<@${user.id}> ليس مسجونًا حاليًا.` });

      await ctx.defer();
      const result = await ctx.app.rpService.releaseJail(ctx.guild, record, ctx.user.id);
      if (!result.ok) return ctx.fail("errors.actionFailed", { details: "تم الإفراج عنه من مسؤول آخر." });

      return ctx.reply({
        embeds: [buildEmbed({
          title: "🔓 إطلاق سراح",
          description: `تم الإفراج عن <@${user.id}> واستُعيدت \`${result.restored}\` رتبة.`,
          color: ctx.color("success")
        })]
      });
    }
  },

  {
    name: "السجناء",
    aliases: ["jailed", "prisoners"],
    description: "قائمة المسجونين حاليًا مع وقت انتهاء كل مدة.",
    usage: "/السجناء",
    arguments: [],
    examples: ["/السجناء"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder().setName("السجناء").setDescription("قائمة المسجونين"),

    async execute(ctx) {
      const rows = ctx.app.rp.listJailed(ctx.guild.id);
      if (!rows.length) return ctx.success("ما فيه مسجونون حاليًا. 🕊️");

      return ctx.reply({
        embeds: [buildEmbed({
          title: "🔒 المسجونون",
          description: rows
            .map((r) => `<@${r.user_id}> — ينتهي ${timestamp(r.ends_at, "R")}${r.reason ? `\n  السبب: ${truncate(r.reason, 80)}` : ""}`)
            .join("\n"),
          color: ctx.color("danger"),
          footer: `الإجمالي: ${rows.length}`
        })]
      }, { ephemeral: true });
    }
  },

  {
    name: "عفو",
    aliases: ["amnesty"],
    description: "عفو عام: الإفراج عن كل المسجونين دفعة واحدة واستعادة رتبهم.",
    usage: "/عفو",
    arguments: [{ name: "confirm", required: true, description: "تأكيد الإجراء" }],
    examples: ["/عفو confirm:True"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.ADMIN },
    slash: new SlashCommandBuilder()
      .setName("عفو")
      .setDescription("عفو عام عن كل المسجونين")
      .addBooleanOption((o) => o.setName("confirm").setDescription("أؤكد الإفراج عن الجميع").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      if (!ctx.interaction.options.getBoolean("confirm")) {
        return ctx.fail("errors.actionFailed", { details: "لم تؤكد الإجراء." });
      }

      const count = ctx.app.rp.listJailed(ctx.guild.id).length;
      if (!count) return ctx.success("ما فيه مسجونون. 🕊️");

      await ctx.defer();
      const result = await ctx.app.rpService.amnesty(ctx.guild, ctx.user.id);

      return ctx.reply({
        embeds: [buildEmbed({
          title: "🕊️ صدر العفو العام",
          description:
            `أُفرج عن **${result.released}** من أصل **${result.total}** واستُعيدت رتبهم.` +
            (result.failed ? `\n⚠️ تعذّر الإفراج عن **${result.failed}** (غالبًا غادروا السيرفر).` : ""),
          color: ctx.color("success")
        })]
      });
    }
  },

  {
    name: "مطلوب",
    aliases: ["wanted"],
    description: "إدارة قائمة المطلوبين: إضافة، مسح، وعرض.",
    usage: "/مطلوب اضافة user:@عضو reason:السبب",
    arguments: [
      { name: "اضافة", required: false, description: "إضافة عضو للمطلوبين" },
      { name: "مسح", required: false, description: "مسح مطلوبية عضو" },
      { name: "القائمة", required: false, description: "عرض المطلوبين" },
      { name: "فحص", required: false, description: "فحص حالة عضو" }
    ],
    examples: ["/مطلوب اضافة user:@أحمد level:3 reason:سطو", "/مطلوب القائمة"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("مطلوب")
      .setDescription("قائمة المطلوبين")
      .addSubcommand((s) =>
        s.setName("اضافة").setDescription("إضافة مطلوب")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("السبب").setRequired(true).setMaxLength(500))
          .addIntegerOption((o) => o.setName("level").setDescription("درجة الخطورة 1-5").setMinValue(1).setMaxValue(5))
      )
      .addSubcommand((s) =>
        s.setName("مسح").setDescription("مسح مطلوبية عضو")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      )
      .addSubcommand((s) => s.setName("القائمة").setDescription("عرض المطلوبين"))
      .addSubcommand((s) =>
        s.setName("فحص").setDescription("فحص حالة عضو")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const app = ctx.app;
      const level = app.permissions.resolveLevel(ctx.member);

      if (sub === "القائمة") {
        const rows = app.rp.listWanted(guildId);
        if (!rows.length) return ctx.success("قائمة المطلوبين فارغة. 🕊️");
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🚔 قائمة المطلوبين",
            description: rows
              .map((r) => `${"⭐".repeat(Math.min(5, r.level))} <@${r.user_id}> — \`${r.count}\` بلاغ`)
              .join("\n"),
            color: ctx.color("danger")
          })]
        });
      }

      if (sub === "فحص") {
        const user = ctx.interaction.options.getUser("user");
        const wanted = app.rp.activeWanted(guildId, user.id);
        const jail = app.rp.activeJail(guildId, user.id);

        return ctx.reply({
          embeds: [buildEmbed({
            title: "🔎 فحص الحالة",
            description: `<@${user.id}>`,
            color: ctx.color(jail || wanted.length ? "danger" : "success"),
            fields: [
              { name: "السجن", value: jail ? `🔒 مسجون — ينتهي ${timestamp(jail.ends_at, "R")}` : "🟢 غير مسجون" },
              {
                name: "المطلوبية",
                value: wanted.length
                  ? wanted.map((w) => `• ${"⭐".repeat(Math.min(5, w.level))} ${truncate(w.reason || "بلا سبب", 80)}`).join("\n")
                  : "🟢 غير مطلوب"
              }
            ]
          })]
        }, { ephemeral: true });
      }

      // إضافة/مسح: للطاقم فقط
      if (level < Level.STAFF) return ctx.fail("errors.noPermission");
      const user = ctx.interaction.options.getUser("user");
      if (user.bot) return ctx.fail("errors.actionFailed", { details: "البوتات ما تُطلب." });

      if (sub === "اضافة") {
        const record = app.rp.addWanted({
          guildId, userId: user.id,
          level: ctx.interaction.options.getInteger("level") || 1,
          reason: ctx.interaction.options.getString("reason"),
          addedBy: ctx.user.id
        });

        await app.rpService.log(guildId, "rpJail", buildEmbed({
          title: "🚔 مطلوب جديد",
          color: ctx.color("danger"),
          fields: [
            { name: "العضو", value: `<@${user.id}>`, inline: true },
            { name: "الدرجة", value: "⭐".repeat(record.level), inline: true },
            { name: "السبب", value: truncate(record.reason, 500) }
          ]
        }));

        return ctx.success(`صار <@${user.id}> **مطلوبًا** بدرجة ${"⭐".repeat(record.level)}.`);
      }

      const cleared = app.rp.clearWanted(guildId, user.id, ctx.user.id);
      if (!cleared) return ctx.fail("errors.actionFailed", { details: "هذا العضو غير مطلوب أصلًا." });
      return ctx.success(`تم مسح \`${cleared}\` بلاغ مطلوبية عن <@${user.id}>.`);
    }
  }
];
