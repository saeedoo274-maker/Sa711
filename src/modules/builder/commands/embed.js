const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const crypto = require("crypto");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp, truncate } = require("../../../core/utils/helpers");
const builder = require("../interactions");

const NAME_PATTERN = /^[\p{L}\p{N}_-]{2,32}$/u;

module.exports = [
  {
    name: "ايمبد",
    aliases: ["embed", "امبد"],
    description: "إنشاء وتعديل وإرسال الإمبيدات المخصصة بمحرّر تفاعلي كامل.",
    usage: "/embed create name:<الاسم>  •  /embed edit name:<الاسم>",
    arguments: [
      { name: "create", required: false, description: "إنشاء إمبيد جديد وفتح المحرّر" },
      { name: "edit", required: false, description: "فتح محرّر إمبيد موجود" },
      { name: "list", required: false, description: "عرض كل الإمبيدات المحفوظة" },
      { name: "صورة", required: false, description: "رفع صورة مباشرة (بلا رابط خارجي) على إمبيد" },
      { name: "send", required: false, description: "إرسال إمبيد إلى قناة" },
      { name: "sync", required: false, description: "تحديث كل الرسائل المرسلة من إمبيد بعد تعديله" },
      { name: "rename", required: false, description: "تغيير اسم إمبيد" },
      { name: "clone", required: false, description: "نسخ إمبيد باسم جديد" }
    ],
    examples: [
      "/embed create name:الدعم_الفني",
      "/embed edit name:الدعم_الفني",
      "/embed send name:الدعم_الفني channel:#الدعم",
      "/embed صورة name:الدعم_الفني file:<مرفق> type:كبيرة"
    ],    category: "builder",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("ايمبد")
      .setDescription("إنشاء وتعديل الإمبيدات المخصصة")
      .addSubcommand((s) =>
        s.setName("create").setDescription("إنشاء إمبيد جديد")
          .addStringOption((o) => o.setName("name").setDescription("اسم مختصر بدون مسافات").setRequired(true).setMaxLength(32))
      )
      .addSubcommand((s) =>
        s.setName("edit").setDescription("فتح محرّر إمبيد")
          .addStringOption((o) => o.setName("name").setDescription("اسم الإمبيد").setRequired(true))
      )
      .addSubcommand((s) => s.setName("list").setDescription("عرض كل الإمبيدات"))
      .addSubcommand((s) =>
        s.setName("صورة").setDescription("رفع صورة مباشرة على إمبيد (بلا رابط خارجي)")
          .addStringOption((o) => o.setName("name").setDescription("اسم الإمبيد").setRequired(true))
          .addAttachmentOption((o) => o.setName("file").setDescription("ملف الصورة").setRequired(true))
          .addStringOption((o) =>
            o.setName("type").setDescription("موضع الصورة على الإمبيد")
              .addChoices({ name: "كبيرة (أسفل الوصف)", value: "image" }, { name: "مصغّرة (أعلى يمين)", value: "thumbnail" })
          )
      )
      .addSubcommand((s) =>
        s.setName("send").setDescription("إرسال إمبيد إلى قناة")
          .addStringOption((o) => o.setName("name").setDescription("اسم الإمبيد").setRequired(true))
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      )
      .addSubcommand((s) =>
        s.setName("sync").setDescription("تحديث الرسائل المرسلة بعد التعديل")
          .addStringOption((o) => o.setName("name").setDescription("اسم الإمبيد").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("rename").setDescription("تغيير اسم إمبيد")
          .addStringOption((o) => o.setName("name").setDescription("الاسم الحالي").setRequired(true))
          .addStringOption((o) => o.setName("newname").setDescription("الاسم الجديد").setRequired(true).setMaxLength(32))
      )
      .addSubcommand((s) =>
        s.setName("clone").setDescription("نسخ إمبيد باسم جديد")
          .addStringOption((o) => o.setName("name").setDescription("الإمبيد الأصلي").setRequired(true))
          .addStringOption((o) => o.setName("newname").setDescription("اسم النسخة").setRequired(true).setMaxLength(32))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;

      if (sub === "list") {
        const list = ctx.app.embeds.list(guildId);
        if (!list.length) {
          return ctx.fail("errors.actionFailed", { details: "ما فيه إمبيدات بعد. أنشئ واحدًا بـ `/embed create`." });
        }
        return ctx.reply({
          embeds: [
            buildEmbed({
              title: "🎨 الإمبيدات المحفوظة",
              description: list
                .map((e) => {
                  const sent = ctx.app.embeds.messages(e.id).length;
                  return `**${e.name}** — \`${(e.components || []).length}\` مكوّن • \`${sent}\` رسالة منشورة\nآخر تعديل ${timestamp(e.updated_at, "R")}`;
                })
                .join("\n\n"),
              color: ctx.color("primary"),
              footer: `الإجمالي: ${list.length}`
            })
          ]
        }, { ephemeral: true });
      }

      if (sub === "صورة") {
        const name = ctx.interaction.options.getString("name");
        const record = ctx.app.embeds.getByName(guildId, name);
        if (!record) return ctx.fail("errors.actionFailed", { details: `ما لقيت إمبيدًا باسم \`${name}\`.` });

        const file = ctx.interaction.options.getAttachment("file");
        if (!file.contentType?.startsWith("image/")) {
          return ctx.fail("errors.actionFailed", { details: "الملف المرفق لازم يكون صورة (PNG أو JPG أو GIF أو WebP)." });
        }

        const target = ctx.interaction.options.getString("type") || "image";
        const data = { ...record.data };
        if (target === "thumbnail") data.thumbnail = file.url;
        else data.image = file.url;

        ctx.app.embeds.save(record.id, { content: record.content, data, components: record.components });

        return ctx.success(
          `تم رفع الصورة وربطها بـ **${target === "thumbnail" ? "الصورة المصغّرة" : "الصورة الكبيرة"}** في إمبيد **${record.name}**.\n` +
          `استخدم \`/embed sync name:${record.name}\` لتحديث الرسائل المنشورة سابقًا بهذا الإمبيد.`
        );
      }

      const name = ctx.interaction.options.getString("name").trim();

      if (sub === "create") {
        if (!NAME_PATTERN.test(name)) {
          return ctx.fail("errors.actionFailed", { details: "الاسم لازم يكون من 2 إلى 32 حرفًا، بدون مسافات (استخدم `_`)." });
        }
        if (ctx.app.embeds.getByName(guildId, name)) {
          return ctx.fail("errors.actionFailed", { details: `فيه إمبيد بنفس الاسم \`${name}\` من قبل.` });
        }
        if (ctx.app.embeds.count(guildId) >= 100) {
          return ctx.fail("errors.actionFailed", { details: "وصلت للحد الأقصى (100 إمبيد لكل سيرفر)." });
        }

        const record = ctx.app.embeds.create({
          id: crypto.randomBytes(6).toString("hex"),
          guildId,
          name,
          createdBy: ctx.user.id
        });
        return ctx.reply(builder.editorView(ctx.app, record), { ephemeral: true });
      }

      const record = ctx.app.embeds.getByName(guildId, name);
      if (!record) return ctx.fail("errors.actionFailed", { details: `ما لقيت إمبيد اسمه \`${name}\`.` });

      if (sub === "edit") {
        return ctx.reply(builder.editorView(ctx.app, record), { ephemeral: true });
      }

      if (sub === "send") {
        const channel = ctx.interaction.options.getChannel("channel") || ctx.channel;
        if (!channel.isTextBased()) return ctx.fail("errors.channelNotFound");

        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }

        const payload = ctx.app.embedService.payload(record, { guild: ctx.guild, allowMentions: true });

        // نلتقط سبب الفشل الحقيقي بدل ابتلاعه: "فشل الإرسال" وحدها لا تعني شيئًا
        // للمستخدم، وأغلب الأسباب قابلة للإصلاح بنفسه (إمبيد فارغ، صورة برابط خاطئ...)
        let message = null;
        let sendError = null;
        try {
          message = await channel.send(payload);
        } catch (error) {
          sendError = error;
        }

        if (!message) {
          const reason = describeSendError(sendError, record);
          ctx.app.errors.capture(sendError || new Error("إرسال إمبيد فشل بلا استثناء"), {
            system: "builder/send",
            guildId,
            command: `embed:${record.name}`
          });
          return ctx.fail("errors.actionFailed", { details: reason });
        }

        ctx.app.embeds.trackMessage({
          embedId: record.id,
          guildId,
          channelId: channel.id,
          messageId: message.id
        });
        return ctx.reply({ content: `${ctx.emoji("success")} تم الإرسال إلى <#${channel.id}>` }, { ephemeral: true });
      }

      if (sub === "sync") {
        await ctx.defer({ ephemeral: true });
        const result = await ctx.app.embedService.syncMessages(record);
        return ctx.reply({
          content: `${ctx.emoji("success")} حُدّثت \`${result.updated}\` رسالة` +
            (result.removed ? ` • أُزيلت \`${result.removed}\` رسالة محذوفة من التتبّع` : "")
        }, { ephemeral: true });
      }

      const newName = ctx.interaction.options.getString("newname").trim();
      if (!NAME_PATTERN.test(newName)) {
        return ctx.fail("errors.actionFailed", { details: "الاسم الجديد لازم يكون من 2 إلى 32 حرفًا بدون مسافات." });
      }
      if (ctx.app.embeds.getByName(guildId, newName)) {
        return ctx.fail("errors.actionFailed", { details: `الاسم \`${newName}\` مستخدم من قبل.` });
      }

      if (sub === "rename") {
        ctx.app.embeds.rename(record.id, newName);
        return ctx.success(`تم تغيير الاسم من \`${name}\` إلى \`${newName}\``);
      }

      // clone
      const copy = ctx.app.embeds.create({
        id: crypto.randomBytes(6).toString("hex"),
        guildId,
        name: newName,
        createdBy: ctx.user.id
      });
      const saved = ctx.app.embeds.save(copy.id, {
        content: record.content,
        data: record.data,
        components: record.components
      });
      return ctx.reply(builder.editorView(ctx.app, saved), { ephemeral: true });
    }
  }
];

/**
 * يترجم خطأ ديسكورد إلى سبب مفهوم قابل للإصلاح.
 * أغلب حالات فشل إرسال الإمبيد سببها محتوى ناقص أو رابط صورة خاطئ،
 * وكلاهما يصلحه المستخدم بنفسه متى عرف السبب.
 */
function describeSendError(error, record) {
  if (!error) return "فشل الإرسال لسبب غير معروف.";

  const code = error.code;
  const msg = String(error.message || "");
  const isEmpty =
    !record.content &&
    !record.data?.title &&
    !record.data?.description &&
    !(record.data?.fields || []).length &&
    !record.data?.image;

  // 50035 = بيانات غير صالحة، وأشهر سببها إمبيد بلا أي محتوى
  if (code === 50035 || /invalid form body/i.test(msg)) {
    if (isEmpty) {
      return `الإمبيد فارغ — ديسكورد يرفض إرسال رسالة بلا محتوى.\nأضف عنوانًا أو وصفًا من \`/embed edit name:${record.name}\` ثم أعد الإرسال.`;
    }
    if (record.data?.image || record.data?.thumbnail) {
      return `ديسكورد رفض المحتوى. تحقق من روابط الصور — لازم تبدأ بـ \`https://\` وتكون صورة مباشرة.\nالتفاصيل: ${truncate(msg, 200)}`;
    }
    return `ديسكورد رفض المحتوى: ${truncate(msg, 300)}`;
  }

  if (code === 50013) return "البوت يفتقد صلاحية في هذه القناة (الإرسال أو تضمين الروابط أو إرفاق الملفات).";
  if (code === 50001) return "البوت لا يملك وصولًا لهذه القناة.";
  if (code === 10003) return "القناة لم تعد موجودة.";
  if (code === 30046) return "بلغت الحد الأقصى للرسائل المثبّتة أو المكوّنات في هذه القناة.";

  return `فشل الإرسال: ${truncate(msg, 300)}`;
}
