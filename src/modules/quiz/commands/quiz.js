const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, truncate } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "اختبار",
    aliases: ["quiz", "تفعيل"],
    description: "إدارة اختبار التفعيل: أسئلة نعم/لا، درجة النجاح، ورتبة التفعيل.",
    usage: "/quiz add question:الرول بلاي هو تقمص الشخصية؟ correct:نعم",
    arguments: [
      { name: "add", required: false, description: "إضافة سؤال" },
      { name: "remove", required: false, description: "حذف سؤال برقمه" },
      { name: "list", required: false, description: "عرض الأسئلة" },
      { name: "settings", required: false, description: "ضبط درجة النجاح ورتبة التفعيل" },
      { name: "panel", required: false, description: "نشر لوحة بدء الاختبار في قناة" }
    ],
    examples: [
      "/quiz add question:الرول بلاي هو تقمص الشخصية؟ correct:نعم",
      "/quiz settings pass-score:8 role:@مفعل",
      "/quiz panel"
    ],
    category: "quiz",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("اختبار")
      .setDescription("اختبار التفعيل")
      .addSubcommand((s) =>
        s.setName("add").setDescription("إضافة سؤال")
          .addStringOption((o) => o.setName("question").setDescription("نص السؤال").setRequired(true).setMaxLength(500))
          .addStringOption((o) =>
            o.setName("correct").setDescription("الإجابة الصحيحة").setRequired(true)
              .addChoices({ name: "نعم", value: "yes" }, { name: "لا", value: "no" })
          )
      )
      .addSubcommand((s) =>
        s.setName("remove").setDescription("حذف سؤال")
          .addIntegerOption((o) => o.setName("position").setDescription("رقم السؤال").setRequired(true).setMinValue(1))
      )
      .addSubcommand((s) => s.setName("list").setDescription("عرض الأسئلة"))
      .addSubcommand((s) =>
        s.setName("settings").setDescription("إعدادات الاختبار")
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل النظام"))
          .addIntegerOption((o) => o.setName("pass-score").setDescription("عدد الإجابات الصحيحة المطلوبة").setMinValue(1))
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة عند النجاح"))
          .addChannelOption((o) => o.setName("results").setDescription("قناة نشر النتائج").addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) =>
        s.setName("panel").setDescription("نشر لوحة بدء الاختبار")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;

      if (sub === "add") {
        if (ctx.app.quiz.count(guildId) >= 50) {
          return ctx.fail("errors.actionFailed", { details: "وصلت للحد الأقصى (50 سؤال)." });
        }
        const position = ctx.app.quiz.addQuestion(
          guildId,
          ctx.interaction.options.getString("question"),
          ctx.interaction.options.getString("correct")
        );
        return ctx.success(`تمت إضافة السؤال رقم \`${position}\`. الإجمالي: \`${ctx.app.quiz.count(guildId)}\``);
      }

      if (sub === "remove") {
        const position = ctx.interaction.options.getInteger("position");
        if (!ctx.app.quiz.removeByPosition(guildId, position)) {
          return ctx.fail("errors.actionFailed", { details: "ما لقيت سؤالًا بهذا الرقم." });
        }
        return ctx.success(`تم حذف السؤال \`${position}\`.`);
      }

      if (sub === "list") {
        const questions = ctx.app.quiz.list(guildId);
        if (!questions.length) return ctx.fail("errors.actionFailed", { details: "ما فيه أسئلة بعد." });
        const cfg = ctx.app.guildConfig.value(guildId, "quiz") || {};
        return ctx.reply({
          embeds: [buildEmbed({
            title: "📝 أسئلة اختبار التفعيل",
            description: questions.map((q) =>
              `\`${q.position}.\` ${truncate(q.text, 150)}\n  الصحيح: **${q.correct === "yes" ? "نعم" : "لا"}**`
            ).join("\n"),
            color: ctx.color("primary"),
            fields: [
              { name: "الحالة", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
              { name: "درجة النجاح", value: `\`${cfg.passScore || Math.ceil(questions.length * 0.7)}\` من \`${questions.length}\``, inline: true },
              { name: "رتبة التفعيل", value: cfg.passRoleId ? `<@&${cfg.passRoleId}>` : "غير محددة", inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      if (sub === "settings") {
        const updates = {};
        const enabled = ctx.interaction.options.getBoolean("enabled");
        const passScore = ctx.interaction.options.getInteger("pass-score");
        const role = ctx.interaction.options.getRole("role");
        const results = ctx.interaction.options.getChannel("results");

        if (enabled !== null) updates["quiz.enabled"] = enabled;
        if (passScore) updates["quiz.passScore"] = passScore;
        if (role) updates["quiz.passRoleId"] = role.id;
        if (results) updates["logs.quiz"] = results.id;

        if (!Object.keys(updates).length) {
          return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
        }

        if (role && role.position >= ctx.guild.members.me.roles.highest.position) {
          return ctx.fail("errors.actionFailed", { details: "رتبة البوت أقل من رتبة التفعيل. ارفعها أولًا." });
        }

        ctx.app.guildConfig.setMany(guildId, updates);
        return ctx.success("تم حفظ إعدادات اختبار التفعيل.");
      }

      // panel
      const channel = ctx.interaction.options.getChannel("channel") || ctx.channel;
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
      await channel.send({
        embeds: [buildEmbed({
          title: "اختبار التفعيل",
          description: "اضغط الزر في الأسفل للبدء باختبار التفعيل.",
          color: ctx.color("primary"),
          timestamp: false
        })],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("quiz:start").setLabel("بدء اختبار التفعيل").setEmoji("📝").setStyle(ButtonStyle.Primary)
        )]
      });
      return ctx.reply({ content: `${ctx.emoji("success")} تم نشر لوحة الاختبار في <#${channel.id}>` }, { ephemeral: true });
    }
  }
];
