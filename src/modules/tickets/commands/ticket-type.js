const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const crypto = require("crypto");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, truncate } = require("../../../core/utils/helpers");

const NAME_PATTERN = /^[\p{L}\p{N}_-]{2,32}$/u;

module.exports = [
  {
    name: "نوع_تذكرة",
    aliases: ["ticket-type"],
    description: "إنشاء أنواع تذاكر، كل نوع بكاتيغوري ورتبة دعم ونموذج أسئلة خاص.",
    usage: "/ticket-type create name:طلب_نيترو label:طلب نيترو category:#الطلبات",
    arguments: [
      { name: "create", required: false, description: "إنشاء نوع تذكرة جديد" },
      { name: "form", required: false, description: "ضبط أسئلة النموذج (حتى 5 أسئلة)" },
      { name: "edit", required: false, description: "تعديل خاصية في نوع موجود" },
      { name: "list", required: false, description: "عرض كل الأنواع مع معرّفاتها" },
      { name: "delete", required: false, description: "حذف نوع تذكرة" }
    ],
    examples: [
      "/ticket-type create name:طلب_نيترو label:طلب نيترو category:#الطلبات",
      "/ticket-type form name:طلب_نيترو q1:المنصة المطلوبة q2:المدة",
      "/ticket-type list"
    ],
    category: "tickets",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("نوع_تذكرة")
      .setDescription("إدارة أنواع التذاكر")
      .addSubcommand((s) =>
        s.setName("create").setDescription("إنشاء نوع تذكرة")
          .addStringOption((o) => o.setName("name").setDescription("اسم مختصر بدون مسافات").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("label").setDescription("الاسم الظاهر للأعضاء").setRequired(true).setMaxLength(80))
          .addStringOption((o) => o.setName("description").setDescription("وصف قصير").setMaxLength(100))
          .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(32))
          .addChannelOption((o) => o.setName("category").setDescription("كاتيغوري التذاكر").addChannelTypes(ChannelType.GuildCategory))
          .addRoleOption((o) => o.setName("staff").setDescription("رتبة الدعم لهذا النوع"))
          .addStringOption((o) => o.setName("channel-name").setDescription("قالب اسم القناة، مثل: نيترو-{username}").setMaxLength(90))
          .addIntegerOption((o) => o.setName("max-open").setDescription("كم تذكرة مفتوحة يسمح بها للعضو").setMinValue(1).setMaxValue(5))
      )
      .addSubcommand((s) =>
        s.setName("form").setDescription("ضبط أسئلة النموذج")
          .addStringOption((o) => o.setName("name").setDescription("اسم النوع").setRequired(true))
          .addStringOption((o) => o.setName("q1").setDescription("السؤال الأول").setMaxLength(45))
          .addStringOption((o) => o.setName("q2").setDescription("السؤال الثاني").setMaxLength(45))
          .addStringOption((o) => o.setName("q3").setDescription("السؤال الثالث").setMaxLength(45))
          .addStringOption((o) => o.setName("q4").setDescription("السؤال الرابع").setMaxLength(45))
          .addStringOption((o) => o.setName("q5").setDescription("السؤال الخامس").setMaxLength(45))
          .addStringOption((o) => o.setName("long").setDescription("أرقام الأسئلة الطويلة مفصولة بفاصلة، مثل: 2,3").setMaxLength(20))
          .addBooleanOption((o) => o.setName("clear").setDescription("حذف كل الأسئلة"))
      )
      .addSubcommand((s) =>
        s.setName("edit").setDescription("تعديل نوع تذكرة")
          .addStringOption((o) => o.setName("name").setDescription("اسم النوع").setRequired(true))
          .addStringOption((o) =>
            o.setName("field").setDescription("الخاصية").setRequired(true)
              .addChoices(
                { name: "الاسم الظاهر", value: "label" },
                { name: "الوصف", value: "description" },
                { name: "الإيموجي", value: "emoji" },
                { name: "الكاتيغوري", value: "category_id" },
                { name: "رتبة الدعم", value: "staff_role_id" },
                { name: "إمبيد الترحيب", value: "welcome_embed_id" },
                { name: "قالب اسم القناة", value: "name_template" },
                { name: "أقصى تذاكر مفتوحة", value: "max_open" }
              )
          )
          .addStringOption((o) => o.setName("value").setDescription("القيمة الجديدة (آيدي أو اسم إمبيد أو نص)").setRequired(true))
      )
      .addSubcommand((s) => s.setName("list").setDescription("عرض أنواع التذاكر"))
      .addSubcommand((s) =>
        s.setName("delete").setDescription("حذف نوع تذكرة")
          .addStringOption((o) => o.setName("name").setDescription("اسم النوع").setRequired(true))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;

      if (sub === "list") {
        const types = ctx.app.ticketTypes.list(guildId);
        if (!types.length) {
          return ctx.fail("errors.actionFailed", { details: "ما فيه أنواع تذاكر بعد. أنشئ واحدًا بـ `/ticket-type create`." });
        }
        return ctx.reply({
          embeds: [
            buildEmbed({
              title: "🎫 أنواع التذاكر",
              description: types
                .map((t) =>
                  `${t.emoji || "•"} **${t.label}** — \`${t.name}\`\n` +
                  `  الكاتيغوري: ${t.category_id ? `<#${t.category_id}>` : "الافتراضية"} • ` +
                  `الدعم: ${t.staff_role_id ? `<@&${t.staff_role_id}>` : "رتبة الطاقم"} • ` +
                  `أسئلة: \`${t.questions.length}\`\n` +
                  `  في اللوحات اكتب: \`ticket:${t.name}\``
                )
                .join("\n\n"),
              color: ctx.color("primary"),
              footer: `الإجمالي: ${types.length}`
            })
          ]
        }, { ephemeral: true });
      }

      const name = ctx.interaction.options.getString("name").trim();

      if (sub === "create") {
        if (!NAME_PATTERN.test(name)) {
          return ctx.fail("errors.actionFailed", { details: "الاسم من 2 إلى 32 حرفًا بدون مسافات (استخدم `_`)." });
        }
        if (ctx.app.ticketTypes.getByName(guildId, name)) {
          return ctx.fail("errors.actionFailed", { details: `فيه نوع بنفس الاسم \`${name}\`.` });
        }
        if (ctx.app.ticketTypes.count(guildId) >= 50) {
          return ctx.fail("errors.actionFailed", { details: "وصلت للحد الأقصى (50 نوع لكل سيرفر)." });
        }

        const type = ctx.app.ticketTypes.create({
          id: crypto.randomBytes(6).toString("hex"),
          guildId,
          name,
          label: ctx.interaction.options.getString("label"),
          description: ctx.interaction.options.getString("description"),
          emoji: ctx.interaction.options.getString("emoji"),
          categoryId: ctx.interaction.options.getChannel("category")?.id || null,
          staffRoleId: ctx.interaction.options.getRole("staff")?.id || null,
          nameTemplate: ctx.interaction.options.getString("channel-name"),
          maxOpen: ctx.interaction.options.getInteger("max-open") || 1
        });

        return ctx.success(
          `تم إنشاء نوع التذكرة **${type.label}**\n` +
          `أضف أسئلة بـ \`/ticket-type form name:${name}\`\n` +
          `واربطه بزر أو خيار قائمة بكتابة الإجراء: \`ticket:${name}\``
        );
      }

      const type = ctx.app.ticketTypes.getByName(guildId, name);
      if (!type) return ctx.fail("errors.actionFailed", { details: `ما لقيت نوعًا اسمه \`${name}\`.` });

      if (sub === "delete") {
        ctx.app.ticketTypes.delete(guildId, name);
        return ctx.success(`تم حذف نوع التذكرة \`${name}\`. الأزرار المرتبطة به راح تتوقف.`);
      }

      if (sub === "form") {
        if (ctx.interaction.options.getBoolean("clear")) {
          ctx.app.ticketTypes.setQuestions(type.id, []);
          return ctx.success(`تم حذف كل أسئلة **${type.label}**. التذكرة راح تنفتح مباشرة بدون نموذج.`);
        }

        const longIndexes = new Set(
          (ctx.interaction.options.getString("long") || "")
            .split(",")
            .map((n) => parseInt(n.trim(), 10))
            .filter((n) => !isNaN(n))
        );

        const questions = [];
        for (let i = 1; i <= 5; i++) {
          const label = ctx.interaction.options.getString(`q${i}`);
          if (!label) continue;
          questions.push({ label: label.trim(), long: longIndexes.has(i), required: true });
        }

        if (!questions.length) {
          return ctx.fail("errors.actionFailed", { details: "أدخل سؤالًا واحدًا على الأقل، أو استخدم `clear:true` للحذف." });
        }

        ctx.app.ticketTypes.setQuestions(type.id, questions);
        return ctx.success(
          `تم ضبط نموذج **${type.label}** بـ \`${questions.length}\` سؤال:\n` +
          questions.map((q, i) => `\`${i + 1}.\` ${q.label}${q.long ? " *(طويل)*" : ""}`).join("\n")
        );
      }

      // edit
      const field = ctx.interaction.options.getString("field");
      const raw = ctx.interaction.options.getString("value").trim();
      let value = raw;

      if (field === "category_id" || field === "staff_role_id") {
        const id = raw.match(/\d{15,25}/)?.[0];
        if (!id) return ctx.fail("errors.actionFailed", { details: "أدخل آيدي صالحًا أو منشن." });
        value = id;
      } else if (field === "welcome_embed_id") {
        const record = ctx.app.embeds.getByName(guildId, raw);
        if (!record) return ctx.fail("errors.actionFailed", { details: `ما لقيت إمبيد اسمه \`${raw}\`.` });
        value = record.id;
      } else if (field === "max_open") {
        const n = parseInt(raw, 10);
        if (isNaN(n) || n < 1 || n > 5) return ctx.fail("errors.actionFailed", { details: "رقم من 1 إلى 5." });
        value = n;
      }

      ctx.app.ticketTypes.update(type.id, field, value);
      return ctx.success(`تم تعديل \`${field}\` في **${type.label}** إلى \`${truncate(raw, 100)}\``);
    }
  }
];
