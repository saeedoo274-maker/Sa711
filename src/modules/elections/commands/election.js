const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "انتخابات",
    aliases: ["election", "elections"],
    description: "انتخابات بمرشحين: تسجيل ترشّح، مراجعة إدارية، تصويت، ونتائج مباشرة.",
    usage: "/انتخابات create title:<العنوان> description:<الوصف>",
    arguments: [
      { name: "create", required: false, description: "إنشاء انتخاب جديد (يبدأ بمرحلة التسجيل)" },
      { name: "start-voting", required: false, description: "إقفال التسجيل وفتح التصويت" },
      { name: "close", required: false, description: "إقفال الانتخاب نهائيًا وعرض النتيجة النهائية" },
      { name: "channel", required: false, description: "قناة مراجعة طلبات الترشّح" },
      { name: "list", required: false, description: "عرض الانتخابات الحالية" },
      { name: "results", required: false, description: "عرض نتائج انتخاب بمعرّفه" }
    ],
    examples: [
      "/انتخابات create title:انتخابات الرئاسة 2026 description:اختر رئيسك القادم",
      "/انتخابات channel channel:#مراجعة-الترشيحات",
      "/انتخابات start-voting id:1",
      "/انتخابات close id:1"
    ],
    category: "elections",
    slashOnly: true,
    systemFlag: "elections.enabled",
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("انتخابات")
      .setDescription("نظام الانتخابات بمرشحين")
      .addSubcommand((s) =>
        s.setName("create").setDescription("إنشاء انتخاب جديد")
          .addStringOption((o) => o.setName("title").setDescription("عنوان الانتخاب").setRequired(true).setMaxLength(100))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة نشر لوحة الانتخاب").setRequired(true).addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) => o.setName("description").setDescription("وصف قصير").setMaxLength(500))
          .addBooleanOption((o) => o.setName("multiple").setDescription("السماح بالتصويت لأكثر من مرشح (افتراضي: لا)"))
      )
      .addSubcommand((s) =>
        s.setName("start-voting").setDescription("إقفال التسجيل وفتح التصويت")
          .addIntegerOption((o) => o.setName("id").setDescription("معرّف الانتخاب").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("close").setDescription("إقفال الانتخاب نهائيًا")
          .addIntegerOption((o) => o.setName("id").setDescription("معرّف الانتخاب").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("channel").setDescription("قناة مراجعة طلبات الترشّح")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) => s.setName("list").setDescription("الانتخابات الحالية"))
      .addSubcommand((s) =>
        s.setName("results").setDescription("عرض نتائج انتخاب")
          .addIntegerOption((o) => o.setName("id").setDescription("معرّف الانتخاب").setRequired(true))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;

      if (sub === "channel") {
        const channel = ctx.interaction.options.getChannel("channel");
        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }
        ctx.app.guildConfig.set(guildId, "elections.reviewChannelId", channel.id);
        return ctx.success(`سيتم إرسال طلبات الترشّح للمراجعة في <#${channel.id}>.`);
      }

      if (sub === "list") {
        const elections = ctx.app.elections.listActive(guildId);
        if (!elections.length) return ctx.fail("errors.actionFailed", { details: "ما فيه انتخابات نشطة حاليًا." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🗳️ الانتخابات الحالية",
            description: elections
              .map((e) => `**#${e.id}** — ${e.title}\n  الحالة: \`${e.status}\` • ${timestamp(e.created_at, "R")}`)
              .join("\n\n"),
            color: ctx.color("primary")
          })]
        }, { ephemeral: true });
      }

      if (sub === "results") {
        const id = ctx.interaction.options.getInteger("id");
        const election = ctx.app.elections.getById(id);
        if (!election || election.guild_id !== guildId) return ctx.fail("errors.actionFailed", { details: "ما لقيت انتخابًا بهذا المعرّف." });
        const results = ctx.app.elections.results(id);
        return ctx.reply({ embeds: [ctx.app.electionService.resultsEmbed(election, results)] });
      }

      if (sub === "create") {
        const channel = ctx.interaction.options.getChannel("channel");
        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }

        const election = ctx.app.elections.create({
          guildId,
          title: ctx.interaction.options.getString("title"),
          description: ctx.interaction.options.getString("description"),
          multipleVotes: ctx.interaction.options.getBoolean("multiple"),
          createdBy: ctx.user.id
        });

        const payload = ctx.app.electionService.panelPayload(election);
        const message = await channel.send(payload).catch(() => null);
        if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر لوحة الانتخاب." });

        ctx.app.elections.setMessage(election.id, channel.id, message.id);

        return ctx.success(
          `تم إنشاء الانتخاب **#${election.id}** ونشره في <#${channel.id}>.\n` +
          `التسجيل مفتوح الآن. لما تجهز، استخدم \`/انتخابات start-voting id:${election.id}\` لفتح التصويت.`
        );
      }

      // start-voting / close
      const id = ctx.interaction.options.getInteger("id");
      const election = ctx.app.elections.getById(id);
      if (!election || election.guild_id !== guildId) return ctx.fail("errors.actionFailed", { details: "ما لقيت انتخابًا بهذا المعرّف." });

      if (sub === "start-voting") {
        if (!ctx.app.elections.startVoting(id)) {
          return ctx.fail("errors.actionFailed", { details: "الانتخاب ليس في مرحلة التسجيل، أو التصويت مفتوح بالفعل." });
        }
        const candidateCount = ctx.app.elections.listCandidates(id, { approvedOnly: true }).length;
        await ctx.app.electionService.refreshPanel(ctx.app.elections.getById(id));
        return ctx.success(
          `تم فتح التصويت للانتخاب **#${id}**.\n` +
          (candidateCount ? `عدد المرشحين المعتمدين: **${candidateCount}**` : `${ctx.emoji("warning")} تنبيه: ما فيه مرشحون معتمدون بعد.`)
        );
      }

      // close
      if (!ctx.app.elections.close(id)) {
        return ctx.fail("errors.actionFailed", { details: "الانتخاب مغلق بالفعل." });
      }
      const fresh = ctx.app.elections.getById(id);
      await ctx.app.electionService.refreshPanel(fresh);
      const results = ctx.app.elections.results(id);

      return ctx.reply({
        embeds: [
          buildEmbed({ description: `${ctx.emoji("success")} تم إقفال الانتخاب **#${id}** نهائيًا.`, color: ctx.color("success") }),
          ctx.app.electionService.resultsEmbed(fresh, results)
        ]
      });
    }
  }
];
