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
      { name: "report-channel", required: false, description: "تحديد قناة مراجعة البلاغات (أدمن)" }
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
      ),

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

      if (sub === "profile") {
        const target = ctx.interaction.options.getUser("user") || ctx.user;
        const profile = ctx.app.social.getProfile(guildId, target.id);
        if (!profile) {
          return ctx.fail("errors.actionFailed", {
            details: target.id === ctx.user.id ? "ما عندك ملف بعد. أنشئه بـ `/تغريدة setup-profile`." : "هذا العضو ما عنده ملف اجتماعي بعد."
          });
        }
        return ctx.reply({ embeds: [svc.profileEmbed(ctx.guild, profile, target)] }, { ephemeral: true });
      }

      if (sub === "feed") {
        const posts = ctx.app.social.feed(guildId, { limit: 10 });
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
