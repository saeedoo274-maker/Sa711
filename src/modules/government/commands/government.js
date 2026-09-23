const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp, truncate, formatDuration } = require("../../../core/utils/helpers");

const SYSTEM = "government.enabled";

module.exports = [
  {
    name: "حكومة",
    aliases: ["government", "gov"],
    description: "مجلس الشورى والتعميمات الإدارية والتقاعد.",
    usage: "/حكومة مجلس channel:#مجلس-الشورى",
    arguments: [
      { name: "مجلس", required: false, description: "نشر لوحة مجلس الشورى" },
      { name: "مشاريع", required: false, description: "عرض مشاريع القرارات" },
      { name: "تعميم", required: false, description: "إصدار تعميم إداري مرقّم" },
      { name: "التعاميم", required: false, description: "عرض التعاميم السابقة" },
      { name: "تقاعد", required: false, description: "إحالة عضو للتقاعد مع حفظ رتبه" },
      { name: "المتقاعدون", required: false, description: "سجل المتقاعدين" },
      { name: "اعدادات", required: false, description: "ضبط القنوات والرتب" }
    ],
    examples: [
      "/حكومة مجلس channel:#مجلس-الشورى",
      "/حكومة تعميم title:تنظيم الدوام body:يبدأ الدوام الساعة 8",
      "/حكومة تقاعد user:@أحمد reason:انتهاء فترة الخدمة"
    ],
    category: "government",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("حكومة")
      .setDescription("الأنظمة الحكومية")
      .addSubcommand((s) =>
        s.setName("مجلس").setDescription("نشر لوحة مجلس الشورى")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) =>
        s.setName("مشاريع").setDescription("عرض مشاريع القرارات")
          .addStringOption((o) =>
            o.setName("status").setDescription("الحالة")
              .addChoices({ name: "مفتوح", value: "open" }, { name: "معتمد", value: "approved" }, { name: "مرفوض", value: "rejected" })
          )
      )
      .addSubcommand((s) =>
        s.setName("تعميم").setDescription("إصدار تعميم إداري")
          .addStringOption((o) => o.setName("title").setDescription("عنوان التعميم").setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName("body").setDescription("نص التعميم").setRequired(true).setMaxLength(1800))
          .addStringOption((o) => o.setName("authority").setDescription("الجهة المُصدِرة").setMaxLength(100))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة النشر (افتراضي: قناة التعاميم)").addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) => s.setName("التعاميم").setDescription("عرض التعاميم السابقة"))
      .addSubcommand((s) =>
        s.setName("تقاعد").setDescription("إحالة عضو للتقاعد")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("سبب التقاعد").setMaxLength(500))
          .addStringOption((o) => o.setName("honor").setDescription("كلمة تكريم").setMaxLength(800))
      )
      .addSubcommand((s) => s.setName("المتقاعدون").setDescription("سجل المتقاعدين"))
      .addSubcommand((s) =>
        s.setName("اعدادات").setDescription("ضبط النظام")
          .addChannelOption((o) => o.setName("council").setDescription("قناة مجلس الشورى").addChannelTypes(ChannelType.GuildText))
          .addChannelOption((o) => o.setName("circulars").setDescription("قناة التعاميم").addChannelTypes(ChannelType.GuildText))
          .addChannelOption((o) => o.setName("retirements").setDescription("قناة قرارات التقاعد").addChannelTypes(ChannelType.GuildText))
          .addRoleOption((o) => o.setName("council-role").setDescription("رتبة أعضاء المجلس (من يحق له التصويت)"))
          .addRoleOption((o) => o.setName("retired-role").setDescription("رتبة تُمنح للمتقاعد"))
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل النظام"))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const svc = ctx.app.governmentService;
      const level = ctx.app.permissions.resolveLevel(ctx.member);
      const me = ctx.guild.members.me;

      if (sub === "مشاريع") {
        const status = ctx.interaction.options.getString("status");
        const rows = ctx.app.government.listProjects(guildId, { status });
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه مشاريع مطابقة." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🏛️ مشاريع القرارات",
            description: rows
              .map((r) => {
                const icon = { open: "🟢", approved: "✅", rejected: "❌" }[r.status];
                const c = ctx.app.government.voteCounts(r.id);
                return `${icon} **#${r.number}** ${truncate(r.title, 60)}\n  ✅${c.yes} ❌${c.no} ⚪${c.abstain} • ${timestamp(r.created_at, "R")}`;
              })
              .join("\n"),
            color: ctx.color("primary")
          })]
        }, { ephemeral: true });
      }

      if (sub === "التعاميم") {
        const rows = ctx.app.government.listCirculars(guildId);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه تعاميم بعد." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "📢 التعاميم الإدارية",
            description: rows
              .map((r) => `**#${r.number}** ${truncate(r.title, 70)}\n  ${r.authority || "الإدارة"} • ${timestamp(r.created_at, "R")}`)
              .join("\n"),
            color: ctx.color("primary")
          })]
        }, { ephemeral: true });
      }

      if (sub === "المتقاعدون") {
        const rows = ctx.app.government.listRetirements(guildId);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه متقاعدون بعد." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🎗️ سجل المتقاعدين",
            description: rows
              .map((r) => `**#${r.number}** <@${r.user_id}>${r.service_ms ? ` — خدمة ${formatDuration(r.service_ms)}` : ""} • ${timestamp(r.created_at, "R")}`)
              .join("\n"),
            color: ctx.color("primary")
          })]
        }, { ephemeral: true });
      }

      // ما بعده إداري
      if (level < Level.ADMIN) return ctx.fail("errors.noPermission");

      if (sub === "مجلس") {
        const channel = ctx.interaction.options.getChannel("channel");
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }
        const message = await channel.send(svc.councilPanelPayload()).catch(() => null);
        if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر اللوحة." });
        ctx.app.guildConfig.set(guildId, "government.councilChannelId", channel.id);
        return ctx.success(`تم نشر لوحة مجلس الشورى في <#${channel.id}>، وحُدِّدت كقناة المجلس.`);
      }

      if (sub === "تعميم") {
        const cfg = svc.config(guildId);
        const channel = ctx.interaction.options.getChannel("channel")
          || (cfg.circularsChannelId ? await ctx.app.client.channels.fetch(cfg.circularsChannelId).catch(() => null) : null);

        if (!channel?.isTextBased?.()) {
          return ctx.fail("errors.actionFailed", { details: "حدد قناة النشر أو اضبط قناة التعاميم من `/حكومة اعدادات`." });
        }
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }

        const circular = ctx.app.government.createCircular({
          guildId,
          title: ctx.interaction.options.getString("title"),
          body: ctx.interaction.options.getString("body"),
          authority: ctx.interaction.options.getString("authority"),
          issuerId: ctx.user.id
        });

        const message = await channel.send(svc.circularPayload(ctx.guild, circular)).catch(() => null);
        if (message) ctx.app.government.setCircularMessage(circular.id, channel.id, message.id);

        return ctx.success(`تم إصدار التعميم رقم **#${circular.number}** في <#${channel.id}>.`);
      }

      if (sub === "تقاعد") {
        const user = ctx.interaction.options.getUser("user");
        const member = await ctx.guild.members.fetch(user.id).catch(() => null);
        if (!member) return ctx.fail("errors.memberNotFound");
        if (user.bot) return ctx.fail("errors.actionFailed", { details: "البوتات ما تتقاعد." });

        await ctx.defer();
        const result = await svc.retire(ctx.guild, member, {
          reason: ctx.interaction.options.getString("reason"),
          honor: ctx.interaction.options.getString("honor"),
          retiredBy: ctx.user.id
        });

        const cfg = svc.config(guildId);
        if (cfg.retirementsChannelId) {
          const channel = await ctx.app.client.channels.fetch(cfg.retirementsChannelId).catch(() => null);
          if (channel?.isTextBased()) {
            const message = await channel.send(svc.retirementPayload(ctx.guild, result.record)).catch(() => null);
            if (message) ctx.app.government.setRetirementMessage(result.record.id, channel.id, message.id);
          }
        }

        await user.send({
          content: `🎗️ تمت إحالتك للتقاعد في **${ctx.guild.name}**.${result.record.honor ? `\n\n${result.record.honor}` : ""}`
        }).catch(() => {});

        return ctx.reply({
          content: `${ctx.emoji("success")} تمت إحالة <@${user.id}> للتقاعد برقم **#${result.record.number}**.\nسُحبت \`${result.removed}\` رتبة وحُفظت في السجل.`
        });
      }

      // اعدادات
      const updates = {};
      const pairs = [
        [ctx.interaction.options.getChannel("council"), "government.councilChannelId"],
        [ctx.interaction.options.getChannel("circulars"), "government.circularsChannelId"],
        [ctx.interaction.options.getChannel("retirements"), "government.retirementsChannelId"]
      ];
      for (const [channel, key] of pairs) {
        if (!channel) continue;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }
        updates[key] = channel.id;
      }

      const councilRole = ctx.interaction.options.getRole("council-role");
      const retiredRole = ctx.interaction.options.getRole("retired-role");
      if (councilRole) updates["government.councilRoleId"] = councilRole.id;
      if (retiredRole) {
        if (retiredRole.managed || retiredRole.position >= me.roles.highest.position) {
          return ctx.fail("errors.actionFailed", { details: `لا أستطيع إدارة <@&${retiredRole.id}> — ارفع رتبة البوت فوقها.` });
        }
        updates["government.retiredRoleId"] = retiredRole.id;
      }
      const enabled = ctx.interaction.options.getBoolean("enabled");
      if (enabled !== null) updates["government.enabled"] = enabled;

      if (!Object.keys(updates).length) {
        return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
      }

      ctx.app.guildConfig.setMany(guildId, updates);
      const cfg = svc.config(guildId);
      return ctx.reply({
        embeds: [buildEmbed({
          title: "⚙️ إعدادات الأنظمة الحكومية",
          color: ctx.color("success"),
          fields: [
            { name: "النظام", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
            { name: "قناة المجلس", value: cfg.councilChannelId ? `<#${cfg.councilChannelId}>` : "—", inline: true },
            { name: "قناة التعاميم", value: cfg.circularsChannelId ? `<#${cfg.circularsChannelId}>` : "—", inline: true },
            { name: "قناة التقاعد", value: cfg.retirementsChannelId ? `<#${cfg.retirementsChannelId}>` : "—", inline: true },
            { name: "رتبة المجلس", value: cfg.councilRoleId ? `<@&${cfg.councilRoleId}>` : "الجميع", inline: true },
            { name: "رتبة المتقاعد", value: cfg.retiredRoleId ? `<@&${cfg.retiredRoleId}>` : "—", inline: true }
          ]
        })]
      }, { ephemeral: true });
    }
  }
];
