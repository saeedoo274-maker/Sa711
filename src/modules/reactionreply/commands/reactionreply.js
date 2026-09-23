const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, truncate } = require("../../../core/utils/helpers");

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
      { name: "delete", required: false, description: "حذف رد" }
    ],
    examples: [
      "/reactionreply create name:النشرة emoji:📰 role:@مشترك",
      "/reactionreply create name:الترحيب emoji:👋 reply:أهلاً {user}! dm:true"
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
          .addStringOption((o) => o.setName("name").setDescription("اسم الرد").setRequired(true))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

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
