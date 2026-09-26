const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "لوحة_نجوم",
    aliases: ["starboard", "لوحة_النجوم", "نجوم"],
    description: "لوحة النجوم: الرسائل المميزة تُنشر تلقائيًا عند تجاوز عدد نجوم محدد.",
    usage: "/starboard top | /starboard board action:add name:memes channel:#ميمز",
    arguments: [
      { name: "top", required: false, description: "أكثر الرسائل نجومًا" },
      { name: "ignore", required: false, description: "استثناء قناة أو رتبة من لوحة" },
      { name: "board", required: false, description: "لوحات إضافية: إضافة/تعديل/حذف/عرض" },
      { name: "leaderboard", required: false, description: "أكثر الأعضاء حصولًا على النجوم" }
    ],
    examples: ["/starboard top", "/starboard board action:add name:memes channel:#ميمز emoji:😂 threshold:5"],
    category: "starboard",
    slashOnly: true,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("لوحة_نجوم")
      .setDescription("لوحة النجوم")
      .addSubcommand((s) => s.setName("top").setDescription("أكثر الرسائل نجومًا")
        .addStringOption((o) => o.setName("board").setDescription("لوحة إضافية (فارغ = الأصلية)").setAutocomplete(true)))
      .addSubcommand((s) =>
        s.setName("ignore").setDescription("استثناء قناة أو رتبة (تبديل)")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum))
          .addRoleOption((o) => o.setName("role").setDescription("رتبة لا تُحتسب نجومها"))
          .addStringOption((o) => o.setName("board").setDescription("لوحة إضافية (فارغ = الأصلية)").setAutocomplete(true))
      )
      .addSubcommand((s) =>
        s.setName("board").setDescription("لوحات إضافية")
          .addStringOption((o) => o.setName("action").setDescription("الإجراء").setRequired(true)
            .addChoices({ name: "إضافة", value: "add" }, { name: "تعديل", value: "edit" }, { name: "حذف", value: "remove" }, { name: "عرض", value: "list" }))
          .addStringOption((o) => o.setName("name").setDescription("اسم اللوحة").setMaxLength(24).setAutocomplete(true))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة اللوحة").addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) => o.setName("emoji").setDescription("الإيموجي").setMaxLength(64))
          .addIntegerOption((o) => o.setName("threshold").setDescription("الحد").setMinValue(1).setMaxValue(100))
          .addBooleanOption((o) => o.setName("self-star").setDescription("السماح بتنجيم النفس"))
          .addBooleanOption((o) => o.setName("allow-bots").setDescription("السماح برسائل البوتات"))
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل اللوحة"))
      )
      .addSubcommand((s) =>
        s.setName("leaderboard").setDescription("أكثر الأعضاء حصولًا على النجوم")
          .addStringOption((o) => o.setName("period").setDescription("الفترة").addChoices({ name: "الكل", value: "all" }, { name: "7 أيام", value: "7d" }, { name: "30 يومًا", value: "30d" }))
      ),

    async autocomplete(interaction, app) {
      const typed = String(interaction.options.getFocused() || "").toLowerCase();
      const boards = app.starboardPlus ? app.starboardPlus.boards(interaction.guild.id) : [];
      return interaction.respond(boards.filter((b) => b.name.includes(typed)).slice(0, 25).map((b) => ({ name: `${b.emoji} ${b.name}`.slice(0, 100), value: b.name })));
    },

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const level = ctx.app.permissions.resolveLevel(ctx.member);

      const plus = ctx.app.starboardPlus && ctx.app.features.isEnabled(guildId, "starboard") ? ctx.app.starboardPlus : null;
      const boardName = (ctx.interaction.options.getString("board") || "").trim().toLowerCase() || null;
      if (boardName && !plus) return ctx.fail("errors.systemDisabled", { system: "starboard-plus" });
      const board = boardName ? plus.repo.board(guildId, boardName) : null;
      if (boardName && !board) return ctx.fail("errors.actionFailed", { details: "لوحة غير موجودة." });

      if (sub === "leaderboard") {
        if (!plus) return ctx.fail("errors.systemDisabled", { system: "starboard-plus" });
        const period = ctx.interaction.options.getString("period") || "all";
        const since = period === "7d" ? Date.now() - 7 * 86_400_000 : period === "30d" ? Date.now() - 30 * 86_400_000 : 0;
        const rows = plus.repo.authors(guildId, since, 10);
        return ctx.reply({
          embeds: [ctx.embed({
            title: "🌟 أكثر الأعضاء نجومًا",
            color: "warning",
            description: rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ⭐ \`${r.score}\` (${r.posts} رسالة)`).join("\n") || "لا توجد بيانات بعد."
          })],
          allowedMentions: { parse: [] }
        });
      }

      if (sub === "top" && board) {
        const rows = plus.repo.top(board.id, 10);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه رسائل في هذه اللوحة بعد." });
        return ctx.reply({
          embeds: [ctx.embed({
            title: `${board.emoji} ${board.name}`,
            color: "warning",
            description: rows.map((r, i) => `**${i + 1}.** ${board.emoji} \`${r.stars}\` — <@${r.author_id}> في <#${r.source_channel_id}>`).join("\n")
          })],
          allowedMentions: { parse: [] }
        });
      }

      if (sub === "top") {
        const rows = ctx.app.starboard.top(guildId, 10);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه رسائل في اللوحة بعد." });
        const cfg = ctx.app.starboardService.config(guildId);
        return ctx.reply({
          embeds: [buildEmbed({
            title: `${cfg.emoji || "⭐"} أكثر الرسائل نجومًا`,
            description: rows.map((r, i) =>
              `**${i + 1}.** ${cfg.emoji || "⭐"} \`${r.stars}\` — <@${r.author_id}> في <#${r.source_channel_id}>`
            ).join("\n"),
            color: ctx.color("warning")
          })]
        });
      }

      if (level < Level.ADMIN) return ctx.fail("errors.noPermission");

      if (sub === "ignore") {
        const channel = ctx.interaction.options.getChannel("channel");
        const role = ctx.interaction.options.getRole("role");
        if (!channel && !role) return ctx.fail("errors.actionFailed", { details: "حدد قناة أو رتبة." });
        if (role && !plus && !boardName) {
          // تجاهل الرتب للوحة الأصلية يعمل حتى بدون الإضافة (يُقرأ في StarboardService)
          const set = new Set(ctx.app.guildConfig.value(guildId, "starboard.ignoredRoles") || []);
          set.has(role.id) ? set.delete(role.id) : set.add(role.id);
          ctx.app.guildConfig.set(guildId, "starboard.ignoredRoles", [...set]);
        }
        const lines = [];
        for (const [kind, target] of [["channel", channel], ["role", role]]) {
          if (!target) continue;
          let ignored;
          if (plus) ignored = plus.toggleIgnore(guildId, boardName, kind, target.id).ignored;
          else if (kind === "channel") {
            const current = new Set(ctx.app.guildConfig.value(guildId, "starboard.ignoredChannels") || []);
            current.has(target.id) ? current.delete(target.id) : current.add(target.id);
            ctx.app.guildConfig.set(guildId, "starboard.ignoredChannels", [...current]);
            ignored = current.has(target.id);
          } else ignored = (ctx.app.guildConfig.value(guildId, "starboard.ignoredRoles") || []).includes(target.id);
          lines.push(`${ignored ? "🚫 تم استثناء" : "✅ تمت إعادة"} ${kind === "role" ? `<@&${target.id}>` : `<#${target.id}>`}`);
        }
        return ctx.success(`${lines.join("\n")}\n-# ${boardName ? `اللوحة: ${boardName}` : "اللوحة الأصلية"}`);
      }

      if (sub === "board") {
        if (!plus) return ctx.fail("errors.systemDisabled", { system: "starboard-plus" });
        const o = ctx.interaction.options;
        const action = o.getString("action");
        const name = (o.getString("name") || "").trim().toLowerCase();
        if (action === "list") {
          const boards = plus.boards(guildId);
          return ctx.reply({
            embeds: [ctx.embed({
              title: "⭐ لوحات النجوم الإضافية",
              color: "info",
              description: boards.map((b) => `${b.enabled ? "🟢" : "⚪"} ${b.emoji} \`${b.name}\` → <#${b.channel_id}> — الحد \`${b.threshold}\`${b.self_star ? " • تنجيم النفس" : ""}${b.allow_bots ? " • بوتات" : ""}${b.ignored_roles.length ? ` • 🚫 ${b.ignored_roles.length} رتب` : ""}${b.ignored_channels.length ? ` • 🚫 ${b.ignored_channels.length} قنوات` : ""}`).join("\n") || "لا توجد لوحات إضافية."
            })]
          }, { ephemeral: true });
        }
        if (!name) return ctx.fail("errors.actionFailed", { details: "حدد اسم اللوحة." });
        const reasons = { badName: "اسم غير صالح (حروف وأرقام و - _ حتى 24).", maxBoards: "وصلت للحد الأقصى من اللوحات.", noSend: "لا أملك صلاحية الإرسال في تلك القناة.", exists: "يوجد لوحة بهذا الاسم.", notFound: "لوحة غير موجودة." };
        if (action === "add") {
          const channel = o.getChannel("channel");
          if (!channel) return ctx.fail("errors.actionFailed", { details: "حدد قناة اللوحة." });
          const res = plus.createBoard(ctx.guild, { name, channel, emoji: o.getString("emoji"), threshold: o.getInteger("threshold") || 3, selfStar: o.getBoolean("self-star"), allowBots: o.getBoolean("allow-bots") });
          return res.ok ? ctx.success(`تم إنشاء اللوحة ${res.board.emoji} \`${res.board.name}\` في <#${channel.id}>.`) : ctx.fail("errors.actionFailed", { details: reasons[res.reason] });
        }
        if (action === "remove") {
          const res = plus.deleteBoard(guildId, name);
          return res.ok ? ctx.success(`تم حذف اللوحة \`${name}\`.`) : ctx.fail("errors.actionFailed", { details: reasons[res.reason] });
        }
        // edit
        const fields = {};
        const channel = o.getChannel("channel");
        if (channel) {
          if (channel.permissionsFor && !channel.permissionsFor(ctx.guild.members.me)?.has(PermissionFlagsBits.SendMessages)) return ctx.fail("errors.actionFailed", { details: reasons.noSend });
          fields.channel_id = channel.id;
        }
        if (o.getString("emoji")) fields.emoji = o.getString("emoji").trim();
        if (o.getInteger("threshold")) fields.threshold = o.getInteger("threshold");
        for (const [opt, col] of [["self-star", "self_star"], ["allow-bots", "allow_bots"], ["enabled", "enabled"]]) {
          if (o.getBoolean(opt) !== null) fields[col] = o.getBoolean(opt) ? 1 : 0;
        }
        if (!Object.keys(fields).length) return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
        const res = plus.editBoard(guildId, name, fields);
        return res.ok ? ctx.success(`تم تحديث اللوحة \`${name}\`.`) : ctx.fail("errors.actionFailed", { details: reasons[res.reason] });
      }

      return ctx.fail("errors.actionFailed", { details: sub || "?" });
    }
  }
];
