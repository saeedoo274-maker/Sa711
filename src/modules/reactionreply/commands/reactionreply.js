const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, truncate, parseDuration, formatDuration } = require("../../../core/utils/helpers");

const NAME_PATTERN = /^[\p{L}\p{N}_-]{2,32}$/u;

module.exports = [
  {
    name: "رد_تفاعل",
    aliases: ["reactionreply", "ردود_تفاعل"],
    description: "رد تلقائي عند الضغط على إيموجي معيّن: نص، إمبيد، أو رتبة تُعطى وتُسحب.",
    usage: "/reactionreply create name:الترحيب emoji:👋 reply:أهلاً {user}",
    arguments: [
      { name: "create", required: false, description: "إنشاء رد تفاعل" },
      { name: "edit", required: false, description: "تعديل خاصية" },
      { name: "list", required: false, description: "عرض كل الردود" },
      { name: "delete", required: false, description: "حذف رد" },
      { name: "actions", required: false, description: "الإجراءات: وضع الرتبة، سحب رتبة، قناة، تذكرة، سجل، زر، رسالة محددة" },
      { name: "requirements", required: false, description: "الشروط: رتب مطلوبة/محظورة، عمر الحساب، المستوى، التبريد" },
      { name: "info", required: false, description: "تفاصيل قاعدة" }
    ],
    examples: [
      "/reactionreply create name:النشرة emoji:📰 role:@مشترك",
      "/reactionreply create name:الترحيب emoji:👋 reply:أهلاً {user}! dm:true",
      "/reactionreply actions name:النشرة role-mode:sync message:<رابط الرسالة>",
      "/reactionreply requirements name:النشرة min-level:5 cooldown:1m"
    ],
    category: "reactionreply",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("رد_تفاعل")
      .setDescription("الرد على التفاعلات")
      .addSubcommand((s) =>
        s.setName("create").setDescription("إنشاء رد تفاعل")
          .addStringOption((o) => o.setName("name").setDescription("اسم مختصر بدون مسافات").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("emoji").setDescription("الإيموجي المستخدم").setRequired(true).setMaxLength(64))
          .addStringOption((o) => o.setName("reply").setDescription("نص الرد").setMaxLength(1900))
          .addStringOption((o) => o.setName("embed").setDescription("اسم إمبيد مصمّم بـ /embed"))
          .addRoleOption((o) => o.setName("role").setDescription("رتبة تُعطى/تُسحب بالتبديل"))
          .addBooleanOption((o) => o.setName("dm").setDescription("الرد في الخاص بدل القناة"))
      )
      .addSubcommand((s) =>
        s.setName("edit").setDescription("تعديل رد تفاعل")
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true))
          .addStringOption((o) =>
            o.setName("field").setDescription("الخاصية").setRequired(true)
              .addChoices(
                { name: "نص الرد", value: "reply_text" },
                { name: "الإمبيد", value: "embed_id" },
                { name: "الرتبة", value: "role_id" },
                { name: "الرد في الخاص", value: "dm" },
                { name: "مفعّل", value: "enabled" }
              )
          )
          .addStringOption((o) => o.setName("value").setDescription("القيمة الجديدة").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("channels").setDescription("تقييد الرد بقنوات معيّنة")
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true))
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
          .addBooleanOption((o) => o.setName("clear").setDescription("إزالة كل القيود"))
      )
      .addSubcommand((s) => s.setName("list").setDescription("عرض كل الردود"))
      .addSubcommand((s) =>
        s.setName("delete").setDescription("حذف رد")
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((s) =>
        s.setName("actions").setDescription("إجراءات القاعدة")
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName("role-mode").setDescription("وضع الرتبة").addChoices(
            { name: "تبديل (افتراضي)", value: "toggle" }, { name: "إعطاء فقط", value: "add" },
            { name: "سحب فقط", value: "remove" }, { name: "مزامنة مع التفاعل", value: "sync" }))
          .addRoleOption((o) => o.setName("remove-role").setDescription("رتبة تُسحب عند التفاعل"))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة يُتحكم بظهورها للعضو"))
          .addStringOption((o) => o.setName("channel-action").setDescription("إجراء القناة").addChoices({ name: "إظهار", value: "view" }, { name: "إخفاء", value: "hide" }, { name: "بلا", value: "none" }))
          .addBooleanOption((o) => o.setName("ticket").setDescription("فتح تذكرة للعضو"))
          .addChannelOption((o) => o.setName("log-channel").setDescription("قناة سجل لهذه القاعدة").addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) => o.setName("button-label").setDescription("زر رابط مع الرد (- للإزالة)").setMaxLength(80))
          .addStringOption((o) => o.setName("button-url").setDescription("رابط الزر (https)").setMaxLength(400))
          .addBooleanOption((o) => o.setName("remove-reaction").setDescription("إزالة تفاعل العضو بعد التنفيذ"))
          .addStringOption((o) => o.setName("message").setDescription("ربط برسالة محددة (رابط أو آيدي، - للإلغاء)").setMaxLength(200))
      )
      .addSubcommand((s) =>
        s.setName("requirements").setDescription("شروط القاعدة")
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true).setAutocomplete(true))
          .addRoleOption((o) => o.setName("required-role").setDescription("رتبة مطلوبة (تبديل)"))
          .addRoleOption((o) => o.setName("blocked-role").setDescription("رتبة ممنوعة (تبديل)"))
          .addIntegerOption((o) => o.setName("min-account-days").setDescription("أقل عمر للحساب بالأيام").setMinValue(0).setMaxValue(3650))
          .addIntegerOption((o) => o.setName("min-level").setDescription("أقل مستوى").setMinValue(0).setMaxValue(1000))
          .addStringOption((o) => o.setName("cooldown").setDescription("تبريد لكل عضو مثل 30s (0 = بلا)"))
      )
      .addSubcommand((s) => s.setName("info").setDescription("تفاصيل قاعدة").addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true).setAutocomplete(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async autocomplete(interaction, app) {
      const typed = String(interaction.options.getFocused() || "").toLowerCase();
      const rows = app.reactionReplies.list(interaction.guild.id).filter((r) => r.name.toLowerCase().includes(typed)).slice(0, 25);
      return interaction.respond(rows.map((r) => ({ name: `${r.emoji} ${r.name}`.slice(0, 100), value: r.name })));
    },

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const repo = ctx.app.reactionReplies;

      if (sub === "list") {
        const rows = repo.list(guildId);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه ردود تفاعل بعد." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🎭 ردود التفاعلات",
            description: rows.map((r) =>
              `${r.enabled ? "🟢" : "⚪"} **${r.name}** — ${r.emoji}\n` +
              `  ${r.role_id ? `رتبة: <@&${r.role_id}>` : ""}${r.embed_id ? " • إمبيد" : ""}${r.reply_text ? " • نص" : ""}${r.dm ? " • خاص" : ""}\n` +
              `  استُخدم \`${r.uses}\` مرة`
            ).join("\n\n"),
            color: ctx.color("primary"),
            footer: `الإجمالي: ${rows.length}`
          })]
        }, { ephemeral: true });
      }

      const name = ctx.interaction.options.getString("name").trim();

      if (sub === "create") {
        if (!NAME_PATTERN.test(name)) return ctx.fail("errors.actionFailed", { details: "الاسم من 2 إلى 32 حرفًا بدون مسافات." });
        if (repo.getByName(guildId, name)) return ctx.fail("errors.actionFailed", { details: `فيه رد بنفس الاسم \`${name}\`.` });
        if (repo.count(guildId) >= 100) return ctx.fail("errors.actionFailed", { details: "وصلت للحد الأقصى (100 رد)." });

        const emoji = ctx.interaction.options.getString("emoji").trim();
        const replyText = ctx.interaction.options.getString("reply");
        const embedName = ctx.interaction.options.getString("embed");
        const role = ctx.interaction.options.getRole("role");

        if (!replyText && !embedName && !role) {
          return ctx.fail("errors.actionFailed", { details: "حدد `reply` أو `embed` أو `role` على الأقل." });
        }

        let embedId = null;
        if (embedName) {
          const record = ctx.app.embeds.getByName(guildId, embedName.trim());
          if (!record) return ctx.fail("errors.actionFailed", { details: `ما لقيت إمبيد اسمه \`${embedName}\`.` });
          embedId = record.id;
        }

        if (role) {
          const me = ctx.guild.members.me;
          if (role.managed || role.position >= me.roles.highest.position) {
            return ctx.fail("errors.actionFailed", { details: "لا أستطيع إدارة هذه الرتبة." });
          }
          if (role.permissions.has(PermissionFlagsBits.Administrator)) {
            return ctx.fail("errors.actionFailed", { details: "لا يُسمح بربط رتبة تحمل صلاحية Administrator." });
          }
        }

        const rule = repo.create({
          guildId, name, emoji, replyText, embedId,
          roleId: role?.id, dm: ctx.interaction.options.getBoolean("dm")
        });
        repo.invalidate(guildId);

        return ctx.success(`تم إنشاء رد التفاعل **${rule.name}** على الإيموجي ${emoji}.\nضع نفس الإيموجي كتفاعل على أي رسالة ليعمل.`);
      }

      const rule = repo.getByName(guildId, name);
      if (!rule) return ctx.fail("errors.actionFailed", { details: `ما لقيت ردًا اسمه \`${name}\`.` });

      if (sub === "delete") {
        repo.delete(guildId, name);
        repo.invalidate(guildId);
        return ctx.success(`تم حذف \`${name}\`.`);
      }

      if (sub === "info") {
        return ctx.reply({
          embeds: [buildEmbed({
            title: `🎭 ${rule.name} ${rule.emoji}`,
            color: ctx.color(rule.enabled ? "primary" : "neutral"),
            fields: [
              { name: "الحالة", value: rule.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
              { name: "الاستخدامات", value: `\`${rule.uses}\``, inline: true },
              { name: "الرسالة", value: rule.message_id ? `\`${rule.message_id}\`` : "أي رسالة", inline: true },
              { name: "الرتبة", value: rule.role_id ? `<@&${rule.role_id}> (${rule.role_mode})` : "—", inline: true },
              { name: "سحب رتبة", value: rule.remove_role_id ? `<@&${rule.remove_role_id}>` : "—", inline: true },
              { name: "القناة", value: rule.target_channel_id && rule.channel_action ? `<#${rule.target_channel_id}> (${rule.channel_action})` : "—", inline: true },
              { name: "الرد", value: [rule.reply_text ? "نص" : null, rule.embed_id ? "إمبيد" : null, rule.dm ? "خاص" : null, rule.button_url ? "زر" : null, rule.open_ticket ? "تذكرة" : null].filter(Boolean).join(" • ") || "—", inline: true },
              { name: "الشروط", value: [
                rule.required_roles.length ? `مطلوبة: ${rule.required_roles.map((r) => `<@&${r}>`).join(" ")}` : null,
                rule.blocked_roles.length ? `ممنوعة: ${rule.blocked_roles.map((r) => `<@&${r}>`).join(" ")}` : null,
                rule.min_account_days ? `عمر الحساب ≥ ${rule.min_account_days} يوم` : null,
                rule.min_level ? `المستوى ≥ ${rule.min_level}` : null,
                rule.cooldown_ms ? `تبريد ${formatDuration(rule.cooldown_ms)}` : null
              ].filter(Boolean).join("\n") || "—" },
              { name: "القنوات", value: rule.channels.map((c) => `<#${c}>`).join(" ") || "كل القنوات", inline: true },
              { name: "السجل", value: rule.log_channel_id ? `<#${rule.log_channel_id}>` : "—", inline: true }
            ]
          })],
          allowedMentions: { parse: [] }
        }, { ephemeral: true });
      }

      if (sub === "actions" || sub === "requirements") {
        const o = ctx.interaction.options;
        const fields = {};
        const me = ctx.guild.members.me;
        const safeRole = (role) => role && !role.managed && role.position < me.roles.highest.position && !role.permissions?.has?.(PermissionFlagsBits.Administrator);
        if (sub === "actions") {
          if (o.getString("role-mode")) fields.role_mode = o.getString("role-mode");
          const removeRole = o.getRole("remove-role");
          if (removeRole) {
            if (!safeRole(removeRole)) return ctx.fail("errors.actionFailed", { details: "لا أستطيع إدارة هذه الرتبة." });
            fields.remove_role_id = rule.remove_role_id === removeRole.id ? null : removeRole.id;
          }
          const channel = o.getChannel("channel");
          const channelAction = o.getString("channel-action");
          if (channel) fields.target_channel_id = channel.id;
          if (channelAction) fields.channel_action = channelAction === "none" ? null : channelAction;
          if ((fields.channel_action || rule.channel_action) && !(fields.target_channel_id || rule.target_channel_id) && channelAction !== "none") {
            return ctx.fail("errors.actionFailed", { details: "حدد القناة مع إجراء القناة." });
          }
          if (o.getBoolean("ticket") !== null) fields.open_ticket = o.getBoolean("ticket") ? 1 : 0;
          const log = o.getChannel("log-channel");
          if (log) fields.log_channel_id = rule.log_channel_id === log.id ? null : log.id;
          const label = o.getString("button-label");
          const url = o.getString("button-url");
          if (label !== null) fields.button_label = label.trim() === "-" ? null : label.trim();
          if (url !== null) {
            if (!/^https:\/\/\S+$/i.test(url.trim())) return ctx.fail("errors.actionFailed", { details: "رابط الزر يجب أن يبدأ بـ https://" });
            fields.button_url = url.trim();
          }
          if (fields.button_label === null) fields.button_url = null;
          if (o.getBoolean("remove-reaction") !== null) fields.remove_reaction = o.getBoolean("remove-reaction") ? 1 : 0;
          const msg = o.getString("message");
          if (msg !== null) {
            if (msg.trim() === "-") fields.message_id = null;
            else {
              const id = msg.match(/(\d{17,20})\/?$/)?.[1] || msg.match(/^\d{17,20}$/)?.[0];
              if (!id) return ctx.fail("errors.actionFailed", { details: "أدخل رابط الرسالة أو آيديها." });
              fields.message_id = id;
            }
          }
          const mode = fields.role_mode || rule.role_mode;
          const removeReaction = fields.remove_reaction ?? rule.remove_reaction;
          if (mode === "sync" && removeReaction) return ctx.fail("errors.actionFailed", { details: "وضع المزامنة لا يعمل مع إزالة التفاعل تلقائيًا." });
        } else {
          const toggle = (list, id) => {
            const set = new Set(list);
            set.has(id) ? set.delete(id) : set.add(id);
            return [...set];
          };
          const req = o.getRole("required-role");
          if (req) fields.required_roles = toggle(rule.required_roles, req.id);
          const blocked = o.getRole("blocked-role");
          if (blocked) fields.blocked_roles = toggle(rule.blocked_roles, blocked.id);
          if (o.getInteger("min-account-days") !== null) fields.min_account_days = o.getInteger("min-account-days");
          if (o.getInteger("min-level") !== null) {
            if (o.getInteger("min-level") > 0 && !(ctx.app.levels && ctx.app.features.isEnabled(guildId, "levels"))) {
              return ctx.fail("errors.systemDisabled", { system: "levels" });
            }
            fields.min_level = o.getInteger("min-level");
          }
          const cooldown = o.getString("cooldown");
          if (cooldown !== null) {
            const ms = cooldown.trim() === "0" ? 0 : parseDuration(cooldown);
            if (ms === null || ms === undefined || ms > 86_400_000) return ctx.fail("errors.invalidDuration");
            fields.cooldown_ms = ms;
          }
        }
        if (!Object.keys(fields).length) return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
        repo.updateMany(rule.id, fields);
        repo.invalidate(guildId);
        return ctx.success(`تم تحديث \`${name}\`. استخدم \`/رد_تفاعل info\` لعرض التفاصيل.`);
      }

      if (sub === "channels") {
        if (ctx.interaction.options.getBoolean("clear")) {
          repo.update(rule.id, "channels", []);
          repo.invalidate(guildId);
          return ctx.success(`تمت إزالة قيود القنوات عن \`${name}\`.`);
        }
        const channel = ctx.interaction.options.getChannel("channel");
        if (!channel) return ctx.fail("errors.actionFailed", { details: "حدد القناة أو استخدم `clear:true`." });
        const current = new Set(rule.channels);
        if (current.has(channel.id)) current.delete(channel.id);
        else current.add(channel.id);
        repo.update(rule.id, "channels", [...current]);
        repo.invalidate(guildId);
        return ctx.success(`${current.has(channel.id) ? "أُضيفت" : "أُزيلت"} <#${channel.id}>.`);
      }

      // edit
      const field = ctx.interaction.options.getString("field");
      const raw = ctx.interaction.options.getString("value").trim();
      let value = raw;

      if (field === "embed_id") {
        const record = ctx.app.embeds.getByName(guildId, raw);
        if (!record) return ctx.fail("errors.actionFailed", { details: `ما لقيت إمبيد اسمه \`${raw}\`.` });
        value = record.id;
      } else if (field === "role_id") {
        const id = raw.match(/\d{15,25}/)?.[0];
        if (!id) return ctx.fail("errors.actionFailed", { details: "أدخل آيدي رتبة أو منشن." });
        value = id;
      } else if (["dm", "enabled"].includes(field)) {
        value = ["نعم", "yes", "true", "1"].includes(raw.toLowerCase()) ? 1 : 0;
      }

      repo.update(rule.id, field, value);
      repo.invalidate(guildId);
      return ctx.success(`تم تعديل \`${field}\` في \`${name}\`.`);
    }
  }
];
