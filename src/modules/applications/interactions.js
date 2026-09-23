const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { formatDuration, truncate } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");
const editor = require("./editor");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * تفاعلات التقديمات.
 * البادئة `app:` — تشمل بدء التقديم من لوحة، وقرارات المراجعة.
 */
module.exports = {
  prefix: "app",

  /** يُستدعى من محرّك الإمبيدات حين يكون إجراء الزر تقديمًا. */
  startApplication(interaction, app, typeId) {
    return start(interaction, app, typeId);
  },

  /** يبني حاوية تصفّح التقديمات: فئات ثم أنواع، بالشكل الحديث (الأزرار/القوائم داخل الحاوية). */
  browsePanel,

  async handle(interaction, app) {
    const parts = interaction.customId.split(":");
    const action = parts[1];

    if (action === "start") return start(interaction, app, parts[2]);
    if (action === "submit") return submitModal(interaction, app, parts[2]);
    if (action === "category") return categoryPicked(interaction, app);
    if (action === "typepick") return typePicked(interaction, app);

    // المحرّر التفاعلي: app:ed:<إجراء>:<معرّف النوع>:...
    if (action === "ed") return editor.handle(interaction, app, parts[2], parts.slice(3));

    // قرارات المراجعة
    return decide(interaction, app, action, parseInt(parts[2], 10));
  }
};

function deny(interaction, app, key = "errors.noPermission") {
  return safeReply(interaction, { content: app.i18n.t(key, { emoji: app.config.emoji("error") }), flags: 64 });
}

// ---------------- تصفّح التقديمات (فئة ← نوع) ----------------

/**
 * لوحة الدخول: قائمة الفئات الرئيسية (وزارة الداخلية، العصابات...) بالشكل الحديث.
 * الأنواع بلا فئة تُعرض كخيارات مباشرة في نفس القائمة، فلا تختفي إن لم يستخدم أحد الفئات.
 */
function browsePanel(app, guildId) {
  const categories = app.applications.listCategories(guildId);
  const uncategorized = app.applications.listByCategory(guildId, null).filter((t) => t.enabled);

  const options = [
    ...categories.map((c) => ({ label: truncate(c, 100), value: `cat:${c}`, emoji: "📁" })),
    ...uncategorized.map((t) => ({ label: truncate(t.label, 100), description: t.description ? truncate(t.description, 100) : undefined, value: `type:${t.id}`, emoji: t.emoji || "📋" }))
  ].slice(0, 25);

  if (!options.length) {
    return containerPayload({
      text: "## 📋 لوحة تقديمات دولة\n\nما فيه تقديمات متاحة حاليًا.",
      color: 0x808080
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("app:category")
    .setPlaceholder("يُرجى اختيار الوظيفة المراد التقديم لها")
    .addOptions(options);

  return containerPayload({
    text:
      "## ✅ لوحة تقديمات دولة\n\n" +
      "— يُرجى اختيار الوظيفة المراد التقديم لها.\n" +
      "— مكتب التوظيف الرسمي.",
    color: 0xC9A227,
    rows: [new ActionRowBuilder().addComponents(menu)]
  });
}

async function categoryPicked(interaction, app) {
  const value = interaction.values[0];
  const guildId = interaction.guild.id;

  if (value.startsWith("type:")) return typePicked(interaction, app, value.slice(5));

  const category = value.slice(4);
  const types = app.applications.listByCategory(guildId, category).filter((t) => t.enabled);

  if (!types.length) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} ما فيه تقديمات متاحة في هذه الفئة حاليًا.`, flags: 64 });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("app:typepick")
    .setPlaceholder("اختر الوظيفة الجانبية اللي تبي تقدّم عليها")
    .addOptions(
      types.slice(0, 25).map((t) => ({
        label: truncate(t.label, 100),
        description: t.description ? truncate(t.description, 100) : undefined,
        value: t.id,
        emoji: t.emoji || "📋"
      }))
    );

  return safeReply(interaction, {
    ...containerPayload({
      text: `## ${truncate(category, 200)}\n\nاختر الوظيفة اللي تبي تقدّم عليها.`,
      color: 0xC9A227,
      rows: [new ActionRowBuilder().addComponents(menu)]
    }),
    flags: 64
  });
}

async function typePicked(interaction, app, explicitId) {
  const typeId = explicitId || interaction.values[0];
  return start(interaction, app, typeId);
}

// ---------------- بدء التقديم ----------------

async function start(interaction, app, typeId) {
  const type = app.applications.getType(typeId);
  if (!type || type.guild_id !== interaction.guild.id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} نوع التقديم لم يعد موجودًا.`, flags: 64 });
  }

  const check = app.applicationService.eligibility(interaction.guild.id, type, interaction.user.id);
  if (!check.ok) {
    const messages = {
      disabled: `${app.config.emoji("error")} التقديم على **${type.label}** مغلق حاليًا.`,
      pending: `${app.config.emoji("warning")} عندك طلب قيد المراجعة على **${type.label}** برقم \`#${check.record?.number}\`.`,
      cooldown: `${app.config.emoji("warning")} تقدر تقدّم مرة ثانية بعد **${formatDuration(check.remaining)}**.`
    };
    return safeReply(interaction, { content: messages[check.reason] || messages.disabled, flags: 64 });
  }

  if (!type.questions.length) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} ما فيه أسئلة معرّفة لهذا التقديم بعد.`, flags: 64 });
  }

  // المودال أسرع، لكنه محدود بـ5 حقول نصية ولا يقبل صورًا
  const needsDM = type.collect_mode === "dm" || type.questions.length > 5 || type.questions.some((q) => q.image);

  if (!needsDM) {
    const modal = new ModalBuilder().setCustomId(`app:submit:${type.id}`).setTitle(truncate(type.label, 45));
    type.questions.slice(0, 5).forEach((q, i) => {
      const input = new TextInputBuilder()
        .setCustomId(`q${i}`)
        .setLabel(truncate(q.label, 45))
        .setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(q.required !== false)
        .setMaxLength(q.long ? 1000 : 200);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
    });
    return safeModal(interaction, modal);
  }

  await interaction.deferReply({ flags: 64 });

  const result = await app.dmFlow.start({
    user: interaction.user,
    guild: interaction.guild,
    title: `📋 التقديم على ${type.label}`,
    intro: type.description || "",
    questions: type.questions,
    onComplete: async ({ user, answers, imageUrl, message }) => {
      const record = await app.applicationService.submit({
        guild: interaction.guild,
        user,
        type,
        answers,
        imageUrl
      });
      await message.reply({
        content: `${app.config.emoji("success")} تم إرسال طلبك للمراجعة برقم \`#${record.number}\`. راح نبلغك بالنتيجة هنا.`
      }).catch(() => {});
    }
  });

  if (!result.ok) {
    const messages = {
      busy: `${app.config.emoji("warning")} عندك نموذج مفتوح في الخاص. أكمله أو اكتب \`إلغاء\` أولًا.`,
      dmClosed: `${app.config.emoji("error")} خاصك مقفل. افتح الرسائل الخاصة من إعدادات السيرفر ثم أعد المحاولة.`,
      noQuestions: `${app.config.emoji("error")} ما فيه أسئلة معرّفة لهذا التقديم.`
    };
    return safeUpdate(interaction, { content: messages[result.reason] || messages.dmClosed });
  }

  return safeUpdate(interaction, {
    content: `${app.config.emoji("success")} أرسلت لك أسئلة التقديم في الخاص، يرجى الإجابة عليها هناك.`
  });
}

async function submitModal(interaction, app, typeId) {
  const type = app.applications.getType(typeId);
  if (!type || type.guild_id !== interaction.guild.id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} نوع التقديم لم يعد موجودًا.`, flags: 64 });
  }

  // إعادة الفحص عند الإرسال: قد يكون العضو قدّم من نافذة أخرى بين الفتح والإرسال
  const check = app.applicationService.eligibility(interaction.guild.id, type, interaction.user.id);
  if (!check.ok) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} عندك طلب قيد المراجعة على هذا التقديم.`, flags: 64 });
  }

  const answers = {};
  type.questions.slice(0, 5).forEach((q, i) => {
    const value = interaction.fields.getTextInputValue(`q${i}`);
    if (value) answers[q.label] = value;
  });

  await interaction.deferReply({ flags: 64 });
  const record = await app.applicationService.submit({
    guild: interaction.guild,
    user: interaction.user,
    type,
    answers,
    imageUrl: null
  });

  return safeUpdate(interaction, {
    content: `${app.config.emoji("success")} تم إرسال طلبك برقم \`#${record.number}\`. راح نبلغك بالنتيجة في الخاص.`
  });
}

// ---------------- المراجعة ----------------

async function decide(interaction, app, action, id) {
  if (app.permissions.resolveLevel(interaction.member) < Level.STAFF) return deny(interaction, app);

  const target = findById(app, interaction.guild.id, id);
  if (!target) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذا الطلب لم يعد موجودًا.`, flags: 64 });
  }

  const type = app.applications.getType(target.type_id);
  if (!type) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} نوع التقديم محذوف.`, flags: 64 });
  }

  if (action === "note") {
    const modal = new ModalBuilder().setCustomId(`app:notesubmit:${target.id}`).setTitle("رفض مع ذكر السبب");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("note").setLabel("سبب الرفض").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
      )
    );
    return safeModal(interaction, modal);
  }

  if (action === "notesubmit") {
    return finalize(interaction, app, target, type, "rejected", interaction.fields.getTextInputValue("note"));
  }

  if (action === "reopen") {
    if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) return deny(interaction, app);
    const reopened = app.applications.decide(target.id, "pending", null, null);
    // decide يشترط الحالة pending، لذا نعيد الفتح باستعلام مباشر
    if (!reopened) {
      app.applications.db
        .prepare("UPDATE applications SET status = 'pending', reviewer_id = NULL, reviewed_at = NULL, note = NULL WHERE id = ?")
        .run(target.id);
    }
    const fresh = findById(app, interaction.guild.id, target.id);
    await app.applicationService._updateMessage(interaction.guild, type, fresh);
    return safeReply(interaction, { content: `${app.config.emoji("success")} تم إعادة فتح الطلب \`#${fresh.number}\`.`, flags: 64 });
  }

  return finalize(interaction, app, target, type, action === "accept" ? "accepted" : "rejected", null);
}

function findById(app, guildId, id) {
  const row = app.applications.db.prepare("SELECT * FROM applications WHERE id = ? AND guild_id = ?").get(id, guildId);
  return row ? { ...row, answers: JSON.parse(row.answers || "{}") } : null;
}

async function finalize(interaction, app, record, type, status, note) {
  await interaction.deferReply({ flags: 64 });

  const result = await app.applicationService.decide({
    guild: interaction.guild,
    reviewer: interaction.member,
    record,
    type,
    status,
    note
  });

  if (!result.ok) {
    return safeUpdate(interaction, { content: `${app.config.emoji("warning")} هذا الطلب تم البت فيه بالفعل من إداري آخر.` });
  }

  return safeUpdate(interaction, {
    content:
      `${app.config.emoji("success")} ${status === "accepted" ? "تم قبول" : "تم رفض"} الطلب \`#${result.record.number}\`` +
      (result.roleNote ? `\n${app.config.emoji("warning")} ${result.roleNote}` : "")
  });
}
