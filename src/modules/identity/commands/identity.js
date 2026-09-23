const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp } = require("../../../core/utils/helpers");

const SYSTEM = "identity.enabled";

module.exports = [
  {
    name: "هوية",
    aliases: ["identity", "id"],
    description: "الهوية الوطنية: إصدار بطاقات بأرقام متسلسلة، مراجعة، وبحث في السجل المدني.",
    usage: "/هوية لوحة channel:#الأحوال-المدنية",
    arguments: [
      { name: "لوحة", required: false, description: "نشر لوحة إنشاء الهوية" },
      { name: "بطاقتي", required: false, description: "عرض بطاقتك" },
      { name: "بحث", required: false, description: "بحث في السجل المدني بالاسم أو الرقم" },
      { name: "معلقة", required: false, description: "الطلبات بانتظار المراجعة" },
      { name: "حذف", required: false, description: "حذف هوية عضو ليعيد التقديم" },
      { name: "اعدادات", required: false, description: "ضبط القنوات والرتب ومدة الصلاحية" },
      { name: "قالب", required: false, description: "ضبط صورة قالب البطاقة ومواضع النص" }
    ],
    examples: [
      "/هوية لوحة channel:#الأحوال-المدنية",
      "/هوية اعدادات review:#مراجعة-الهويات citizen-role:@مواطن",
      "/هوية قالب url:https://example.com/card.png"
    ],
    category: "identity",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("هوية")
      .setDescription("الهوية الوطنية")
      .addSubcommand((s) => s.setName("بطاقتي").setDescription("عرض بطاقتك"))
      .addSubcommand((s) =>
        s.setName("بحث").setDescription("بحث في السجل المدني")
          .addStringOption((o) => o.setName("term").setDescription("الاسم أو رقم الهوية").setRequired(true))
      )
      .addSubcommand((s) => s.setName("معلقة").setDescription("الطلبات بانتظار المراجعة"))
      .addSubcommand((s) =>
        s.setName("حذف").setDescription("حذف هوية عضو")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("لوحة").setDescription("نشر لوحة إنشاء الهوية")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) =>
        s.setName("اعدادات").setDescription("ضبط النظام")
          .addChannelOption((o) => o.setName("review").setDescription("قناة مراجعة الطلبات").addChannelTypes(ChannelType.GuildText))
          .addRoleOption((o) => o.setName("citizen-role").setDescription("رتبة تُمنح عند القبول"))
          .addIntegerOption((o) => o.setName("validity-days").setDescription("مدة صلاحية البطاقة بالأيام (0 = دائمة)").setMinValue(0).setMaxValue(3650))
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل النظام"))
      )
      .addSubcommand((s) =>
        s.setName("قالب").setDescription("ضبط صورة قالب البطاقة")
          .addStringOption((o) => o.setName("url").setDescription("رابط صورة القالب (https) — اتركه فارغًا للإلغاء"))
          .addStringOption((o) => o.setName("layout").setDescription("مواضع النص بصيغة JSON (للمتقدمين)").setMaxLength(1800))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const svc = ctx.app.identityService;
      const level = ctx.app.permissions.resolveLevel(ctx.member);

      if (sub === "بطاقتي") {
        const identity = ctx.app.identities.get(guildId, ctx.user.id);
        if (!identity) return ctx.fail("errors.actionFailed", { details: "ما عندك هوية بعد." });
        if (identity.status !== "approved") {
          return ctx.fail("errors.actionFailed", {
            details: identity.status === "pending" ? "هويتك قيد المراجعة." : "طلب هويتك مرفوض."
          });
        }
        await ctx.defer({ ephemeral: true });
        const card = await svc.renderCard(ctx.guild, identity, ctx.user);
        if (card.files) return ctx.reply({ files: card.files }, { ephemeral: true });
        return ctx.reply(card.payload, { ephemeral: true });
      }

      if (sub === "بحث") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");
        const rows = ctx.app.identities.search(guildId, ctx.interaction.options.getString("term").trim());
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه نتائج مطابقة." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🔎 نتائج السجل المدني",
            description: rows
              .map((r) => `\`${String(r.card_number).padStart(6, "0")}\` **${r.full_name}** — <@${r.user_id}>`)
              .join("\n"),
            color: ctx.color("primary")
          })]
        }, { ephemeral: true });
      }

      if (sub === "معلقة") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");
        const rows = ctx.app.identities.listPending(guildId);
        const stats = ctx.app.identities.stats(guildId);
        if (!rows.length) return ctx.success("ما فيه طلبات معلّقة. 🎉");
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🪪 طلبات الهوية المعلّقة",
            description: rows
              .map((r) => `\`#${String(r.card_number).padStart(6, "0")}\` ${r.full_name} — <@${r.user_id}> • ${timestamp(r.created_at, "R")}`)
              .join("\n"),
            color: ctx.color("warning"),
            fields: [
              { name: "معلّقة", value: `\`${stats.pending}\``, inline: true },
              { name: "معتمدة", value: `\`${stats.approved}\``, inline: true },
              { name: "مرفوضة", value: `\`${stats.rejected}\``, inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      if (level < Level.ADMIN) return ctx.fail("errors.noPermission");

      if (sub === "حذف") {
        const user = ctx.interaction.options.getUser("user");
        if (!ctx.app.identities.remove(guildId, user.id)) {
          return ctx.fail("errors.actionFailed", { details: "ما عنده هوية مسجّلة." });
        }
        return ctx.success(`تم حذف هوية <@${user.id}>. يقدر يقدّم من جديد.`);
      }

      if (sub === "لوحة") {
        const channel = ctx.interaction.options.getChannel("channel");
        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }
        const message = await channel.send(svc.panelPayload(ctx.guild)).catch(() => null);
        if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر اللوحة." });
        return ctx.success(`تم نشر لوحة الهوية في <#${channel.id}>.`);
      }

      if (sub === "قالب") {
        const url = ctx.interaction.options.getString("url");
        const layoutRaw = ctx.interaction.options.getString("layout");
        const updates = {};

        if (url !== null) {
          const trimmed = url.trim();
          if (trimmed && !/^https:\/\/\S+$/i.test(trimmed)) {
            return ctx.fail("errors.actionFailed", { details: "الرابط لازم يبدأ بـ `https://`" });
          }
          updates["identity.templateUrl"] = trimmed || null;
        }

        if (layoutRaw) {
          try {
            const parsed = JSON.parse(layoutRaw);
            if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ليس كائنًا");
            updates["identity.layout"] = parsed;
          } catch (err) {
            return ctx.fail("errors.actionFailed", { details: `صيغة JSON غير صالحة: ${err.message}` });
          }
        }

        if (!Object.keys(updates).length) {
          // بلا خيارات: نعرض الحالة الحالية ودليل التخصيص
          const cfg = svc.config(guildId);
          const { DEFAULT_LAYOUT } = require("../IdentityService");
          return ctx.reply({
            embeds: [buildEmbed({
              title: "🎨 قالب بطاقة الهوية",
              color: ctx.color("primary"),
              fields: [
                { name: "صورة القالب", value: cfg.templateUrl || "غير محددة (تُعرض البطاقة منسّقة)" },
                { name: "مكتبة الرسم", value: svc.canvasLib() ? "✅ مثبّتة" : "⚪ غير مثبّتة — `npm i canvas canvas-constructor`" },
                { name: "الوضع الحالي", value: svc.canRenderImage(guildId) ? "🖼️ صورة مرسومة" : "📋 بطاقة منسّقة" },
                {
                  name: "الحقول المتاحة للتخصيص",
                  value: "`" + Object.keys(DEFAULT_LAYOUT.fields).join("` • `") + "`"
                },
                {
                  name: "مثال لتعديل موضع",
                  value: '```json\n{"fields":{"full_name":{"x":1490,"y":303,"size":60}}}\n```'
                }
              ]
            })]
          }, { ephemeral: true });
        }

        ctx.app.guildConfig.setMany(guildId, updates);
        const ready = svc.canRenderImage(guildId);
        return ctx.success(
          "تم حفظ إعدادات القالب.\n" +
          (ready
            ? "🖼️ البطاقة راح تُرسم كصورة الآن."
            : svc.canvasLib()
              ? "⚠️ حدّد صورة القالب لتُرسم البطاقة كصورة."
              : "⚠️ مكتبة الرسم غير مثبّتة، فالبطاقة تبقى منسّقة. ثبّتها بـ `npm i canvas canvas-constructor`.")
        );
      }

      // اعدادات
      const updates = {};
      const review = ctx.interaction.options.getChannel("review");
      const citizenRole = ctx.interaction.options.getRole("citizen-role");
      const validity = ctx.interaction.options.getInteger("validity-days");
      const enabled = ctx.interaction.options.getBoolean("enabled");
      const me = ctx.guild.members.me;

      if (review) {
        if (!review.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${review.id}>.` });
        }
        updates["identity.reviewChannelId"] = review.id;
      }
      if (citizenRole) {
        if (citizenRole.managed || citizenRole.position >= me.roles.highest.position) {
          return ctx.fail("errors.actionFailed", { details: `لا أستطيع إدارة <@&${citizenRole.id}> — ارفع رتبة البوت فوقها.` });
        }
        updates["identity.citizenRoleId"] = citizenRole.id;
      }
      if (validity !== null) updates["identity.validityDays"] = validity;
      if (enabled !== null) updates["identity.enabled"] = enabled;

      if (!Object.keys(updates).length) {
        return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
      }

      ctx.app.guildConfig.setMany(guildId, updates);
      const cfg = svc.config(guildId);
      return ctx.reply({
        embeds: [buildEmbed({
          title: "⚙️ إعدادات الهوية الوطنية",
          color: ctx.color("success"),
          fields: [
            { name: "النظام", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
            { name: "قناة المراجعة", value: cfg.reviewChannelId ? `<#${cfg.reviewChannelId}>` : "غير محددة", inline: true },
            { name: "رتبة المواطن", value: cfg.citizenRoleId ? `<@&${cfg.citizenRoleId}>` : "غير محددة", inline: true },
            { name: "مدة الصلاحية", value: cfg.validityDays ? `\`${cfg.validityDays}\` يوم` : "دائمة", inline: true }
          ]
        })]
      }, { ephemeral: true });
    }
  }
];
