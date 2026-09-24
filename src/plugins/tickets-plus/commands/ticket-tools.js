const { SlashCommandBuilder, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { parseDuration } = require("../../../core/utils/common");

const priorityChoices = [{ name: "منخفضة", value: "low" }, { name: "عادية", value: "normal" }, { name: "عالية", value: "high" }, { name: "عاجلة", value: "urgent" }];

module.exports = [
  {
    name: "تذكرة",
    aliases: ["ticket", "tk"],
    subAliases: { معلومات: "info", نقل: "transfer", أولوية: "priority", وسم: "tag", تكليف: "assign", قفل: "lock", فتح: "unlock", اغلاق: "close", تصعيد: "escalate", نوع: "type", احصائيات: "stats" },
    description: "أدوات التذكرة المتقدمة داخل قناة التذكرة: نقل، أولوية، وسوم، تكليف، قفل، إغلاق مؤجل، تغيير النوع، تصعيد، وإحصاءات الطاقم.",
    usage: "/تذكرة priority level:high | /تذكرة close delay:10m | !ticket info",
    arguments: [
      { name: "info", required: false, description: "تفاصيل التذكرة وخطها الزمني" },
      { name: "transfer", required: false, description: "نقل الاستلام لموظف آخر" },
      { name: "priority / tag / assign / unassign", required: false, description: "التنظيم والتكليف" },
      { name: "lock / unlock", required: false, description: "قفل الكتابة لصاحب التذكرة" },
      { name: "close / cancel-close", required: false, description: "إغلاق مؤجل قابل للإلغاء" },
      { name: "type / escalate", required: false, description: "تغيير النوع والتصعيد" },
      { name: "stats / settings", required: false, description: "إحصاءات الطاقم والإعدادات" }
    ],
    examples: ["!ticket info", "/تذكرة transfer user:@موظف", "/تذكرة close delay:5m reason:تم الحل"],
    category: "tickets",
    cooldown: 2000,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("تذكرة")
      .setDescription("أدوات التذكرة")
      .addSubcommand((s) => s.setName("info").setDescription("تفاصيل التذكرة"))
      .addSubcommand((s) => s.setName("transfer").setDescription("نقل الاستلام").addUserOption((o) => o.setName("user").setDescription("الموظف").setRequired(true)))
      .addSubcommand((s) => s.setName("priority").setDescription("الأولوية").addStringOption((o) => o.setName("level").setDescription("الأولوية").setRequired(true).addChoices(...priorityChoices)))
      .addSubcommand((s) => s.setName("tag").setDescription("وسم")
        .addStringOption((o) => o.setName("action").setDescription("إضافة/حذف").setRequired(true).addChoices({ name: "إضافة", value: "add" }, { name: "حذف", value: "remove" }))
        .addStringOption((o) => o.setName("name").setDescription("الوسم").setRequired(true).setMaxLength(20)))
      .addSubcommand((s) => s.setName("assign").setDescription("تكليف موظف إضافي").addUserOption((o) => o.setName("user").setDescription("الموظف").setRequired(true)))
      .addSubcommand((s) => s.setName("unassign").setDescription("إلغاء تكليف").addUserOption((o) => o.setName("user").setDescription("الموظف").setRequired(true)))
      .addSubcommand((s) => s.setName("lock").setDescription("قفل الكتابة"))
      .addSubcommand((s) => s.setName("unlock").setDescription("فتح الكتابة"))
      .addSubcommand((s) => s.setName("close").setDescription("إغلاق مؤجل")
        .addStringOption((o) => o.setName("delay").setDescription("بعد (5m, 1h)").setMaxLength(10))
        .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(300)))
      .addSubcommand((s) => s.setName("cancel-close").setDescription("إلغاء الإغلاق المؤجل"))
      .addSubcommand((s) => s.setName("type").setDescription("تغيير النوع").addStringOption((o) => o.setName("type").setDescription("النوع").setRequired(true).setAutocomplete(true)))
      .addSubcommand((s) => s.setName("escalate").setDescription("تصعيد للإدارة العليا").addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(300)))
      .addSubcommand((s) => s.setName("stats").setDescription("إحصاءات الطاقم")
        .addUserOption((o) => o.setName("user").setDescription("موظف محدد"))
        .addIntegerOption((o) => o.setName("days").setDescription("آخر كم يوم").setMinValue(1).setMaxValue(365)))
      .addSubcommand((s) => s.setName("settings").setDescription("إعدادات (أدمن)")
        .addIntegerOption((o) => o.setName("cooldown").setDescription("تبريد فتح التذاكر بالدقائق").setMinValue(0).setMaxValue(10080))
        .addIntegerOption((o) => o.setName("sla-low").setDescription("SLA منخفضة (دقائق)").setMinValue(0))
        .addIntegerOption((o) => o.setName("sla-normal").setDescription("SLA عادية (دقائق)").setMinValue(0))
        .addIntegerOption((o) => o.setName("sla-high").setDescription("SLA عالية (دقائق)").setMinValue(0))
        .addIntegerOption((o) => o.setName("sla-urgent").setDescription("SLA عاجلة (دقائق)").setMinValue(0))
        .addChannelOption((o) => o.setName("escalation-channel").setDescription("قناة التصعيد").addChannelTypes(ChannelType.GuildText))
        .addRoleOption((o) => o.setName("escalation-role").setDescription("رتبة التصعيد"))
        .addBooleanOption((o) => o.setName("auto-escalate").setDescription("تصعيد تلقائي عند خرق SLA"))),

    async autocomplete(interaction, app) {
      const typed = String(interaction.options.getFocused() || "").toLowerCase();
      const list = app.ticketTypes.list(interaction.guild.id).map((t) => ({ name: `${t.emoji || "🎫"} ${t.label}`.slice(0, 100), value: t.id }));
      return interaction.respond(list.filter((x) => x.name.toLowerCase().includes(typed)).slice(0, 25));
    },

    async execute(ctx) {
      const app = ctx.app;
      const svc = app.ticketsPlus;
      const guild = ctx.guild;
      const sub = ctx.subcommand();
      const t = (k, v) => ctx.t(k, v);
      const level = app.permissions.resolveLevel(ctx.member);
      const fail = (res) => {
        const text = t(`tk.err.${res.reason}`, { max: res.max ?? "" });
        return ctx.fail("errors.actionFailed", { details: text.startsWith("tk.err.") ? res.reason : text });
      };

      if (sub === "stats") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");
        const user = await ctx.getUser("user", 0);
        return ctx.reply(svc.statsPayload(guild, user?.id || null, ctx.getNumber("days", 1) || 30));
      }

      if (sub === "settings") {
        if (level < Level.ADMIN) return ctx.fail("errors.noPermission");
        const o = ctx.interaction?.options;
        if (!o) return fail({ reason: "slashOnly" });
        const updates = {};
        if (o.getInteger("cooldown") !== null) updates["tickets.cooldownMs"] = o.getInteger("cooldown") * 60_000;
        for (const p of ["low", "normal", "high", "urgent"]) if (o.getInteger(`sla-${p}`) !== null) updates[`tickets.sla.${p}`] = o.getInteger(`sla-${p}`);
        if (o.getChannel("escalation-channel")) updates["tickets.escalation.channelId"] = o.getChannel("escalation-channel").id;
        if (o.getRole("escalation-role")) updates["tickets.escalation.roleId"] = o.getRole("escalation-role").id;
        if (o.getBoolean("auto-escalate") !== null) updates["tickets.escalation.autoOnBreach"] = o.getBoolean("auto-escalate");
        if (Object.keys(updates).length) app.guildConfig.setMany(guild.id, updates);
        const c = svc.config(guild.id);
        return ctx.reply({
          embeds: [ctx.embed({
            title: `⚙️ ${t("tk.settingsTitle")}`,
            color: "info",
            fields: [
              { name: t("tk.cooldownLabel"), value: c.cooldownMs ? `${Math.round(c.cooldownMs / 60_000)}m` : "—", inline: true },
              { name: "SLA", value: ["low", "normal", "high", "urgent"].map((p) => `${t(`tk.priority.${p}`)}: ${c.sla?.[p] ?? "—"}m`).join("\n"), inline: true },
              { name: t("tk.escalationLabel"), value: `${c.escalation?.channelId ? `<#${c.escalation.channelId}>` : "—"} ${c.escalation?.roleId ? `<@&${c.escalation.roleId}>` : ""}\n${t("tk.auto")}: ${c.escalation?.autoOnBreach ? "✅" : "❌"}`, inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      // بقية الأوامر تعمل داخل قناة تذكرة فقط
      const ticket = svc.repo.byChannel(ctx.channel.id);
      if (!ticket) return fail({ reason: "notTicket" });
      const isOwner = ctx.user.id === ticket.owner_id;
      const staff = svc.isStaff(ctx.member, ticket);

      if (sub === "info") {
        if (!staff && !isOwner) return ctx.fail("errors.noPermission");
        return ctx.reply(svc.infoPayload(guild, ticket), { ephemeral: ctx.isSlash });
      }

      if (sub === "cancel-close") {
        if (!staff && !isOwner) return ctx.fail("errors.noPermission");
        const res = svc.cancelClose(ticket, ctx.member);
        return res.ok ? ctx.success(t("tk.closeCancelled")) : fail(res);
      }

      if (!staff) return ctx.fail("errors.noPermission");
      if (ticket.status !== "open" && sub !== "info") return fail({ reason: "notOpen" });

      if (sub === "transfer") {
        const target = await ctx.getMember("user", 0);
        if (!target) return ctx.fail("errors.memberNotFound");
        const res = await svc.transfer(guild, ticket, ctx.member, target);
        return res.ok ? ctx.success(t("tk.transferred", { user: `<@${target.id}>` })) : fail(res);
      }
      if (sub === "priority") {
        const res = svc.setPriority(guild, ticket, ctx.member, ctx.getString("level", 0));
        return res.ok ? ctx.success(t("tk.prioritySet", { priority: t(`tk.priority.${ctx.getString("level", 0)}`) })) : fail(res);
      }
      if (sub === "tag") {
        const res = svc.tag(ticket, ctx.member, ctx.getString("action", 0), ctx.getString("name", 1));
        return res.ok ? ctx.success(`${t("tk.tags")}: ${res.tags.map((x) => `\`${x}\``).join(" ") || "—"}`) : fail(res);
      }
      if (sub === "assign" || sub === "unassign") {
        const target = await ctx.getMember("user", 0);
        if (!target) return ctx.fail("errors.memberNotFound");
        const res = await svc.assign(guild, ticket, ctx.member, target, sub === "unassign");
        return res.ok ? ctx.success(`${t("tk.assignees")}: ${res.assignees.map((a) => `<@${a}>`).join(" ") || "—"}`) : fail(res);
      }
      if (sub === "lock" || sub === "unlock") {
        const res = await svc.lock(guild, ticket, ctx.member, sub === "lock");
        return res.ok ? ctx.success(t(sub === "lock" ? "tk.locked" : "tk.unlocked")) : fail(res);
      }
      if (sub === "close") {
        const raw = ctx.getString("delay", 0);
        const delay = raw ? parseDuration(raw) : 5 * 60_000;
        if (!delay || delay > 7 * 86_400_000) return ctx.fail("errors.invalidDuration");
        const res = await svc.scheduleClose(guild, ctx.channel, ticket, ctx.member, delay, ctx.isSlash ? ctx.interaction.options.getString("reason") : ctx.args.slice(1).join(" "));
        return res.ok ? ctx.reply({ content: `${ctx.emoji("success")} ${t("tk.closeScheduledShort")}` }, { ephemeral: true }) : fail(res);
      }
      if (sub === "type") {
        const res = await svc.changeType(guild, ticket, ctx.member, ctx.getString("type", 0));
        return res.ok ? ctx.success(t("tk.typeChanged", { type: res.type.label })) : fail(res);
      }
      if (sub === "escalate") {
        const res = await svc.escalate(guild, ticket, ctx.member, ctx.isSlash ? ctx.interaction.options.getString("reason") : ctx.args.join(" "));
        return res.ok ? ctx.success(t("tk.escalatedShort")) : fail(res);
      }
      return ctx.fail("errors.actionFailed", { details: sub || "?" });
    }
  }
];
