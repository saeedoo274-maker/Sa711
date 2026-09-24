const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { AttachmentBuilder } = require("discord.js");
const { buildEmbed, truncate, parseDuration, formatDuration } = require("../../../core/utils/helpers");
const variables = require("../../../core/utils/variables");
const { validateUrl, safeFetch } = require("../../../core/utils/safeFetch");

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
      { name: "delete", required: false, description: "حذف أمر مخصص" },
      { name: "alias", required: false, description: "أسماء بديلة للأمر" },
      { name: "response", required: false, description: "ردود متعددة (عشوائي/كلها)" },
      { name: "rules", required: false, description: "رتب، قنوات، تبريد، وسائط، خاص، Webhook، API، مرفق" },
      { name: "button / select", required: false, description: "أزرار روابط أو ردود، وقائمة اختيار" },
      { name: "info / export / import", required: false, description: "تفاصيل، تصدير واستيراد JSON" }
    ],
    examples: [
      "/command create name:تفعيل embed:لوحة_التفعيل prefix:-",
      "/command edit name:تفعيل field:البريفكس value:!",
      "/command list",
      "/command response name:نكتة action:add text:{USER} ضحك 😂",
      "/command rules name:طقس min-args:1 api-url:https://api.example.com/weather?q={ARG1}"
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
          .addStringOption((o) => o.setName("name").setDescription("اسم الأمر").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((s) =>
        s.setName("alias").setDescription("اسم بديل")
          .addStringOption((o) => o.setName("name").setDescription("اسم الأمر").setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName("action").setDescription("الإجراء").setRequired(true).addChoices({ name: "إضافة", value: "add" }, { name: "حذف", value: "remove" }))
          .addStringOption((o) => o.setName("alias").setDescription("الاسم البديل").setRequired(true).setMaxLength(32))
      )
      .addSubcommand((s) =>
        s.setName("response").setDescription("ردود متعددة")
          .addStringOption((o) => o.setName("name").setDescription("اسم الأمر").setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName("action").setDescription("الإجراء").setRequired(true)
            .addChoices({ name: "إضافة رد", value: "add" }, { name: "حذف رد", value: "remove" }, { name: "مسح الكل", value: "clear" }, { name: "الوضع", value: "mode" }))
          .addStringOption((o) => o.setName("text").setDescription("نص الرد — يدعم {ARG1} {ARGS} {API:path} والمتغيرات").setMaxLength(1900).setAutocomplete(true))
          .addIntegerOption((o) => o.setName("index").setDescription("رقم الرد للحذف").setMinValue(1).setMaxValue(20))
          .addStringOption((o) => o.setName("mode").setDescription("الوضع").addChoices({ name: "واحد (الأساسي)", value: "single" }, { name: "عشوائي", value: "random" }, { name: "كلها بالترتيب", value: "all" }))
      )
      .addSubcommand((s) =>
        s.setName("rules").setDescription("شروط وخيارات التشغيل")
          .addStringOption((o) => o.setName("name").setDescription("اسم الأمر").setRequired(true).setAutocomplete(true))
          .addRoleOption((o) => o.setName("role").setDescription("رتبة مطلوبة (تبديل)"))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة مسموحة (تبديل)"))
          .addStringOption((o) => o.setName("cooldown").setDescription("تبريد لكل عضو مثل 30s (0 = بلا)"))
          .addIntegerOption((o) => o.setName("min-args").setDescription("أقل عدد وسائط").setMinValue(0).setMaxValue(9))
          .addStringOption((o) => o.setName("usage").setDescription("شرح الاستخدام").setMaxLength(100))
          .addBooleanOption((o) => o.setName("dm").setDescription("الرد في الخاص"))
          .addBooleanOption((o) => o.setName("reply").setDescription("الرد كـ Reply على الرسالة"))
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل الأمر"))
          .addStringOption((o) => o.setName("webhook-name").setDescription("الرد عبر Webhook بهذا الاسم (- للإلغاء)").setMaxLength(80))
          .addStringOption((o) => o.setName("webhook-avatar").setDescription("صورة الـ Webhook (رابط https)").setMaxLength(300))
          .addStringOption((o) => o.setName("api-url").setDescription("رابط API يرجع JSON (https فقط، - للإلغاء)").setMaxLength(400))
          .addStringOption((o) => o.setName("attachment").setDescription("رابط مرفق https (تبديل)").setMaxLength(400))
      )
      .addSubcommand((s) =>
        s.setName("button").setDescription("أزرار الأمر")
          .addStringOption((o) => o.setName("name").setDescription("اسم الأمر").setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName("action").setDescription("الإجراء").setRequired(true)
            .addChoices({ name: "زر رابط", value: "link" }, { name: "زر رد مخفي", value: "reply" }, { name: "مسح الأزرار", value: "clear" }))
          .addStringOption((o) => o.setName("label").setDescription("نص الزر").setMaxLength(80))
          .addStringOption((o) => o.setName("url").setDescription("الرابط (لزر الرابط)").setMaxLength(400))
          .addStringOption((o) => o.setName("response").setDescription("الرد المخفي (لزر الرد)").setMaxLength(1900))
          .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(64))
      )
      .addSubcommand((s) =>
        s.setName("select").setDescription("قائمة اختيار")
          .addStringOption((o) => o.setName("name").setDescription("اسم الأمر").setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName("action").setDescription("الإجراء").setRequired(true).addChoices({ name: "إضافة خيار", value: "add" }, { name: "مسح القائمة", value: "clear" }))
          .addStringOption((o) => o.setName("label").setDescription("اسم الخيار").setMaxLength(100))
          .addStringOption((o) => o.setName("response").setDescription("الرد المخفي عند اختياره").setMaxLength(1900))
          .addStringOption((o) => o.setName("description").setDescription("وصف الخيار").setMaxLength(100))
          .addStringOption((o) => o.setName("placeholder").setDescription("نص القائمة").setMaxLength(150))
      )
      .addSubcommand((s) => s.setName("info").setDescription("تفاصيل أمر").addStringOption((o) => o.setName("name").setDescription("اسم الأمر").setRequired(true).setAutocomplete(true)))
      .addSubcommand((s) => s.setName("export").setDescription("تصدير كل الأوامر كملف JSON"))
      .addSubcommand((s) =>
        s.setName("import").setDescription("استيراد أوامر من ملف JSON")
          .addAttachmentOption((o) => o.setName("file").setDescription("ملف التصدير").setRequired(true))
          .addBooleanOption((o) => o.setName("overwrite").setDescription("استبدال الأوامر الموجودة بنفس الاسم"))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async autocomplete(interaction, app) {
      const focused = interaction.options.getFocused(true);
      if (focused.name === "text") {
        return interaction.respond(variables.suggest(focused.value, 25).map((v) => ({ name: v.slice(0, 100), value: v.slice(0, 100) })));
      }
      const typed = String(focused.value || "").toLowerCase();
      const list = app.customCommands.list(interaction.guild.id).filter((c) => c.name.toLowerCase().includes(typed)).slice(0, 25);
      return interaction.respond(list.map((c) => ({ name: c.name, value: c.name })));
    },

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;

      if (sub === "export") {
        const data = ctx.app.customCommandService.exportAll(guildId);
        if (!data.commands.length) return ctx.fail("errors.actionFailed", { details: "ما فيه أوامر مخصصة للتصدير." });
        const file = new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2), "utf8"), { name: `custom-commands-${guildId}.json` });
        return ctx.reply({ content: `${ctx.emoji("success")} تم تصدير \`${data.commands.length}\` أمر.`, files: [file] }, { ephemeral: true });
      }

      if (sub === "import") {
        const att = ctx.interaction.options.getAttachment("file");
        if (!att || att.size > 512 * 1024 || !/\.json$/i.test(att.name || "")) return ctx.fail("errors.actionFailed", { details: "أرفق ملف JSON (حتى 512KB)." });
        const res = await safeFetch(att.url, { json: true, maxBytes: 512 * 1024, timeoutMs: 8000 });
        if (!res.ok) return ctx.fail("errors.actionFailed", { details: `تعذر قراءة الملف (${res.reason}).` });
        const report = ctx.app.customCommandService.importAll(guildId, res.json, {
          overwrite: !!ctx.interaction.options.getBoolean("overwrite"),
          userId: ctx.user.id,
          isReserved: (n) => !!ctx.app.registry.get(n),
          validateUrl: (u) => validateUrl(String(u || "")).ok
        });
        if (!report.ok) return ctx.fail("errors.actionFailed", { details: "صيغة الملف غير صحيحة." });
        return ctx.success(`تم الاستيراد: جديد \`${report.created}\` • محدَّث \`${report.updated}\` • متخطى \`${report.skipped.length}\`${report.skipped.length ? `\n-# ${truncate(report.skipped.join("، "), 300)}` : ""}`);
      }

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
        // الأسماء البديلة تُحذف مع الأمر في نفس المعاملة
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
        if (ctx.app.customCommands.getByName(guildId, name) || ctx.app.customCommands.aliasOwner(guildId, name)) {
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

      if (["alias", "response", "rules", "button", "select", "info"].includes(sub)) {
        const cmd = ctx.app.customCommands.getByName(guildId, name);
        if (!cmd) return ctx.fail("errors.actionFailed", { details: `ما لقيت أمرًا اسمه \`${name}\`.` });
        return manage(ctx, sub, cmd);
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

async function manage(ctx, sub, cmd) {
  const app = ctx.app;
  const o = ctx.interaction.options;
  const guildId = ctx.guild.id;
  const x = app.customCommandService.constructor.extras(cmd);
  const save = (fields) => {
    const updated = app.customCommands.updateExtras(cmd.id, fields);
    app.customCommands.invalidate(guildId);
    return updated;
  };

  if (sub === "info") {
    const aliases = app.customCommands.aliasesOf(cmd.id);
    const prefix = cmd.prefix || app.guildConfig.value(guildId, "prefix");
    return ctx.reply({
      embeds: [buildEmbed({
        title: `⌨️ ${prefix}${cmd.name}`,
        color: ctx.color(cmd.enabled === 0 ? "neutral" : "primary"),
        fields: [
          { name: "الحالة", value: cmd.enabled === 0 ? "⚪ معطّل" : "🟢 مفعّل", inline: true },
          { name: "الاستخدامات", value: `\`${cmd.uses}\``, inline: true },
          { name: "المستوى", value: `\`${cmd.min_level}\``, inline: true },
          { name: "أسماء بديلة", value: aliases.map((a) => `\`${a}\``).join(" ") || "—", inline: true },
          { name: "التبريد", value: cmd.cooldown_ms ? formatDuration(cmd.cooldown_ms) : "—", inline: true },
          { name: "الوسائط", value: cmd.min_args ? `${cmd.min_args}+ ${cmd.usage ? `\`${cmd.usage}\`` : ""}` : "—", inline: true },
          { name: "الرتب", value: x.roles.map((r) => `<@&${r}>`).join(" ") || "—", inline: true },
          { name: "القنوات", value: x.channels.map((c) => `<#${c}>`).join(" ") || "—", inline: true },
          { name: "التسليم", value: [cmd.dm ? "خاص" : null, cmd.reply ? "Reply" : null, cmd.webhook_name ? `Webhook: ${cmd.webhook_name}` : null].filter(Boolean).join(" • ") || "القناة", inline: true },
          { name: `الردود (${x.mode})`, value: truncate(x.responses.map((r, i) => `**${i + 1}.** ${r}`).join("\n") || cmd.content || "—", 1024) },
          { name: "مكونات", value: `أزرار: ${(x.components.buttons || []).length} • خيارات القائمة: ${(x.components.select?.options || []).length} • مرفقات: ${x.attachments.length}`, inline: true },
          { name: "API", value: cmd.api_url ? `\`${truncate(cmd.api_url, 200)}\`` : "—", inline: true }
        ]
      })],
      allowedMentions: { parse: [] }
    }, { ephemeral: true });
  }

  if (sub === "alias") {
    const alias = o.getString("alias").trim();
    if (o.getString("action") === "remove") {
      if (app.customCommands.aliasOwner(guildId, alias) !== cmd.id) return ctx.fail("errors.actionFailed", { details: "هذا ليس اسمًا بديلًا لهذا الأمر." });
      app.customCommands.removeAlias(guildId, alias);
      app.customCommands.invalidate(guildId);
      return ctx.success(`تم حذف الاسم البديل \`${alias}\`.`);
    }
    if (!NAME_PATTERN.test(alias)) return ctx.fail("errors.actionFailed", { details: "الاسم البديل بدون مسافات، وحتى 32 حرفًا." });
    if (app.registry.get(alias) || app.customCommands.getByName(guildId, alias) || app.customCommands.aliasOwner(guildId, alias)) {
      return ctx.fail("errors.actionFailed", { details: `الاسم \`${alias}\` مستخدم من قبل.` });
    }
    if (app.customCommands.aliasesOf(cmd.id).length >= 10) return ctx.fail("errors.actionFailed", { details: "أقصى عدد 10 أسماء بديلة." });
    app.customCommands.addAlias(guildId, cmd.id, alias);
    app.customCommands.invalidate(guildId);
    return ctx.success(`تمت إضافة الاسم البديل \`${alias}\` للأمر \`${cmd.name}\`.`);
  }

  if (sub === "response") {
    const action = o.getString("action");
    const responses = [...x.responses];
    if (action === "clear") {
      save({ responses: [], response_mode: "single" });
      return ctx.success("تم مسح الردود الإضافية.");
    }
    if (action === "mode") {
      const mode = o.getString("mode");
      if (!mode) return ctx.fail("errors.actionFailed", { details: "حدد الوضع." });
      if (mode !== "single" && !responses.length) return ctx.fail("errors.actionFailed", { details: "أضف ردودًا أولًا." });
      save({ response_mode: mode });
      return ctx.success(`وضع الردود: \`${mode}\``);
    }
    if (action === "remove") {
      const index = (o.getInteger("index") || 0) - 1;
      if (index < 0 || index >= responses.length) return ctx.fail("errors.actionFailed", { details: "رقم رد غير صحيح." });
      responses.splice(index, 1);
      save({ responses, ...(responses.length ? {} : { response_mode: "single" }) });
      return ctx.success(`تم حذف الرد رقم ${index + 1}.`);
    }
    const text = o.getString("text");
    if (!text) return ctx.fail("errors.actionFailed", { details: "اكتب نص الرد." });
    if (responses.length >= 20) return ctx.fail("errors.actionFailed", { details: "أقصى عدد 20 ردًا." });
    responses.push(text);
    save({ responses, response_mode: x.mode === "single" ? "random" : x.mode });
    return ctx.success(`تمت إضافة الرد (${responses.length}) — الوضع: \`${x.mode === "single" ? "random" : x.mode}\``);
  }

  if (sub === "rules") {
    const fields = {};
    const notes = [];
    const role = o.getRole("role");
    if (role) {
      const set = new Set(x.roles);
      set.has(role.id) ? set.delete(role.id) : set.add(role.id);
      fields.required_roles = [...set];
      notes.push(`${set.has(role.id) ? "➕" : "➖"} <@&${role.id}>`);
    }
    const channel = o.getChannel("channel");
    if (channel) {
      const set = new Set(x.channels);
      set.has(channel.id) ? set.delete(channel.id) : set.add(channel.id);
      fields.allowed_channels = [...set];
      notes.push(`${set.has(channel.id) ? "➕" : "➖"} <#${channel.id}>`);
    }
    const cooldown = o.getString("cooldown");
    if (cooldown !== null) {
      const ms = cooldown.trim() === "0" ? 0 : parseDuration(cooldown);
      if (ms === null || ms === undefined || ms > 86_400_000 || (ms === 0 && cooldown.trim() !== "0")) return ctx.fail("errors.invalidDuration");
      fields.cooldown_ms = ms;
    }
    if (o.getInteger("min-args") !== null) fields.min_args = o.getInteger("min-args");
    if (o.getString("usage") !== null) fields.usage = o.getString("usage");
    for (const [opt, col] of [["dm", "dm"], ["reply", "reply"], ["enabled", "enabled"]]) {
      if (o.getBoolean(opt) !== null) fields[col] = o.getBoolean(opt) ? 1 : 0;
    }
    const hookName = o.getString("webhook-name");
    if (hookName !== null) fields.webhook_name = hookName.trim() === "-" ? null : hookName.trim();
    const hookAvatar = o.getString("webhook-avatar");
    if (hookAvatar !== null) {
      if (hookAvatar.trim() !== "-" && !validateUrl(hookAvatar.trim()).ok) return ctx.fail("errors.actionFailed", { details: "رابط الصورة يجب أن يكون https عامًا." });
      fields.webhook_avatar = hookAvatar.trim() === "-" ? null : hookAvatar.trim();
    }
    const api = o.getString("api-url");
    if (api !== null) {
      const raw = api.trim();
      if (raw !== "-" && !validateUrl(raw.replace(/\{ARGS?\d?\}/gi, "x")).ok) return ctx.fail("errors.actionFailed", { details: "رابط API يجب أن يكون https عامًا (العناوين الداخلية ممنوعة)." });
      fields.api_url = raw === "-" ? null : raw;
    }
    const attachment = o.getString("attachment");
    if (attachment !== null) {
      const url = attachment.trim();
      const set = new Set(x.attachments);
      if (set.has(url)) set.delete(url);
      else {
        if (!validateUrl(url).ok) return ctx.fail("errors.actionFailed", { details: "رابط المرفق يجب أن يكون https عامًا." });
        if (set.size >= 5) return ctx.fail("errors.actionFailed", { details: "أقصى عدد 5 مرفقات." });
        set.add(url);
      }
      fields.attachments = [...set];
    }
    if (!Object.keys(fields).length) return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
    save(fields);
    return ctx.success(`تم تحديث شروط \`${cmd.name}\`.${notes.length ? `\n${notes.join(" ")}` : ""}`);
  }

  if (sub === "button") {
    const action = o.getString("action");
    const components = { ...x.components };
    if (action === "clear") {
      delete components.buttons;
      save({ components });
      return ctx.success("تم مسح الأزرار.");
    }
    const buttons = [...(components.buttons || [])];
    if (buttons.length >= 5) return ctx.fail("errors.actionFailed", { details: "أقصى عدد 5 أزرار." });
    const label = o.getString("label");
    if (!label) return ctx.fail("errors.actionFailed", { details: "حدد نص الزر." });
    const emoji = o.getString("emoji")?.trim() || null;
    if (action === "link") {
      const url = o.getString("url")?.trim();
      if (!url || !validateUrl(url).ok) return ctx.fail("errors.actionFailed", { details: "رابط الزر يجب أن يكون https." });
      buttons.push({ type: "link", label, url, emoji });
    } else {
      const response = o.getString("response");
      if (!response) return ctx.fail("errors.actionFailed", { details: "اكتب الرد المخفي." });
      buttons.push({ type: "reply", label, response, emoji });
    }
    components.buttons = buttons;
    save({ components });
    return ctx.success(`تمت إضافة الزر (${buttons.length}/5).`);
  }

  // select
  const components = { ...x.components };
  if (o.getString("action") === "clear") {
    delete components.select;
    save({ components });
    return ctx.success("تم مسح القائمة.");
  }
  const select = { placeholder: components.select?.placeholder || "", options: [...(components.select?.options || [])] };
  if (o.getString("placeholder")) select.placeholder = o.getString("placeholder");
  const label = o.getString("label");
  const response = o.getString("response");
  if (!label || !response) return ctx.fail("errors.actionFailed", { details: "حدد اسم الخيار والرد." });
  if (select.options.length >= 25) return ctx.fail("errors.actionFailed", { details: "أقصى عدد 25 خيارًا." });
  select.options.push({ label, response, description: o.getString("description") || null, emoji: null });
  components.select = select;
  save({ components });
  return ctx.success(`تمت إضافة الخيار (${select.options.length}/25).`);
}
