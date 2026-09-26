const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const crypto = require("crypto");
const { Level } = require("../../../core/permissions/PermissionService");
const { AttachmentBuilder } = require("discord.js");
const { buildEmbed, parseDuration, formatDuration, truncate, timestamp } = require("../../../core/utils/helpers");
const { parseDateTime } = require("../../../core/utils/time");
const editor = require("../editor");
const interactions = require("../interactions");

const NAME_PATTERN = /^[\p{L}\p{N}_-]{2,32}$/u;

module.exports = [
  {
    name: "تقديم",
    aliases: ["application", "تقديمات"],
    description: "إنشاء أنواع التقديمات بأسئلة، ونشرها للمراجعة بأزرار قبول ورفض.",
    usage: "/application create name:العصابات label:تقديم العصابات review:#المراجعة role:@عصابة",
    arguments: [
      { name: "create", required: false, description: "إنشاء نوع تقديم" },
      { name: "form", required: false, description: "ضبط أسئلة التقديم (حتى 20 سؤال)" },
      { name: "edit", required: false, description: "فتح المحرّر التفاعلي (كل شي بالأزرار)" },
      { name: "set", required: false, description: "تعديل خاصية واحدة مباشرة" },
      { name: "list", required: false, description: "عرض الأنواع" },
      { name: "panel", required: false, description: "نشر لوحة تصفّح فئات ثم أنواع" },
      { name: "pending", required: false, description: "الطلبات المعلّقة" },
      { name: "show", required: false, description: "عرض طلب برقمه" },
      { name: "delete", required: false, description: "حذف نوع تقديم" },
      { name: "schedule", required: false, description: "نافذة الفتح/الإغلاق وحدود العدد (منشئ النماذج)" },
      { name: "stats / export", required: false, description: "إحصاءات النموذج وتصدير الإجابات CSV/JSON" }
    ],
    examples: [
      "/application create name:العصابات label:تقديم - العصابات review:#مراجعة role:@عصابة category:وزارة الداخلية",
      "/application edit name:العصابات",
      "/application form name:العصابات q1:الاسم q2:العمر q3:الخبرات q4:اسم العصابة q5:سبب التقديم",
      "/application panel channel:#تقديم-الوظائف",
      "/application pending"
    ],
    category: "applications",
    slashOnly: true,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("تقديم")
      .setDescription("نظام التقديمات")
      .addSubcommand((s) =>
        s.setName("create").setDescription("إنشاء نوع تقديم")
          .addStringOption((o) => o.setName("name").setDescription("اسم مختصر بدون مسافات").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("label").setDescription("الاسم الظاهر").setRequired(true).setMaxLength(80))
          .addChannelOption((o) => o.setName("review").setDescription("قناة مراجعة الطلبات").addChannelTypes(ChannelType.GuildText).setRequired(true))
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة عند القبول"))
          .addRoleOption((o) => o.setName("remove-role").setDescription("رتبة تُسحب عند القبول"))
          .addStringOption((o) => o.setName("description").setDescription("وصف قصير").setMaxLength(200))
          .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(32))
          .addStringOption((o) =>
            o.setName("mode").setDescription("طريقة جمع الإجابات")
              .addChoices({ name: "نافذة سريعة (حتى 5 أسئلة)", value: "modal" }, { name: "أسئلة في الخاص (تدعم الصور)", value: "dm" })
          )
          .addStringOption((o) => o.setName("cooldown").setDescription("مهلة إعادة التقديم بعد الرفض، مثل 7d"))
          .addStringOption((o) =>
            o.setName("category").setDescription("فئة رئيسية تُجمَّع تحتها الأنواع، مثل: وزارة الداخلية").setMaxLength(80)
          )
      )
      .addSubcommand((s) => {
        s.setName("form").setDescription("ضبط أسئلة التقديم")
          .addStringOption((o) => o.setName("name").setDescription("اسم النوع").setRequired(true));
        for (let i = 1; i <= 10; i++) {
          s.addStringOption((o) => o.setName(`q${i}`).setDescription(`السؤال ${i}`).setMaxLength(200));
        }
        return s
          .addStringOption((o) => o.setName("long").setDescription("أرقام الأسئلة الطويلة، مثل: 3,5").setMaxLength(20))
          .addStringOption((o) => o.setName("numeric").setDescription("أرقام الأسئلة الرقمية فقط، مثل: 2").setMaxLength(20))
          .addStringOption((o) => o.setName("image").setDescription("رقم السؤال الذي يطلب صورة، مثل: 6").setMaxLength(4))
          .addBooleanOption((o) => o.setName("clear").setDescription("حذف كل الأسئلة"));
      })
      .addSubcommand((s) =>
        s.setName("edit").setDescription("فتح محرّر التقديم التفاعلي")
          .addStringOption((o) => o.setName("name").setDescription("اسم النوع").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("set").setDescription("تعديل خاصية واحدة مباشرة")
          .addStringOption((o) => o.setName("name").setDescription("اسم النوع").setRequired(true))
          .addStringOption((o) =>
            o.setName("field").setDescription("الخاصية").setRequired(true)
              .addChoices(
                { name: "الاسم الظاهر", value: "label" },
                { name: "الوصف", value: "description" },
                { name: "قناة المراجعة", value: "review_channel_id" },
                { name: "رتبة القبول", value: "accept_role_id" },
                { name: "رتبة تُسحب", value: "remove_role_id" },
                { name: "رسالة القبول", value: "accept_message" },
                { name: "رسالة الرفض", value: "reject_message" },
                { name: "طريقة الجمع", value: "collect_mode" },
                { name: "مهلة إعادة التقديم", value: "cooldown_ms" },
                { name: "مفتوح للتقديم", value: "enabled" },
                { name: "الفئة الرئيسية", value: "category" }
              )
          )
          .addStringOption((o) => o.setName("value").setDescription("القيمة الجديدة").setRequired(true))
      )
      .addSubcommand((s) => s.setName("list").setDescription("عرض أنواع التقديم"))
      .addSubcommand((s) =>
        s.setName("panel").setDescription("نشر لوحة تصفّح التقديمات (فئات ثم أنواع) بالشكل الحديث")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true))
      )
      .addSubcommand((s) => s.setName("pending").setDescription("الطلبات المعلّقة"))
      .addSubcommand((s) =>
        s.setName("show").setDescription("عرض طلب")
          .addIntegerOption((o) => o.setName("number").setDescription("رقم الطلب").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("delete").setDescription("حذف نوع تقديم")
          .addStringOption((o) => o.setName("name").setDescription("اسم النوع").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("schedule").setDescription("فتح/إغلاق مجدول وحدود العدد")
          .addStringOption((o) => o.setName("name").setDescription("اسم النوع").setRequired(true))
          .addStringOption((o) => o.setName("opens").setDescription("يفتح في (2026-10-01 18:00 بتوقيت UTC)").setMaxLength(20))
          .addStringOption((o) => o.setName("closes").setDescription("يغلق في، أو مدة مثل 7d").setMaxLength(20))
          .addIntegerOption((o) => o.setName("max").setDescription("أقصى عدد طلبات إجمالي (0 = بلا)").setMinValue(0).setMaxValue(100000))
          .addIntegerOption((o) => o.setName("per-user").setDescription("أقصى طلبات لكل عضو (0 = بلا)").setMinValue(0).setMaxValue(100))
          .addBooleanOption((o) => o.setName("clear").setDescription("إزالة كل القيود"))
      )
      .addSubcommand((s) =>
        s.setName("stats").setDescription("إحصاءات نموذج")
          .addStringOption((o) => o.setName("name").setDescription("اسم النوع").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("export").setDescription("تصدير الإجابات")
          .addStringOption((o) => o.setName("name").setDescription("اسم النوع").setRequired(true))
          .addStringOption((o) => o.setName("format").setDescription("الصيغة").addChoices({ name: "CSV", value: "csv" }, { name: "JSON", value: "json" }))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const level = ctx.app.permissions.resolveLevel(ctx.member);
      const admin = level >= Level.ADMIN;

      if (sub === "list") {
        const types = ctx.app.applications.listTypes(guildId);
        if (!types.length) return ctx.fail("errors.actionFailed", { details: "ما فيه أنواع تقديم بعد." });
        const stats = ctx.app.applications.stats(guildId);
        return ctx.reply({
          embeds: [buildEmbed({
            title: "📋 أنواع التقديم",
            description: types.map((t) =>
              `${t.emoji || "•"} **${t.label}** — \`${t.name}\` ${t.enabled ? "🟢" : "⚪"}${t.category ? ` • 📁 ${t.category}` : ""}\n` +
              `  المراجعة: ${t.review_channel_id ? `<#${t.review_channel_id}>` : "غير محددة"} • ` +
              `أسئلة: \`${t.questions.length}\` • ${t.collect_mode === "dm" ? "خاص" : "نافذة"}\n` +
              `  في اللوحات اكتب: \`apply:${t.name}\``
            ).join("\n\n"),
            color: ctx.color("primary"),
            fields: [
              { name: "معلّقة", value: `\`${stats.pending}\``, inline: true },
              { name: "مقبولة", value: `\`${stats.accepted}\``, inline: true },
              { name: "مرفوضة", value: `\`${stats.rejected}\``, inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      if (sub === "panel") {
        if (ctx.app.permissions.resolveLevel(ctx.member) < Level.ADMIN) return ctx.fail("errors.noPermission");

        const channel = ctx.interaction.options.getChannel("channel");
        if (!channel?.isTextBased?.()) return ctx.fail("errors.actionFailed", { details: "اختر قناة نصية." });

        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }

        const payload = interactions.browsePanel(ctx.app, guildId);
        const message = await channel.send(payload).catch(() => null);
        if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر اللوحة." });

        return ctx.success(`تم نشر لوحة التقديمات في <#${channel.id}>.`);
      }

      if (sub === "pending") {
        const rows = ctx.app.applications.listPending(guildId, 15);
        if (!rows.length) return ctx.success("ما فيه طلبات معلّقة. 🎉");
        return ctx.reply({
          embeds: [buildEmbed({
            title: "⏳ الطلبات المعلّقة",
            description: rows.map((r) => {
              const t = ctx.app.applications.getType(r.type_id);
              return `\`#${r.number}\` <@${r.user_id}> — **${t?.label || "؟"}** • ${timestamp(r.created_at, "R")}`;
            }).join("\n"),
            color: ctx.color("warning")
          })]
        }, { ephemeral: true });
      }

      if (sub === "show") {
        const number = ctx.interaction.options.getInteger("number");
        const record = ctx.app.applications.getByNumber(guildId, number);
        if (!record) return ctx.fail("errors.actionFailed", { details: "ما لقيت طلبًا بهذا الرقم." });
        const type = ctx.app.applications.getType(record.type_id);
        const user = await ctx.app.client.users.fetch(record.user_id).catch(() => null);
        return ctx.reply({
          embeds: [ctx.app.applicationService.buildEmbed(ctx.guild, type || { label: "؟" }, record, user)]
        }, { ephemeral: true });
      }

      if (!admin) return ctx.fail("errors.noPermission");

      const name = ctx.interaction.options.getString("name").trim();

      if (sub === "create") {
        if (!NAME_PATTERN.test(name)) {
          return ctx.fail("errors.actionFailed", { details: "الاسم من 2 إلى 32 حرفًا بدون مسافات." });
        }
        if (ctx.app.applications.getTypeByName(guildId, name)) {
          return ctx.fail("errors.actionFailed", { details: `فيه نوع بنفس الاسم \`${name}\`.` });
        }
        if (ctx.app.applications.countTypes(guildId) >= 50) {
          return ctx.fail("errors.actionFailed", { details: "وصلت للحد الأقصى (50 نوع)." });
        }

        const cooldownRaw = ctx.interaction.options.getString("cooldown");
        const cooldownMs = cooldownRaw ? parseDuration(cooldownRaw) : 0;
        if (cooldownRaw && !cooldownMs) return ctx.fail("errors.invalidDuration");

        const type = ctx.app.applications.createType({
          id: crypto.randomBytes(6).toString("hex"),
          guildId,
          name,
          label: ctx.interaction.options.getString("label"),
          description: ctx.interaction.options.getString("description"),
          emoji: ctx.interaction.options.getString("emoji"),
          reviewChannelId: ctx.interaction.options.getChannel("review").id,
          acceptRoleId: ctx.interaction.options.getRole("role")?.id || null,
          removeRoleId: ctx.interaction.options.getRole("remove-role")?.id || null,
          collectMode: ctx.interaction.options.getString("mode") || "modal",
          category: ctx.interaction.options.getString("category")?.trim() || null,
          cooldownMs
        });

        return ctx.success(
          `تم إنشاء **${type.label}**\n` +
          `أضف الأسئلة: \`/application form name:${name} q1:... q2:...\`\n` +
          `واربطه بزر أو خيار قائمة بالإجراء: \`apply:${name}\``
        );
      }

      const type = ctx.app.applications.getTypeByName(guildId, name);
      if (!type) return ctx.fail("errors.actionFailed", { details: `ما لقيت نوعًا اسمه \`${name}\`.` });

      if (sub === "schedule") return formSchedule(ctx, type);
      if (sub === "stats") return formStats(ctx, type);
      if (sub === "export") return formExport(ctx, type);

      if (sub === "delete") {
        ctx.app.applications.deleteType(guildId, name);
        return ctx.success(`تم حذف نوع التقديم \`${name}\`.`);
      }

      if (sub === "edit") {
        // المحرّر التفاعلي: كل شيء بالأزرار بدل الأوامر الطويلة
        return ctx.reply(editor.view(ctx.app, type, ctx.guild), { ephemeral: true });
      }

      if (sub === "form") {
        if (ctx.interaction.options.getBoolean("clear")) {
          ctx.app.applications.setQuestions(type.id, []);
          return ctx.success(`تم حذف كل أسئلة **${type.label}**.`);
        }

        const parseSet = (key) => new Set(
          (ctx.interaction.options.getString(key) || "").split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n))
        );
        const longs = parseSet("long");
        const numerics = parseSet("numeric");
        const imageIndex = parseInt(ctx.interaction.options.getString("image") || "", 10);

        const questions = [];
        for (let i = 1; i <= 10; i++) {
          const label = ctx.interaction.options.getString(`q${i}`);
          if (!label) continue;
          questions.push({
            label: label.trim(),
            long: longs.has(i),
            numeric: numerics.has(i),
            image: imageIndex === i,
            required: true
          });
        }

        if (!questions.length) {
          return ctx.fail("errors.actionFailed", { details: "أدخل سؤالًا واحدًا على الأقل، أو `clear:true` للحذف." });
        }

        ctx.app.applications.setQuestions(type.id, questions);
        const needsDM = questions.length > 5 || questions.some((q) => q.image);
        return ctx.success(
          `تم ضبط \`${questions.length}\` سؤال لـ **${type.label}**:\n` +
          questions.map((q, i) => `\`${i + 1}.\` ${q.label}${q.image ? " 🖼️" : q.numeric ? " 🔢" : q.long ? " 📝" : ""}`).join("\n") +
          (needsDM ? "\n\nℹ️ الأسئلة أكثر من 5 أو فيها صورة، فراح تُجمع في الخاص تلقائيًا." : "")
        );
      }

      // set — تعديل خاصية واحدة
      const field = ctx.interaction.options.getString("field");
      const raw = ctx.interaction.options.getString("value").trim();
      let value = raw;

      if (["review_channel_id", "accept_role_id", "remove_role_id"].includes(field)) {
        const id = raw.match(/\d{15,25}/)?.[0];
        if (!id) return ctx.fail("errors.actionFailed", { details: "أدخل آيدي صالحًا أو منشن." });
        value = id;
      } else if (field === "cooldown_ms") {
        const ms = parseDuration(raw);
        if (!ms) return ctx.fail("errors.invalidDuration");
        value = ms;
      } else if (field === "enabled") {
        value = ["نعم", "yes", "true", "1"].includes(raw.toLowerCase()) ? 1 : 0;
      } else if (field === "collect_mode") {
        if (!["modal", "dm"].includes(raw)) return ctx.fail("errors.actionFailed", { details: "اكتب `modal` أو `dm`." });
      }

      ctx.app.applications.updateType(type.id, field, value);
      return ctx.success(`تم تعديل \`${field}\` في **${type.label}** إلى \`${truncate(raw, 100)}\``);
    }
  }
];

function formSchedule(ctx, type) {
  const o = ctx.interaction.options;
  if (o.getBoolean("clear")) {
    ctx.app.applications.setLimits(type.id, {});
    return ctx.success(`تمت إزالة قيود **${type.label}**.`);
  }
  const INVALID = Symbol("invalid");
  const parseWhen = (raw, base = Date.now()) => {
    // التاريخ الصريح أولًا، لأن محلل المدد متساهل مع الأرقام
    const at = parseDateTime(raw, "UTC");
    if (at) return at;
    const dur = parseDuration(raw);
    return dur ? base + dur : INVALID;
  };
  const opensAt = o.getString("opens") ? parseWhen(o.getString("opens")) : type.opens_at ?? null;
  const closesAt = o.getString("closes") ? parseWhen(o.getString("closes"), opensAt && opensAt !== INVALID ? opensAt : Date.now()) : type.closes_at ?? null;
  if (opensAt === INVALID || closesAt === INVALID) return ctx.fail("errors.invalidDuration");
  if (opensAt && closesAt && closesAt <= opensAt) return ctx.fail("errors.actionFailed", { details: "وقت الإغلاق يجب أن يكون بعد الفتح." });
  const updated = ctx.app.applications.setLimits(type.id, {
    opensAt, closesAt,
    maxSubmissions: o.getInteger("max") ?? type.max_submissions,
    perUserLimit: o.getInteger("per-user") ?? type.per_user_limit
  });
  return ctx.reply({
    embeds: [buildEmbed({
      title: `🗓️ ${updated.label}`,
      color: ctx.color("info"),
      fields: [
        { name: "يفتح", value: updated.opens_at ? timestamp(updated.opens_at, "F") : "الآن", inline: true },
        { name: "يغلق", value: updated.closes_at ? timestamp(updated.closes_at, "F") : "بلا", inline: true },
        { name: "الحد الإجمالي", value: updated.max_submissions ? `\`${updated.max_submissions}\`` : "بلا", inline: true },
        { name: "لكل عضو", value: updated.per_user_limit ? `\`${updated.per_user_limit}\`` : "بلا", inline: true }
      ]
    })]
  }, { ephemeral: true });
}

function formStats(ctx, type) {
  const st = ctx.app.applications.typeStats(type.id);
  return ctx.reply({
    embeds: [buildEmbed({
      title: `📊 ${type.label}`,
      color: ctx.color("info"),
      fields: [
        { name: "الإجمالي", value: `\`${st.total}\`${type.max_submissions ? ` / ${type.max_submissions}` : ""}`, inline: true },
        { name: "معلّق", value: `\`${st.pending}\``, inline: true },
        { name: "مقبول", value: `\`${st.accepted}\``, inline: true },
        { name: "مرفوض", value: `\`${st.rejected}\``, inline: true },
        { name: "أعضاء مختلفون", value: `\`${st.users}\``, inline: true },
        { name: "متوسط المراجعة", value: st.avgReviewMs ? formatDuration(st.avgReviewMs) : "—", inline: true },
        { name: "نسبة القبول", value: st.accepted + st.rejected ? `${Math.round((st.accepted / (st.accepted + st.rejected)) * 100)}%` : "—", inline: true },
        { name: "آخر طلب", value: st.lastAt ? timestamp(st.lastAt, "R") : "—", inline: true }
      ]
    })]
  }, { ephemeral: true });
}

/** يحمي من حقن الصيغ في برامج الجداول (CSV injection). */
function csvCell(value) {
  let v = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

function formExport(ctx, type) {
  const rows = ctx.app.applications.exportRows(type.id);
  if (!rows.length) return ctx.fail("errors.actionFailed", { details: "لا توجد طلبات للتصدير." });
  const format = ctx.interaction.options.getString("format") || "csv";
  const parse = (a) => {
    try {
      return JSON.parse(a || "{}");
    } catch {
      return {};
    }
  };
  let body;
  if (format === "json") {
    body = JSON.stringify({ form: type.name, exportedAt: new Date().toISOString(), rows: rows.map((r) => ({ ...r, answers: parse(r.answers) })) }, null, 2);
  } else {
    const questions = [...new Set([...type.questions.map((q) => q.label), ...rows.flatMap((r) => Object.keys(parse(r.answers)))])];
    const header = ["number", "user_id", "status", "reviewer_id", "created_at", "reviewed_at", ...questions];
    const lines = rows.map((r) => {
      const ans = parse(r.answers);
      return [r.number, r.user_id, r.status, r.reviewer_id, new Date(r.created_at).toISOString(), r.reviewed_at ? new Date(r.reviewed_at).toISOString() : "", ...questions.map((q) => ans[q])].map(csvCell).join(",");
    });
    body = "\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\n");
  }
  const file = new AttachmentBuilder(Buffer.from(body, "utf8"), { name: `${type.name}-${Date.now()}.${format}` });
  return ctx.reply({ content: `📦 \`${rows.length}\` طلب`, files: [file] }, { ephemeral: true });
}

module.exports.csvCell = csvCell;
