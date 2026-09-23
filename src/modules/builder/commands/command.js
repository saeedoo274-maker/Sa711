const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, truncate } = require("../../../core/utils/helpers");

const NAME_PATTERN = /^[\p{L}\p{N}_-]{1,32}$/u;

const LEVEL_CHOICES = [
  { name: "الجميع", value: 0 },
  { name: "الطاقم الإداري", value: 1 },
  { name: "المشرفون", value: 2 },
  { name: "الأدمن", value: 3 }
];

module.exports = [
  {
    name: "امر_مخصص",
    aliases: ["command", "امر", "اوامر_مخصصة"],
    description: "إنشاء أوامر مخصصة ترد بإمبيد أو نص، ببريفكس خاص لكل أمر.",
    usage: "/command create name:<الاسم> embed:<اسم الإمبيد> prefix:<->",
    arguments: [
      { name: "create", required: false, description: "إنشاء أمر مخصص جديد" },
      { name: "edit", required: false, description: "تعديل خاصية في أمر موجود" },
      { name: "list", required: false, description: "عرض كل الأوامر المخصصة" },
      { name: "delete", required: false, description: "حذف أمر مخصص" }
    ],
    examples: [
      "/command create name:تفعيل embed:لوحة_التفعيل prefix:-",
      "/command edit name:تفعيل field:البريفكس value:!",
      "/command list"
    ],
    category: "builder",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("امر_مخصص")
      .setDescription("إدارة الأوامر المخصصة")
      .addSubcommand((s) =>
        s.setName("create").setDescription("إنشاء أمر مخصص")
          .addStringOption((o) => o.setName("name").setDescription("اسم الأمر بدون البريفكس").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("embed").setDescription("اسم الإمبيد الذي يرد به الأمر"))
          .addStringOption((o) => o.setName("content").setDescription("نص الرد (لو ما تبي إمبيد)").setMaxLength(1900))
          .addStringOption((o) => o.setName("prefix").setDescription("بريفكس خاص لهذا الأمر، مثل - أو !").setMaxLength(5))
          .addIntegerOption((o) => o.setName("level").setDescription("أقل مستوى يقدر يستخدمه").addChoices(...LEVEL_CHOICES))
          .addBooleanOption((o) => o.setName("ephemeral").setDescription("الرد يشوفه صاحب الأمر فقط"))
          .addBooleanOption((o) => o.setName("delete-trigger").setDescription("حذف رسالة الأمر بعد الرد"))
          .addBooleanOption((o) => o.setName("mentions").setDescription("السماح بمنشن everyone والرتب"))
      )
      .addSubcommand((s) =>
        s.setName("edit").setDescription("تعديل أمر مخصص")
          .addStringOption((o) => o.setName("name").setDescription("اسم الأمر").setRequired(true))
          .addStringOption((o) =>
            o.setName("field").setDescription("الخاصية المراد تعديلها").setRequired(true)
              .addChoices(
                { name: "البريفكس", value: "prefix" },
                { name: "الإمبيد المرتبط", value: "embed_id" },
                { name: "نص الرد", value: "content" },
                { name: "مستوى الصلاحية", value: "min_level" },
                { name: "الرد المخفي", value: "ephemeral" },
                { name: "حذف رسالة الأمر", value: "delete_trigger" },
                { name: "السماح بالمنشن", value: "allow_mentions" },
                { name: "اسم الأمر", value: "name" }
              )
          )
          .addStringOption((o) => o.setName("value").setDescription("القيمة الجديدة (نعم/لا للخيارات، أو النص/الرقم)").setRequired(true))
      )
      .addSubcommand((s) => s.setName("list").setDescription("عرض الأوامر المخصصة"))
      .addSubcommand((s) =>
        s.setName("delete").setDescription("حذف أمر مخصص")
          .addStringOption((o) => o.setName("name").setDescription("اسم الأمر").setRequired(true))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;

      if (sub === "list") {
        const list = ctx.app.customCommands.list(guildId);
        if (!list.length) {
          return ctx.fail("errors.actionFailed", { details: "ما فيه أوامر مخصصة بعد. أنشئ واحدًا بـ `/command create`." });
        }
        const guildPrefix = ctx.app.guildConfig.value(guildId, "prefix");
        return ctx.reply({
          embeds: [
            buildEmbed({
              title: "⌨️ الأوامر المخصصة",
              description: list
                .map((c) => {
                  const embedName = c.embed_id ? ctx.app.embeds.get(c.embed_id)?.name || "(محذوف)" : "—";
                  return `\`${c.prefix || guildPrefix}${c.name}\` → إمبيد: **${embedName}** • مستوى: \`${c.min_level}\` • استُخدم \`${c.uses}\` مرة`;
                })
                .join("\n"),
              color: ctx.color("primary"),
              footer: `الإجمالي: ${list.length}`
            })
          ]
        }, { ephemeral: true });
      }

      const name = ctx.interaction.options.getString("name").trim();

      if (sub === "delete") {
        const deleted = ctx.app.customCommands.delete(guildId, name);
        if (!deleted) return ctx.fail("errors.actionFailed", { details: `ما لقيت أمرًا اسمه \`${name}\`.` });
        ctx.app.customCommands.invalidate(guildId);
        return ctx.success(`تم حذف الأمر \`${name}\`.`);
      }

      if (sub === "create") {
        if (!NAME_PATTERN.test(name)) {
          return ctx.fail("errors.actionFailed", { details: "اسم الأمر بدون مسافات، وحتى 32 حرفًا." });
        }
        if (ctx.app.registry.get(name)) {
          return ctx.fail("errors.actionFailed", { details: `\`${name}\` اسم أمر أساسي في البوت. اختر اسمًا ثانيًا.` });
        }
        if (ctx.app.customCommands.getByName(guildId, name)) {
          return ctx.fail("errors.actionFailed", { details: `فيه أمر مخصص بنفس الاسم \`${name}\`.` });
        }
        if (ctx.app.customCommands.count(guildId) >= 200) {
          return ctx.fail("errors.actionFailed", { details: "وصلت للحد الأقصى (200 أمر لكل سيرفر)." });
        }

        const embedName = ctx.interaction.options.getString("embed");
        const content = ctx.interaction.options.getString("content");
        if (!embedName && !content) {
          return ctx.fail("errors.actionFailed", { details: "لازم تحدد `embed` أو `content` على الأقل." });
        }

        let embedId = null;
        if (embedName) {
          const record = ctx.app.embeds.getByName(guildId, embedName.trim());
          if (!record) return ctx.fail("errors.actionFailed", { details: `ما لقيت إمبيد اسمه \`${embedName}\`.` });
          embedId = record.id;
        }

        const prefix = ctx.interaction.options.getString("prefix")?.trim() || null;
        if (prefix && /\s/.test(prefix)) {
          return ctx.fail("errors.actionFailed", { details: "البريفكس ما يصلح فيه مسافات." });
        }

        const created = ctx.app.customCommands.create({
          guildId,
          name,
          prefix,
          embedId,
          content,
          minLevel: ctx.interaction.options.getInteger("level") || 0,
          ephemeral: ctx.interaction.options.getBoolean("ephemeral"),
          deleteTrigger: ctx.interaction.options.getBoolean("delete-trigger"),
          allowMentions: ctx.interaction.options.getBoolean("mentions"),
          createdBy: ctx.user.id
        });
        ctx.app.customCommands.invalidate(guildId);

        const shown = created.prefix || ctx.app.guildConfig.value(guildId, "prefix");
        return ctx.success(`تم إنشاء الأمر \`${shown}${name}\`. جرّبه في أي قناة.`);
      }

      // edit
      const record = ctx.app.customCommands.getByName(guildId, name);
      if (!record) return ctx.fail("errors.actionFailed", { details: `ما لقيت أمرًا اسمه \`${name}\`.` });

      const field = ctx.interaction.options.getString("field");
      const raw = ctx.interaction.options.getString("value").trim();
      let value = raw;

      const booleanFields = ["ephemeral", "delete_trigger", "allow_mentions"];
      if (booleanFields.includes(field)) {
        value = ["نعم", "yes", "true", "1"].includes(raw.toLowerCase()) ? 1 : 0;
      } else if (field === "min_level") {
        const level = parseInt(raw, 10);
        if (isNaN(level) || level < 0 || level > 3) {
          return ctx.fail("errors.actionFailed", { details: "المستوى لازم يكون رقمًا من 0 إلى 3." });
        }
        value = level;
      } else if (field === "embed_id") {
        const target = ctx.app.embeds.getByName(guildId, raw);
        if (!target) return ctx.fail("errors.actionFailed", { details: `ما لقيت إمبيد اسمه \`${raw}\`.` });
        value = target.id;
      } else if (field === "prefix") {
        if (/\s/.test(raw)) return ctx.fail("errors.actionFailed", { details: "البريفكس ما يصلح فيه مسافات." });
        value = raw === "-" && record.prefix === "-" ? raw : raw;
      } else if (field === "name") {
        if (!NAME_PATTERN.test(raw)) return ctx.fail("errors.actionFailed", { details: "الاسم الجديد بدون مسافات." });
        if (ctx.app.registry.get(raw) || ctx.app.customCommands.getByName(guildId, raw)) {
          return ctx.fail("errors.actionFailed", { details: `الاسم \`${raw}\` مستخدم من قبل.` });
        }
        value = raw;
      }

      ctx.app.customCommands.update(record.id, field, value);
      ctx.app.customCommands.invalidate(guildId);
      return ctx.success(`تم تعديل \`${field}\` في الأمر \`${name}\` إلى \`${truncate(String(raw), 100)}\``);
    }
  }
];
