const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");

const SYSTEM = "social.enabled";

module.exports = [
  {
    name: "تغريدة",
    aliases: ["tweet", "social"],
    description: "منشورات اجتماعية داخل السيرفر: نشر، ملف شخصي، خلاصة، وصدارة الأكثر تفاعلًا.",
    usage: "/تغريدة post content:<النص>",
    arguments: [
      { name: "post", required: false, description: "نشر تغريدة جديدة" },
      { name: "profile", required: false, description: "عرض ملفك أو ملف عضو آخر" },
      { name: "setup-profile", required: false, description: "إنشاء أو تعديل ملفك الشخصي" },
      { name: "feed", required: false, description: "آخر المنشورات" },
      { name: "top", required: false, description: "صدارة الأكثر نشاطًا أو إعجابًا" },
      { name: "channel", required: false, description: "تحديد قناة الخلاصة (أدمن)" },
      { name: "report-channel", required: false, description: "تحديد قناة مراجعة البلاغات (أدمن)" },
      { name: "rep / follow / friend", required: false, description: "سمعة، متابعة، صداقات" },
      { name: "block / comment / privacy", required: false, description: "حظر وكتم، تعليقات الملف، الخصوصية" }
    ],
    examples: [
      "/تغريدة post content:أول تغريدة لي في السيرفر!",
      "/تغريدة setup-profile handle:ahmed_x display:أحمد",
      "/تغريدة channel channel:#الخلاصة"
    ],
    category: "social",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("تغريدة")
      .setDescription("المنشورات الاجتماعية")
      .addSubcommand((s) =>
        s.setName("post").setDescription("نشر تغريدة")
          .addStringOption((o) => o.setName("content").setDescription("محتوى المنشور").setRequired(true).setMaxLength(280))
      )
      .addSubcommand((s) =>
        s.setName("profile").setDescription("عرض ملف شخصي")
          .addUserOption((o) => o.setName("user").setDescription("عضو آخر (اختياري)"))
      )
      .addSubcommand((s) =>
        s.setName("setup-profile").setDescription("إنشاء أو تعديل ملفك")
          .addStringOption((o) => o.setName("handle").setDescription("معرّفك (أحرف/أرقام إنجليزية، 3-20، بلا مسافات)").setRequired(true).setMaxLength(20))
          .addStringOption((o) => o.setName("display").setDescription("الاسم الظاهر").setRequired(true).setMaxLength(50))
      )
      .addSubcommand((s) => s.setName("bio").setDescription("تعديل النبذة التعريفية")
        .addStringOption((o) => o.setName("text").setDescription("النبذة").setRequired(true).setMaxLength(160)))
      .addSubcommand((s) => s.setName("feed").setDescription("آخر المنشورات"))
      .addSubcommand((s) =>
        s.setName("top").setDescription("صدارة الأكثر تفاعلًا")
          .addStringOption((o) => o.setName("by").setDescription("الترتيب حسب").addChoices({ name: "الأكثر منشورات", value: "posts" }, { name: "الأكثر إعجابًا", value: "likes" }))
      )
      .addSubcommand((s) =>
        s.setName("channel").setDescription("تحديد قناة الخلاصة")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) =>
        s.setName("report-channel").setDescription("تحديد قناة مراجعة البلاغات")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) => s.setName("rep").setDescription("منح سمعة لعضو")
        .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
        .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(200)))
      .addSubcommand((s) => s.setName("follow").setDescription("متابعة/إلغاء متابعة")
        .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true)))
      .addSubcommand((s) => s.setName("friend").setDescription("الصداقات")
        .addStringOption((o) => o.setName("action").setDescription("الإجراء").setRequired(true).addChoices(
          { name: "طلب/قبول", value: "add" }, { name: "إزالة", value: "remove" }, { name: "رفض طلب", value: "decline" }, { name: "الطلبات والأصدقاء", value: "list" }))
        .addUserOption((o) => o.setName("user").setDescription("العضو")))
      .addSubcommand((s) => s.setName("block").setDescription("حظر/كتم عضو (تبديل)")
        .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
        .addBooleanOption((o) => o.setName("mute").setDescription("كتم فقط (إخفاء منشوراته عنك)")))
      .addSubcommand((s) => s.setName("comment").setDescription("تعليق على ملف عضو")
        .addUserOption((o) => o.setName("user").setDescription("صاحب الملف"))
        .addStringOption((o) => o.setName("text").setDescription("التعليق").setMaxLength(300))
        .addIntegerOption((o) => o.setName("delete").setDescription("رقم تعليق لحذفه").setMinValue(1)))
      .addSubcommand((s) => s.setName("privacy").setDescription("الخصوصية")
        .addStringOption((o) => o.setName("visibility").setDescription("من يرى ملفك").addChoices(
          { name: "الجميع", value: "public" }, { name: "الأصدقاء", value: "friends" }, { name: "أنا فقط", value: "private" }))
        .addBooleanOption((o) => o.setName("comments").setDescription("السماح بالتعليقات"))
        .addBooleanOption((o) => o.setName("friend-requests").setDescription("السماح بطلبات الصداقة"))
        .addBooleanOption((o) => o.setName("reps").setDescription("السماح بالسمعة"))),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const svc = ctx.app.socialService;

      if (sub === "channel" || sub === "report-channel") {
        if (ctx.app.permissions.resolveLevel(ctx.member) < Level.ADMIN) return ctx.fail("errors.noPermission");
        const channel = ctx.interaction.options.getChannel("channel");
        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }
        const key = sub === "channel" ? "social.feedChannelId" : "social.reportChannelId";
        ctx.app.guildConfig.set(guildId, key, channel.id);
        return ctx.success(`تم تحديد <#${channel.id}> ${sub === "channel" ? "كقناة الخلاصة" : "لمراجعة البلاغات"}.`);
      }

      if (sub === "setup-profile") {
        const handle = ctx.interaction.options.getString("handle").trim();
        if (!svc.validHandle(handle)) {
          return ctx.fail("errors.actionFailed", { details: "المعرّف يجب أن يكون 3-20 حرفًا إنجليزيًا أو رقمًا أو شرطة سفلية، بلا مسافات." });
        }
        const existing = ctx.app.social.getProfile(guildId, ctx.user.id);
        const taken = ctx.app.social.getProfileByHandle(guildId, handle);
        if (taken && taken.user_id !== ctx.user.id) {
          return ctx.fail("errors.actionFailed", { details: `المعرّف \`@${handle}\` مستخدم من عضو آخر.` });
        }

        const display = ctx.interaction.options.getString("display");
        if (existing) {
          ctx.app.social.updateHandle(guildId, ctx.user.id, handle, display);
          return ctx.success(`تم تحديث ملفك: **${display}** — @${handle}`);
        }
        ctx.app.social.createProfile({ guildId, userId: ctx.user.id, handle, displayName: display });
        return ctx.success(`تم إنشاء ملفك: **${display}** — @${handle}`);
      }

      if (sub === "bio") {
        const profile = ctx.app.social.getProfile(guildId, ctx.user.id);
        if (!profile) return ctx.fail("errors.actionFailed", { details: "أنشئ ملفك أولًا بـ `/تغريدة setup-profile`." });
        ctx.app.social.updateBio(guildId, ctx.user.id, ctx.interaction.options.getString("text"));
        return ctx.success("تم تحديث نبذتك التعريفية.");
      }

      if (["rep", "follow", "friend", "block", "comment", "privacy"].includes(sub)) return socialPlus(ctx, sub);

      if (sub === "profile") {
        const target = ctx.interaction.options.getUser("user") || ctx.user;
        if (ctx.app.socialPlus && ctx.app.features.isEnabled(guildId, "social") && !ctx.app.socialPlus.canView(guildId, ctx.member, target.id)) {
          return ctx.fail("errors.actionFailed", { details: ctx.t("soc.hidden") });
        }
        const profile = ctx.app.social.getProfile(guildId, target.id);
        if (!profile) {
          return ctx.fail("errors.actionFailed", {
            details: target.id === ctx.user.id ? "ما عندك ملف بعد. أنشئه بـ `/تغريدة setup-profile`." : "هذا العضو ما عنده ملف اجتماعي بعد."
          });
        }
        return ctx.reply({ embeds: [svc.profileEmbed(ctx.guild, profile, target)] }, { ephemeral: true });
      }

      if (sub === "feed") {
        let posts = ctx.app.social.feed(guildId, { limit: 25 });
        // المكتومون والمحظورون لا تظهر منشوراتهم لهذا العضو
        if (ctx.app.socialPlusRepo) posts = posts.filter((p) => !ctx.app.socialPlusRepo.has(guildId, ctx.user.id, p.author_id, "mute") && !ctx.app.socialPlus.blockedEither(guildId, ctx.user.id, p.author_id));
        posts = posts.slice(0, 10);
        return ctx.reply({ embeds: [svc.feedEmbed(ctx.guild, posts)] }, { ephemeral: true });
      }

      if (sub === "top") {
        const byLikes = ctx.interaction.options.getString("by") === "likes";
        const rows = byLikes ? ctx.app.social.topByLikes(guildId, 10) : ctx.app.social.topByPosts(guildId, 10);
        return ctx.reply({ embeds: [svc.leaderboardEmbed(ctx.guild, rows, { byLikes })] });
      }

      // post
      if (!svc.enabled(guildId)) {
        return ctx.fail("errors.actionFailed", { details: "قناة الخلاصة غير محددة. استخدم `/تغريدة channel` أولًا (أدمن)." });
      }

      svc.ensureProfile(guildId, ctx.user.id, ctx.member.displayName || ctx.user.username);
      const content = ctx.interaction.options.getString("content");
      const result = await svc.publish({ guild: ctx.guild, author: ctx.user, content });

      return ctx.success(`تم نشر تغريدتك${result.posted ? "" : " (محفوظة، لكن تعذّر نشرها بالخلاصة)"}.`);
    }
  }
];

async function socialPlus(ctx, sub) {
  const app = ctx.app;
  const svc = app.socialPlus;
  if (!svc || !app.features.isEnabled(ctx.guild.id, "social")) return ctx.fail("errors.systemDisabled", { system: "social-plus" });
  const o = ctx.interaction.options;
  const t = (k, v) => ctx.t(k, v);
  const user = o.getUser("user");
  const fail = (res) => ctx.fail("errors.actionFailed", { details: svc.describe(res, t) });
  const mention = user ? `<@${user.id}>` : "";

  if (sub === "rep") {
    const res = svc.giveRep(ctx.guild, ctx.user, user, o.getString("reason"));
    return res.ok ? ctx.success(t("soc.repGiven", { user: mention, total: res.total })) : fail(res);
  }
  if (sub === "follow") {
    const res = svc.toggleFollow(ctx.guild, ctx.user, user);
    return res.ok ? ctx.success(t(res.following ? "soc.followOn" : "soc.followOff", { user: mention })) : fail(res);
  }
  if (sub === "block") {
    const kind = o.getBoolean("mute") ? "mute" : "block";
    const res = svc.toggleBlock(ctx.guild, ctx.user, user, kind);
    if (!res.ok) return fail(res);
    return ctx.reply({ content: `${ctx.emoji("success")} ${t(`soc.${kind}${res.on ? "On" : "Off"}`, { user: mention })}`, allowedMentions: { parse: [] } }, { ephemeral: true });
  }
  if (sub === "friend") {
    const action = o.getString("action");
    if (action === "list") {
      const repo = app.socialPlusRepo;
      const requests = repo.incomingRequests(ctx.guild.id, ctx.user.id).map((r) => `<@${r.requester_id}>`);
      const friends = repo.friends(ctx.guild.id, ctx.user.id).map((id) => `<@${id}>`);
      return ctx.reply({
        embeds: [ctx.embed({ title: "🤝", color: "info", fields: [
          { name: t("soc.requests"), value: requests.join(" ").slice(0, 1024) || "—" },
          { name: t("soc.friends"), value: friends.join(" ").slice(0, 1024) || "—" }
        ] })],
        allowedMentions: { parse: [] }
      }, { ephemeral: true });
    }
    if (!user) return ctx.fail("errors.userNotFound");
    let res;
    if (action === "add") res = await svc.requestFriend(ctx.guild, ctx.user, user);
    else if (action === "decline") res = svc.declineFriend(ctx.guild, ctx.user, user.id);
    else res = svc.removeFriend(ctx.guild, ctx.user, user);
    if (!res.ok) return fail(res);
    const text = action === "add" ? (res.accepted ? t("soc.friendAccepted", { user: mention }) : t("soc.friendSent")) : action === "decline" ? t("soc.friendDeclined") : t("soc.friendRemoved");
    return ctx.reply({ content: `${ctx.emoji("success")} ${text}`, allowedMentions: { parse: [] } }, { ephemeral: true });
  }
  if (sub === "comment") {
    const del = o.getInteger("delete");
    if (del) {
      const res = svc.deleteComment(ctx.guild, ctx.member, del);
      return res.ok ? ctx.success(t("soc.commentDeleted")) : fail(res);
    }
    const res = svc.comment(ctx.guild, ctx.user, user, o.getString("text"));
    return res.ok ? ctx.success(t("soc.commented", { id: res.id })) : fail(res);
  }
  // privacy
  const fields = {};
  if (o.getString("visibility")) fields.visibility = o.getString("visibility");
  if (o.getBoolean("comments") !== null) fields.allow_comments = o.getBoolean("comments");
  if (o.getBoolean("friend-requests") !== null) fields.allow_friend_requests = o.getBoolean("friend-requests");
  if (o.getBoolean("reps") !== null) fields.allow_reps = o.getBoolean("reps");
  const p = app.socialPlusRepo.setPrivacy(ctx.guild.id, ctx.user.id, fields);
  return ctx.reply({ content: `${ctx.emoji("success")} ${t("soc.privacySaved")} — \`${p.visibility}\` • 💬 ${p.allow_comments ? "✅" : "❌"} • 🤝 ${p.allow_friend_requests ? "✅" : "❌"} • 👍 ${p.allow_reps ? "✅" : "❌"}` }, { ephemeral: true });
}
