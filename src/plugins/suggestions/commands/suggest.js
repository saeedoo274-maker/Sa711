const { SlashCommandBuilder, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { truncate } = require("../../../core/utils/common");

const statusChoices = [
  { name: "قيد المراجعة", value: "review" },
  { name: "مقبول", value: "accepted" },
  { name: "مرفوض", value: "rejected" },
  { name: "معلّق", value: "pending" }
];

function failReason(ctx, res) {
  const t = (k, v) => ctx.t(k, v);
  const details = {
    notConfigured: t("suggest.err.notConfigured"),
    missingRole: t("suggest.err.missingRole", { roles: (res.roles || []).map((r) => `<@&${r}>`).join(" ") }),
    wrongChannel: t("suggest.err.wrongChannel", { channels: (res.channels || []).map((c) => `<#${c}>`).join(" ") }),
    cooldown: t("suggest.err.cooldown", { seconds: res.seconds }),
    tooShort: t("suggest.err.tooShort", { min: res.min }),
    noAnonymous: t("suggest.err.noAnonymous"),
    sendFailed: t("suggest.err.sendFailed"),
    notFound: t("suggest.err.notFound"),
    same: t("suggest.err.same")
  }[res.reason] || res.reason;
  return ctx.fail("errors.actionFailed", { details });
}

module.exports = [
  {
    name: "اقتراح",
    aliases: ["suggest", "suggestion", "اقترح"],
    subAliases: { جديد: "new", عرض: "show", الأفضل: "top", احصائيات: "stats", قرار: "decide", حذف: "delete", اعدادات: "settings" },
    defaultSubcommand: "new",
    description: "نظام الاقتراحات: رفع اقتراح بتصويت، عرضه، الأفضل، الإحصاءات، وقرارات الطاقم.",
    usage: "/اقتراح new content:... [anonymous] | !suggest فكرتي...",
    arguments: [
      { name: "new", required: false, description: "رفع اقتراح جديد" },
      { name: "show", required: false, description: "عرض اقتراح برقمه" },
      { name: "top", required: false, description: "أفضل الاقتراحات" },
      { name: "stats", required: false, description: "إحصاءات الاقتراحات" },
      { name: "decide", required: false, description: "قبول/رفض/مراجعة (طاقم)" },
      { name: "delete", required: false, description: "حذف اقتراح (طاقم)" },
      { name: "settings", required: false, description: "الإعدادات (أدمن)" }
    ],
    examples: ["/اقتراح new content:إضافة قناة للألعاب", "!suggest إضافة قناة للألعاب", "/اقتراح decide number:4 status:accepted reason:تم"],
    category: "suggestions",
    cooldown: 5000,
    permissions: { level: Level.EVERYONE },
    featureExempt: (ctx) => ctx.subcommand() === "settings",
    slash: new SlashCommandBuilder()
      .setName("اقتراح")
      .setDescription("نظام الاقتراحات")
      .addSubcommand((s) => s.setName("new").setDescription("اقتراح جديد")
        .addStringOption((o) => o.setName("content").setDescription("نص الاقتراح").setRequired(true).setMinLength(3).setMaxLength(2000))
        .addBooleanOption((o) => o.setName("anonymous").setDescription("بدون إظهار اسمك")))
      .addSubcommand((s) => s.setName("show").setDescription("عرض اقتراح")
        .addIntegerOption((o) => o.setName("number").setDescription("رقم الاقتراح").setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName("top").setDescription("أفضل الاقتراحات")
        .addStringOption((o) => o.setName("status").setDescription("الحالة").addChoices(...statusChoices)))
      .addSubcommand((s) => s.setName("stats").setDescription("إحصاءات"))
      .addSubcommand((s) => s.setName("decide").setDescription("قرار الطاقم")
        .addIntegerOption((o) => o.setName("number").setDescription("رقم الاقتراح").setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName("status").setDescription("الحالة").setRequired(true).addChoices(...statusChoices))
        .addStringOption((o) => o.setName("reason").setDescription("رد الطاقم").setMaxLength(1000)))
      .addSubcommand((s) => s.setName("delete").setDescription("حذف اقتراح")
        .addIntegerOption((o) => o.setName("number").setDescription("رقم الاقتراح").setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName("settings").setDescription("إعدادات الاقتراحات")
        .addChannelOption((o) => o.setName("channel").setDescription("قناة الاقتراحات").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addChannelOption((o) => o.setName("archive").setDescription("قناة الأرشيف").addChannelTypes(ChannelType.GuildText))
        .addRoleOption((o) => o.setName("required-role").setDescription("رتبة مطلوبة للاقتراح (تبديل)"))
        .addRoleOption((o) => o.setName("vote-role").setDescription("رتبة مطلوبة للتصويت (تبديل)"))
        .addChannelOption((o) => o.setName("allowed-channel").setDescription("قناة يُسمح منها بالأمر (تبديل)"))
        .addBooleanOption((o) => o.setName("anonymous").setDescription("السماح بالمجهول"))
        .addBooleanOption((o) => o.setName("threads").setDescription("سلسلة نقاش لكل اقتراح"))
        .addIntegerOption((o) => o.setName("cooldown").setDescription("التبريد بالدقائق").setMinValue(0).setMaxValue(1440))
        .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل النظام"))),

    async execute(ctx) {
      const app = ctx.app;
      const svc = app.suggestions;
      const guild = ctx.guild;
      const sub = ctx.subcommand() || "new";
      const t = (k, v) => ctx.t(k, v);

      if (sub === "new") {
        const content = ctx.isSlash ? ctx.interaction.options.getString("content") : ctx.args.join(" ");
        const anonymous = ctx.isSlash ? !!ctx.interaction.options.getBoolean("anonymous") : false;
        const res = await svc.create(ctx.member, content, { anonymous, channelId: ctx.channel.id });
        if (!res.ok) return failReason(ctx, res);
        return ctx.reply({ content: `${ctx.emoji("success")} ${t("suggest.created", { number: res.suggestion.number, url: res.url })}` }, { ephemeral: true });
      }

      if (sub === "show") {
        const s = svc.repo.byNumber(guild.id, ctx.getNumber("number", 0));
        if (!s) return failReason(ctx, { reason: "notFound" });
        const payload = svc.render(s, guild);
        const history = svc.repo.history(s.id).map((h) => `\`${new Date(h.created_at).toISOString().slice(0, 16).replace("T", " ")}\` ${t(`suggest.status.${h.status}`)}${h.staff_id ? ` — <@${h.staff_id}>` : ""}`);
        payload.embeds[0].addFields({ name: t("suggest.history"), value: history.join("\n").slice(0, 1024) || "—" });
        if (s.message_id) payload.embeds[0].setURL(`https://discord.com/channels/${guild.id}/${s.channel_id}/${s.message_id}`);
        return ctx.reply({ embeds: payload.embeds, allowedMentions: { parse: [] } }, { ephemeral: true });
      }

      if (sub === "top") {
        const status = ctx.getString("status", 0);
        const rows = svc.repo.top(guild.id, { status, limit: 10 });
        return ctx.reply({
          embeds: [ctx.embed({
            title: `🏆 ${t("suggest.topTitle")}`,
            description: rows.map((s, i) => `**${i + 1}.** #${s.number} ${require("../SuggestionService").STATUS_STYLE[s.status].emoji} (+${s.upvotes}/-${s.downvotes}) — ${truncate(s.content, 80)}`).join("\n") || t("ui.empty"),
            color: "warning"
          })],
          allowedMentions: { parse: [] }
        });
      }

      if (sub === "stats") {
        const all = svc.repo.stats(guild.id);
        const month = svc.repo.stats(guild.id, Date.now() - 30 * 86_400_000);
        const decided = all.accepted + all.rejected;
        return ctx.reply({
          embeds: [ctx.embed({
            title: `📊 ${t("suggest.statsTitle")}`,
            color: "info",
            fields: [
              { name: t("suggest.total"), value: `\`${all.total}\` (${t("suggest.last30")}: \`${month.total}\`)`, inline: true },
              { name: t("suggest.status.pending"), value: `\`${all.pending}\``, inline: true },
              { name: t("suggest.status.review"), value: `\`${all.review}\``, inline: true },
              { name: t("suggest.status.accepted"), value: `\`${all.accepted}\``, inline: true },
              { name: t("suggest.status.rejected"), value: `\`${all.rejected}\``, inline: true },
              { name: t("suggest.acceptRate"), value: decided ? `\`${Math.round((all.accepted / decided) * 100)}%\`` : "—", inline: true },
              { name: t("suggest.votes"), value: `\`${all.votes}\``, inline: true }
            ]
          })]
        });
      }

      // ---- الطاقم ----
      if (!svc.isStaff(ctx.member)) return ctx.fail("errors.noPermission");

      if (sub === "decide") {
        const s = svc.repo.byNumber(guild.id, ctx.getNumber("number", 0));
        if (!s) return failReason(ctx, { reason: "notFound" });
        const status = ctx.getString("status", 1);
        const reason = ctx.isSlash ? ctx.interaction.options.getString("reason") : ctx.args.slice(2).join(" ") || null;
        const res = await svc.decide(guild, s.id, status, ctx.member, reason);
        if (!res.ok) return failReason(ctx, res);
        return ctx.success(t("suggest.decided", { number: s.number, status: t(`suggest.status.${status}`) }));
      }

      if (sub === "delete") {
        const s = svc.repo.byNumber(guild.id, ctx.getNumber("number", 0));
        if (!s) return failReason(ctx, { reason: "notFound" });
        await svc.remove(guild, s.id, ctx.member);
        return ctx.success(t("suggest.deleted", { number: s.number }));
      }

      if (sub === "settings") {
        if (app.permissions.resolveLevel(ctx.member) < Level.ADMIN) return ctx.fail("errors.noPermission");
        const o = ctx.isSlash ? ctx.interaction.options : null;
        const cfg = svc.config(guild.id);
        const updates = {};
        const toggle = (key, id) => {
          const set = new Set(cfg[key] || []);
          if (set.has(id)) set.delete(id);
          else set.add(id);
          updates[`suggestions.${key}`] = [...set];
        };
        if (o) {
          if (o.getChannel("channel")) updates["suggestions.channelId"] = o.getChannel("channel").id;
          if (o.getChannel("archive")) updates["suggestions.archiveChannelId"] = o.getChannel("archive").id;
          if (o.getRole("required-role")) toggle("requiredRoleIds", o.getRole("required-role").id);
          if (o.getRole("vote-role")) toggle("voteRoleIds", o.getRole("vote-role").id);
          if (o.getChannel("allowed-channel")) toggle("allowedChannelIds", o.getChannel("allowed-channel").id);
          if (o.getBoolean("anonymous") !== null) updates["suggestions.anonymousAllowed"] = o.getBoolean("anonymous");
          if (o.getBoolean("threads") !== null) updates["suggestions.threads"] = o.getBoolean("threads");
          if (o.getInteger("cooldown") !== null) updates["suggestions.cooldownMs"] = o.getInteger("cooldown") * 60_000;
          if (o.getBoolean("enabled") !== null) app.features.setForGuild(guild.id, "suggestions", o.getBoolean("enabled"));
        }
        if (Object.keys(updates).length) app.guildConfig.setMany(guild.id, updates);
        const c = svc.config(guild.id);
        const list = (ids, k) => (ids || []).map((id) => (k === "r" ? `<@&${id}>` : `<#${id}>`)).join(" ") || "—";
        return ctx.reply({
          embeds: [ctx.embed({
            title: `⚙️ ${t("suggest.settingsTitle")}`,
            color: svc.isReady(guild.id) ? "success" : "neutral",
            fields: [
              { name: t("suggest.set.channel"), value: c.channelId ? `<#${c.channelId}>` : "⚠️ —", inline: true },
              { name: t("suggest.set.archive"), value: c.archiveChannelId ? `<#${c.archiveChannelId}>` : "—", inline: true },
              { name: t("suggest.set.enabled"), value: app.features.isEnabled(guild.id, "suggestions") ? "✅" : "❌", inline: true },
              { name: t("suggest.set.requiredRoles"), value: list(c.requiredRoleIds, "r"), inline: true },
              { name: t("suggest.set.voteRoles"), value: list(c.voteRoleIds, "r"), inline: true },
              { name: t("suggest.set.allowedChannels"), value: list(c.allowedChannelIds, "c"), inline: true },
              { name: t("suggest.set.anonymous"), value: c.anonymousAllowed ? "✅" : "❌", inline: true },
              { name: t("suggest.set.threads"), value: c.threads ? "✅" : "❌", inline: true },
              { name: t("suggest.set.cooldown"), value: `\`${Math.round((c.cooldownMs || 0) / 60_000)}m\``, inline: true }
            ]
          })]
        }, { ephemeral: true });
      }
      return ctx.fail("errors.actionFailed", { details: sub });
    }
  }
];
