const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, parseDuration, formatDuration, truncate } = require("../../../core/utils/helpers");

const NAME_PATTERN = /^[\p{L}\p{N}_-]{2,32}$/u;

const MATCH_LABELS = {
  contains: "يحتوي على",
  exact: "مطابق تمامًا",
  starts: "يبدأ بـ",
  word: "كلمة مستقلة"
};

module.exports = [
  {
    name: "رد_تلقائي",
    aliases: ["autoreply", "ردود"],
    description: "ردود تلقائية على كلمات مفتاحية، بنص أو إمبيد مصمّم، بشروط قنوات ورتب.",
    usage: "/autoreply create name:الترحيب triggers:سلام,هلا reply:هلا فيك {user}",
    arguments: [
      { name: "create", required: false, description: "إنشاء رد تلقائي" },
      { name: "edit", required: false, description: "تعديل خاصية" },
      { name: "list", required: false, description: "عرض كل الردود" },
      { name: "show", required: false, description: "تفاصيل رد" },
      { name: "delete", required: false, description: "حذف رد" },
      { name: "test", required: false, description: "تجربة نص لمعرفة أي رد سيُطابق" }
    ],
    examples: [
      "/autoreply create name:الترحيب triggers:سلام,هلا,مرحبا reply:هلا فيك {user}",
      "/autoreply create name:القوانين triggers:القوانين embed:لوحة_القوانين match:word",
      "/autoreply test text:سلام عليكم"
    ],
    category: "autoreply",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("رد_تلقائي")
      .setDescription("الردود التلقائية")
      .addSubcommand((s) =>
        s.setName("create").setDescription("إنشاء رد تلقائي")
          .addStringOption((o) => o.setName("name").setDescription("اسم مختصر بدون مسافات").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("triggers").setDescription("الكلمات المفتاحية مفصولة بفاصلة").setRequired(true).setMaxLength(500))
          .addStringOption((o) => o.setName("reply").setDescription("نص الرد").setMaxLength(1900))
          .addStringOption((o) => o.setName("embed").setDescription("اسم إمبيد مصمّم بـ /embed"))
          .addStringOption((o) =>
            o.setName("match").setDescription("نوع المطابقة")
              .addChoices(
                { name: "يحتوي على", value: "contains" },
                { name: "كلمة مستقلة", value: "word" },
                { name: "مطابق تمامًا", value: "exact" },
                { name: "يبدأ بـ", value: "starts" }
              )
          )
          .addStringOption((o) => o.setName("cooldown").setDescription("تبريد لكل عضو، مثل 30s"))
          .addIntegerOption((o) => o.setName("chance").setDescription("نسبة الرد ٪ (افتراضي 100)").setMinValue(1).setMaxValue(100))
          .addBooleanOption((o) => o.setName("reply-to").setDescription("الرد كـ Reply على الرسالة (افتراضي نعم)"))
          .addBooleanOption((o) => o.setName("delete-trigger").setDescription("حذف رسالة العضو بعد الرد"))
      )
      .addSubcommand((s) =>
        s.setName("edit").setDescription("تعديل رد تلقائي")
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true))
          .addStringOption((o) =>
            o.setName("field").setDescription("الخاصية").setRequired(true)
              .addChoices(
                { name: "الكلمات المفتاحية", value: "triggers" },
                { name: "نوع المطابقة", value: "match_type" },
                { name: "نص الرد", value: "reply_text" },
                { name: "الإمبيد المرتبط", value: "embed_id" },
                { name: "التبريد", value: "cooldown_ms" },
                { name: "نسبة الرد", value: "chance" },
                { name: "الرد كـ Reply", value: "reply_to" },
                { name: "حذف رسالة العضو", value: "delete_trigger" },
                { name: "مفعّل", value: "enabled" }
              )
          )
          .addStringOption((o) => o.setName("value").setDescription("القيمة الجديدة").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("channels").setDescription("تقييد الرد بقنوات أو استثناؤها")
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true))
          .addStringOption((o) =>
            o.setName("mode").setDescription("النوع").setRequired(true)
              .addChoices({ name: "يعمل في هذه القنوات فقط", value: "only" }, { name: "لا يعمل في هذه القنوات", value: "ignore" }, { name: "إزالة القيود", value: "clear" })
          )
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) =>
        s.setName("roles").setDescription("تقييد الرد برتب معينة")
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة"))
          .addBooleanOption((o) => o.setName("clear").setDescription("إزالة كل القيود"))
      )
      .addSubcommand((s) => s.setName("list").setDescription("عرض كل الردود"))
      .addSubcommand((s) =>
        s.setName("show").setDescription("تفاصيل رد")
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("delete").setDescription("حذف رد")
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("test").setDescription("تجربة نص لمعرفة أي رد سيُطابق")
          .addStringOption((o) => o.setName("text").setDescription("النص المراد تجربته").setRequired(true))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const repo = ctx.app.autoReplies;

      if (sub === "list") {
        const rows = repo.list(guildId);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه ردود تلقائية بعد." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "💬 الردود التلقائية",
            description: rows.map((r) =>
              `${r.enabled ? "🟢" : "⚪"} **${r.name}** — ${MATCH_LABELS[r.match_type]}\n` +
              `  \`${r.triggers.slice(0, 5).join("` `")}\`${r.triggers.length > 5 ? " …" : ""}\n` +
              `  استُخدم \`${r.uses}\` مرة${r.embed_id ? " • إمبيد" : ""}${r.cooldown_ms ? ` • تبريد ${formatDuration(r.cooldown_ms)}` : ""}`
            ).join("\n\n"),
            color: ctx.color("primary"),
            footer: `الإجمالي: ${rows.length}`
          })]
        }, { ephemeral: true });
      }

      if (sub === "test") {
        const text = ctx.interaction.options.getString("text");
        const rules = repo.listEnabled(guildId);
        const matched = rules.filter((r) => ctx.app.autoReplyService.matches(r, text));
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🧪 تجربة المطابقة",
            description: `النص: \`${truncate(text, 200)}\``,
            color: matched.length ? ctx.color("success") : ctx.color("neutral"),
            fields: [{
              name: matched.length ? `طابق ${matched.length} رد` : "ما طابق أي رد",
              value: matched.length
                ? matched.map((r, i) => `${i === 0 ? "**◀ سيُرد بهذا**" : "—"} \`${r.name}\``).join("\n")
                : "جرّب نوع مطابقة أوسع مثل «يحتوي على»."
            }]
          })]
        }, { ephemeral: true });
      }

      const name = ctx.interaction.options.getString("name").trim();

      if (sub === "create") {
        if (!NAME_PATTERN.test(name)) {
          return ctx.fail("errors.actionFailed", { details: "الاسم من 2 إلى 32 حرفًا بدون مسافات." });
        }
        if (repo.getByName(guildId, name)) {
          return ctx.fail("errors.actionFailed", { details: `فيه رد بنفس الاسم \`${name}\`.` });
        }
        if (repo.count(guildId) >= 200) {
          return ctx.fail("errors.actionFailed", { details: "وصلت للحد الأقصى (200 رد)." });
        }

        const triggers = ctx.interaction.options.getString("triggers")
          .split(",").map((t) => t.trim()).filter(Boolean).slice(0, 25);
        if (!triggers.length) return ctx.fail("errors.actionFailed", { details: "أدخل كلمة مفتاحية واحدة على الأقل." });

        const replyText = ctx.interaction.options.getString("reply");
        const embedName = ctx.interaction.options.getString("embed");
        if (!replyText && !embedName) {
          return ctx.fail("errors.actionFailed", { details: "حدد `reply` أو `embed` على الأقل." });
        }

        let embedId = null;
        if (embedName) {
          const record = ctx.app.embeds.getByName(guildId, embedName.trim());
          if (!record) return ctx.fail("errors.actionFailed", { details: `ما لقيت إمبيد اسمه \`${embedName}\`.` });
          embedId = record.id;
        }

        const cooldownRaw = ctx.interaction.options.getString("cooldown");
        const cooldownMs = cooldownRaw ? parseDuration(cooldownRaw) : 0;
        if (cooldownRaw && !cooldownMs) return ctx.fail("errors.invalidDuration");

        const rule = repo.create({
          guildId, name, triggers,
          matchType: ctx.interaction.options.getString("match") || "contains",
          replyText, embedId, cooldownMs,
          chance: ctx.interaction.options.getInteger("chance") ?? 100,
          replyTo: ctx.interaction.options.getBoolean("reply-to") !== false,
          deleteTrigger: ctx.interaction.options.getBoolean("delete-trigger"),
          createdBy: ctx.user.id
        });
        repo.invalidate(guildId);

        return ctx.success(
          `تم إنشاء الرد **${rule.name}**\n` +
          `الكلمات: \`${triggers.join("` `")}\`\n` +
          `جرّبه بكتابة إحداها في أي قناة، أو بـ \`/autoreply test\``
        );
      }

      const rule = repo.getByName(guildId, name);
      if (!rule) return ctx.fail("errors.actionFailed", { details: `ما لقيت ردًا اسمه \`${name}\`.` });

      if (sub === "delete") {
        repo.delete(guildId, name);
        repo.invalidate(guildId);
        return ctx.success(`تم حذف الرد \`${name}\`.`);
      }

      if (sub === "show") {
        return ctx.reply({
          embeds: [buildEmbed({
            title: `💬 ${rule.name}`,
            color: rule.enabled ? ctx.color("success") : ctx.color("neutral"),
            fields: [
              { name: "الحالة", value: rule.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
              { name: "المطابقة", value: MATCH_LABELS[rule.match_type], inline: true },
              { name: "الاستخدام", value: `\`${rule.uses}\``, inline: true },
              { name: "الكلمات المفتاحية", value: `\`${rule.triggers.join("` `")}\`` },
              { name: "الرد", value: rule.embed_id ? `إمبيد: **${ctx.app.embeds.get(rule.embed_id)?.name || "(محذوف)"}**` : truncate(rule.reply_text || "—", 500) },
              { name: "القنوات المسموحة", value: rule.channels.length ? rule.channels.map((c) => `<#${c}>`).join(" ") : "كل القنوات", inline: true },
              { name: "القنوات المستثناة", value: rule.ignored_channels.length ? rule.ignored_channels.map((c) => `<#${c}>`).join(" ") : "—", inline: true },
              { name: "الرتب المطلوبة", value: rule.role_ids.length ? rule.role_ids.map((r) => `<@&${r}>`).join(" ") : "الجميع", inline: true },
              { name: "التبريد", value: rule.cooldown_ms ? formatDuration(rule.cooldown_ms) : "بلا", inline: true },
              { name: "نسبة الرد", value: `${rule.chance}%`, inline: true },
              { name: "خيارات", value: `${rule.reply_to ? "✅" : "❌"} رد مباشر • ${rule.delete_trigger ? "✅" : "❌"} حذف رسالة العضو` }
            ]
          })]
        }, { ephemeral: true });
      }

      if (sub === "channels") {
        const mode = ctx.interaction.options.getString("mode");
        if (mode === "clear") {
          repo.update(rule.id, "channels", []);
          repo.update(rule.id, "ignored_channels", []);
          repo.invalidate(guildId);
          return ctx.success(`تمت إزالة قيود القنوات عن \`${name}\`.`);
        }
        const channel = ctx.interaction.options.getChannel("channel");
        if (!channel) return ctx.fail("errors.actionFailed", { details: "حدد القناة." });

        const field = mode === "only" ? "channels" : "ignored_channels";
        const current = new Set(rule[field]);
        if (current.has(channel.id)) current.delete(channel.id);
        else current.add(channel.id);

        repo.update(rule.id, field, [...current]);
        repo.invalidate(guildId);
        return ctx.success(
          `${current.has(channel.id) ? "تمت إضافة" : "تمت إزالة"} <#${channel.id}> ` +
          `${mode === "only" ? "من القنوات المسموحة" : "من القنوات المستثناة"}.`
        );
      }

      if (sub === "roles") {
        if (ctx.interaction.options.getBoolean("clear")) {
          repo.update(rule.id, "role_ids", []);
          repo.invalidate(guildId);
          return ctx.success(`تمت إزالة قيود الرتب عن \`${name}\`.`);
        }
        const role = ctx.interaction.options.getRole("role");
        if (!role) return ctx.fail("errors.actionFailed", { details: "حدد الرتبة أو استخدم `clear:true`." });

        const current = new Set(rule.role_ids);
        if (current.has(role.id)) current.delete(role.id);
        else current.add(role.id);

        repo.update(rule.id, "role_ids", [...current]);
        repo.invalidate(guildId);
        return ctx.success(`${current.has(role.id) ? "تمت إضافة" : "تمت إزالة"} <@&${role.id}> من شروط الرد.`);
      }

      // edit
      const field = ctx.interaction.options.getString("field");
      const raw = ctx.interaction.options.getString("value").trim();
      let value = raw;

      if (field === "triggers") {
        value = raw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 25);
        if (!value.length) return ctx.fail("errors.actionFailed", { details: "أدخل كلمة واحدة على الأقل." });
      } else if (field === "match_type") {
        if (!MATCH_LABELS[raw]) {
          return ctx.fail("errors.actionFailed", { details: `اكتب واحدًا من: ${Object.keys(MATCH_LABELS).join(" • ")}` });
        }
      } else if (field === "embed_id") {
        const record = ctx.app.embeds.getByName(guildId, raw);
        if (!record) return ctx.fail("errors.actionFailed", { details: `ما لقيت إمبيد اسمه \`${raw}\`.` });
        value = record.id;
      } else if (field === "cooldown_ms") {
        value = raw === "0" ? 0 : parseDuration(raw);
        if (value === null) return ctx.fail("errors.invalidDuration");
      } else if (field === "chance") {
        const n = parseInt(raw, 10);
        if (isNaN(n) || n < 1 || n > 100) return ctx.fail("errors.actionFailed", { details: "رقم من 1 إلى 100." });
        value = n;
      } else if (["reply_to", "delete_trigger", "enabled"].includes(field)) {
        value = ["نعم", "yes", "true", "1"].includes(raw.toLowerCase()) ? 1 : 0;
      }

      repo.update(rule.id, field, value);
      repo.invalidate(guildId);
      return ctx.success(`تم تعديل \`${field}\` في \`${name}\`.`);
    }
  }
];
