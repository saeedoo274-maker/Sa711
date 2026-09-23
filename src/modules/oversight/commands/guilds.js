const { SlashCommandBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp, truncate } = require("../../../core/utils/helpers");

const STATUS_ICONS = { active: "🟢", left: "⚪", blacklisted: "🚫" };

module.exports = [
  {
    name: "سيرفرات",
    aliases: ["guilds", "السيرفرات"],
    description: "لوحة مراقبة السيرفرات: عرض، تفاصيل، مغادرة، وحظر السيرفرات المسيئة.",
    usage: "/guilds list  •  /guilds info id:<آيدي>  •  /guilds blacklist id:<آيدي>",
    arguments: [
      { name: "list", required: false, description: "قائمة السيرفرات مرتّبة" },
      { name: "info", required: false, description: "تفاصيل سيرفر" },
      { name: "stats", required: false, description: "إحصائيات عامة" },
      { name: "leave", required: false, description: "مغادرة سيرفر" },
      { name: "blacklist", required: false, description: "حظر سيرفر مسيء ومغادرته" },
      { name: "unblacklist", required: false, description: "رفع الحظر" },
      { name: "abuse", required: false, description: "آخر أحداث الإساءة" },
      { name: "invite", required: false, description: "رابط دعوة البوت" }
    ],
    examples: ["/guilds list sort:members", "/guilds info id:123456789012345678", "/guilds blacklist id:... reason:إغراق أوامر"],
    category: "oversight",
    slashOnly: true,
    cooldown: 0,
    // للمطورين فقط — الفحص هنا وفي معالج الأوامر معًا
    permissions: { developerOnly: true, level: Level.DEVELOPER },
    slash: new SlashCommandBuilder()
      .setName("سيرفرات")
      .setDescription("مراقبة السيرفرات (للمطورين)")
      .addSubcommand((s) =>
        s.setName("list").setDescription("قائمة السيرفرات")
          .addStringOption((o) =>
            o.setName("sort").setDescription("الترتيب")
              .addChoices(
                { name: "الأكثر أعضاءً", value: "members" },
                { name: "الأحدث انضمامًا", value: "newest" },
                { name: "الأقدم", value: "oldest" },
                { name: "الأكثر نشاطًا", value: "active" },
                { name: "الأكثر استخدامًا", value: "usage" }
              )
          )
          .addStringOption((o) =>
            o.setName("status").setDescription("الحالة")
              .addChoices(
                { name: "نشط", value: "active" },
                { name: "غادره البوت", value: "left" },
                { name: "محظور", value: "blacklisted" }
              )
          )
          .addIntegerOption((o) => o.setName("page").setDescription("رقم الصفحة").setMinValue(1))
      )
      .addSubcommand((s) =>
        s.setName("info").setDescription("تفاصيل سيرفر")
          .addStringOption((o) => o.setName("id").setDescription("آيدي السيرفر").setRequired(true))
      )
      .addSubcommand((s) => s.setName("stats").setDescription("إحصائيات عامة"))
      .addSubcommand((s) =>
        s.setName("leave").setDescription("مغادرة سيرفر")
          .addStringOption((o) => o.setName("id").setDescription("آيدي السيرفر").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(300))
      )
      .addSubcommand((s) =>
        s.setName("blacklist").setDescription("حظر سيرفر مسيء ومغادرته")
          .addStringOption((o) => o.setName("id").setDescription("آيدي السيرفر").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("سبب الحظر").setRequired(true).setMaxLength(300))
      )
      .addSubcommand((s) =>
        s.setName("unblacklist").setDescription("رفع الحظر عن سيرفر")
          .addStringOption((o) => o.setName("id").setDescription("آيدي السيرفر").setRequired(true))
      )
      .addSubcommand((s) => s.setName("abuse").setDescription("آخر أحداث الإساءة"))
      .addSubcommand((s) => s.setName("invite").setDescription("رابط دعوة البوت")),

    async execute(ctx) {
      // فحص مستقل لا يعتمد على واجهة ديسكورد إطلاقًا
      if (!ctx.app.permissions.isDeveloper(ctx.user.id)) return ctx.fail("errors.developerOnly");

      const sub = ctx.interaction.options.getSubcommand();
      const repo = ctx.app.oversight;

      if (sub === "stats") {
        const t = repo.totals();
        const live = ctx.app.client.guilds.cache;
        return ctx.reply({
          embeds: [buildEmbed({
            title: "📊 إحصائيات السيرفرات",
            color: ctx.color("primary"),
            fields: [
              { name: "متصل الآن", value: `\`${live.size}\``, inline: true },
              { name: "في السجل", value: `\`${t.total}\``, inline: true },
              { name: "نشط", value: `\`${t.active}\``, inline: true },
              { name: "غادرها البوت", value: `\`${t.left_count}\``, inline: true },
              { name: "محظورة", value: `\`${t.blacklisted}\``, inline: true },
              { name: "إجمالي الأعضاء", value: `\`${t.members.toLocaleString("en-US")}\``, inline: true },
              { name: "أوامر نُفّذت", value: `\`${t.commands.toLocaleString("en-US")}\``, inline: true },
              { name: "أحداث إساءة (24 ساعة)", value: `\`${repo.recentAbuse(200).filter((a) => Date.now() - a.created_at < 86400000).length}\``, inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      if (sub === "invite") {
        const id = ctx.app.config.env.clientId;
        // صلاحيات مطلوبة فقط، بلا Administrator
        const perms = "137642542395";
        return ctx.reply({
          content:
            `🔗 رابط الدعوة:\nhttps://discord.com/oauth2/authorize?client_id=${id}&scope=bot%20applications.commands&permissions=${perms}`
        }, { ephemeral: true });
      }

      if (sub === "abuse") {
        const rows = repo.recentAbuse(15);
        if (!rows.length) return ctx.success("ما فيه أحداث إساءة مسجّلة. 🎉");
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🛡️ آخر أحداث الإساءة",
            description: rows.map((a) =>
              `\`${a.kind}\` — سيرفر \`${a.guild_id}\`${a.user_id ? ` • <@${a.user_id}>` : ""}\n  ${truncate(a.detail || "—", 100)} • ${timestamp(a.created_at, "R")}`
            ).join("\n"),
            color: ctx.color("warning")
          })]
        }, { ephemeral: true });
      }

      if (sub === "list") {
        const sort = ctx.interaction.options.getString("sort") || "members";
        const status = ctx.interaction.options.getString("status");
        const page = ctx.interaction.options.getInteger("page") || 1;
        const limit = 10;
        const rows = repo.list({ status, sort, limit, offset: (page - 1) * limit });

        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه سيرفرات في هذه الصفحة." });

        const total = repo.count(status);
        return ctx.reply({
          embeds: [buildEmbed({
            title: `🌐 السيرفرات — صفحة ${page} من ${Math.ceil(total / limit)}`,
            description: rows.map((g) =>
              `${STATUS_ICONS[g.status] || "•"} **${truncate(g.name || "بلا اسم", 40)}**\n` +
              `  \`${g.guild_id}\` • \`${g.member_count}\` عضو • \`${g.commands_used}\` أمر\n` +
              `  انضم ${timestamp(g.joined_at, "R")}${g.last_used_at ? ` • آخر نشاط ${timestamp(g.last_used_at, "R")}` : ""}` +
              (g.status === "blacklisted" ? `\n  🚫 ${truncate(g.blacklist_reason || "", 80)}` : "")
            ).join("\n\n"),
            color: ctx.color("primary"),
            footer: `الإجمالي: ${total}`
          })]
        }, { ephemeral: true });
      }

      const id = ctx.interaction.options.getString("id").trim().match(/\d{15,25}/)?.[0];
      if (!id) return ctx.fail("errors.actionFailed", { details: "آيدي سيرفر غير صالح." });

      if (sub === "info") {
        const record = repo.get(id);
        const live = ctx.app.client.guilds.cache.get(id);
        if (!record && !live) return ctx.fail("errors.actionFailed", { details: "ما لقيت سيرفرًا بهذا الآيدي." });

        const fields = [
          { name: "الآيدي", value: `\`${id}\``, inline: true },
          { name: "الحالة", value: `${STATUS_ICONS[record?.status] || "❔"} ${record?.status || "غير مسجّل"}`, inline: true },
          { name: "الأعضاء", value: `\`${live?.memberCount ?? record?.member_count ?? 0}\``, inline: true }
        ];
        if (record?.owner_id) fields.push({ name: "المالك", value: `<@${record.owner_id}>`, inline: true });
        if (record?.joined_at) fields.push({ name: "انضم", value: timestamp(record.joined_at, "F"), inline: true });
        if (record?.left_at) fields.push({ name: "غادر", value: timestamp(record.left_at, "F"), inline: true });
        fields.push({ name: "أوامر نُفّذت", value: `\`${record?.commands_used || 0}\``, inline: true });
        if (record?.last_used_at) fields.push({ name: "آخر نشاط", value: timestamp(record.last_used_at, "R"), inline: true });
        if (record?.blacklist_reason) {
          fields.push({ name: "سبب الحظر", value: `${record.blacklist_reason}\nبواسطة: ${record.blacklisted_by || "—"}` });
        }
        const abuse = repo.abuseCount(id, 7 * 86400000);
        fields.push({ name: "أحداث إساءة (7 أيام)", value: `\`${abuse}\``, inline: true });
        if (live) fields.push({ name: "القنوات", value: `\`${live.channels.cache.size}\``, inline: true });

        return ctx.reply({
          embeds: [buildEmbed({
            title: `🌐 ${live?.name || record?.name || "سيرفر"}`,
            color: ctx.color(record?.status === "blacklisted" ? "danger" : "primary"),
            thumbnail: live?.iconURL() || record?.icon_url || undefined,
            fields
          })]
        }, { ephemeral: true });
      }

      if (sub === "unblacklist") {
        if (!repo.unblacklist(id)) return ctx.fail("errors.actionFailed", { details: "هذا السيرفر غير محظور." });
        return ctx.success(`تم رفع الحظر عن \`${id}\`. البوت يقدر يُدعى إليه من جديد.`);
      }

      const guild = ctx.app.client.guilds.cache.get(id);

      if (sub === "leave") {
        if (!guild) return ctx.fail("errors.actionFailed", { details: "البوت غير موجود في هذا السيرفر." });
        const name = guild.name;
        await ctx.defer({ ephemeral: true });
        await guild.leave().catch(() => null);
        repo.recordAbuse({ guildId: id, kind: "manualLeave", detail: ctx.interaction.options.getString("reason") || "بلا سبب" });
        return ctx.reply({ content: `${ctx.emoji("success")} غادر البوت **${name}**.` }, { ephemeral: true });
      }

      // blacklist
      const reason = ctx.interaction.options.getString("reason");
      repo.blacklist(id, { reason, by: ctx.user.tag });
      await ctx.defer({ ephemeral: true });

      let leftNote = "";
      if (guild) {
        await guild.leave().catch(() => null);
        leftNote = "\nوغادر السيرفر.";
      }

      return ctx.reply({
        content:
          `${ctx.emoji("success")} تم حظر \`${id}\`.${leftNote}\n` +
          `البوت راح يرفض العمل فيه ويغادره تلقائيًا لو أُعيدت دعوته.`
      }, { ephemeral: true });
    }
  }
];
