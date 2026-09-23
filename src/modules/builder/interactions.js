const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits
} = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { buildEmbed, truncate } = require("../../core/utils/helpers");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");
const variables = require("../../core/utils/variables");

/**
 * واجهتان في ملف واحد:
 *  1) محرّر الإمبيدات (البادئة `eb:`) — للإدارة فقط.
 *  2) تشغيل مكوّنات الإمبيدات المنشورة (البادئة `ce:`) — لكل الأعضاء.
 */

// ============================================================
//  المحرّر
// ============================================================

function editorView(app, record) {
  const preview = app.embedService.build(record);
  const componentCount = (record.components || []).length;

  const info = buildEmbed({
    title: `🎨 محرّر الإمبيد — \`${record.name}\``,
    description:
      "المعاينة بالأسفل. اضغط أي زر لتعديل الجزء المقابل.\n" +
      "**المتغيرات:** `{user}` `{username}` `{server}` `{membercount}`\n" +
      (record.use_v2
        ? "**الشكل:** 🆕 حديث — الأزرار تظهر **داخل** الحاوية الملوّنة. اضغط **معاينة حية** لرؤية الشكل النهائي."
        : "**الشكل:** 📋 تقليدي — الأزرار تظهر منفصلة تحت الإمبيد.") +
      `\n💡 لرفع صورة من جهازك مباشرة (بلا رابط): \`/embed صورة name:${record.name}\``,
    color: app.config.color("neutral"),
    fields: [
      { name: "المعرّف", value: `\`${record.id}\``, inline: true },
      { name: "المكوّنات", value: `\`${componentCount}\``, inline: true },
      { name: "الحقول", value: `\`${(record.data.fields || []).length}\``, inline: true }
    ],
    timestamp: false
  });

  const rows = [
    new ActionRowBuilder().addComponents(
      btn(`eb:text:${record.id}`, "النصوص", "📝", ButtonStyle.Primary),
      btn(`eb:media:${record.id}`, "الصور", "🖼️"),
      btn(`eb:color:${record.id}`, "اللون", "🎨"),
      btn(`eb:fields:${record.id}`, "الحقول", "📋")
    ),
    new ActionRowBuilder().addComponents(
      btn(`eb:addbtn:${record.id}`, "إضافة زر", "🔘", ButtonStyle.Success),
      btn(`eb:addsel:${record.id}`, "إضافة قائمة", "📑", ButtonStyle.Success),
      btn(`eb:editcomp:${record.id}`, "تعديل مكوّن", "✏️", ButtonStyle.Primary),
      btn(`eb:actions:${record.id}`, "الإجراءات المتاحة", "📖"),
      btn(`eb:clearcomp:${record.id}`, "حذف المكوّنات", "🧹", ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      btn(
        `eb:togglev2:${record.id}`,
        record.use_v2 ? "الشكل: حديث 🆕" : "الشكل: تقليدي 📋",
        "✨",
        record.use_v2 ? ButtonStyle.Success : ButtonStyle.Secondary
      ),
      btn(`eb:preview:${record.id}`, "معاينة حية", "👁️"),
      btn(`eb:vars:${record.id}`, "المتغيرات", "🔣"),
      btn(`eb:tplsave:${record.id}`, "حفظ كقالب", "💾", ButtonStyle.Success),
      btn(`eb:tpls:${record.id}`, "القوالب", "📂")
    ),
    new ActionRowBuilder().addComponents(
      btn(`eb:sendpick:${record.id}`, "إرسال لقناة", "📤", ButtonStyle.Primary),
      btn(`eb:sync:${record.id}`, "تحديث المرسل", "🔄"),
      btn(`eb:delete:${record.id}`, "حذف الإمبيد", "🗑️", ButtonStyle.Danger)
    )
  ];

  return { embeds: [info, preview], components: rows };
}

function btn(id, label, emoji, style = ButtonStyle.Secondary) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function input(id, label, style, { required = false, value, max, placeholder } = {}) {
  const t = new TextInputBuilder().setCustomId(id).setLabel(truncate(label, 45)).setStyle(style).setRequired(required);
  if (value) t.setValue(truncate(String(value), max || 4000));
  if (max) t.setMaxLength(max);
  if (placeholder) t.setPlaceholder(truncate(placeholder, 100));
  return new ActionRowBuilder().addComponents(t);
}

module.exports = {
  prefix: "eb",
  editorView,

  async handle(interaction, app) {
    const [, action, embedId, extra] = interaction.customId.split(":");

    // كل عمليات المحرّر للإدارة فقط، ويُعاد الفحص هنا لا في الواجهة
    if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
      return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
    }

    const record = app.embeds.get(embedId);
    if (!record || record.guild_id !== interaction.guild.id) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذا الإمبيد لم يعد موجودًا.`, flags: 64 });
    }

    switch (action) {
      case "open": return safeUpdate(interaction, editorView(app, record));
      case "text": return textModal(interaction, app, record);
      case "textsave": return textSave(interaction, app, record);
      case "media": return mediaModal(interaction, app, record);
      case "mediasave": return mediaSave(interaction, app, record);
      case "color": return colorModal(interaction, app, record);
      case "colorsave": return colorSave(interaction, app, record);
      case "fields": return fieldModal(interaction, app, record);
      case "fieldsave": return fieldSave(interaction, app, record);
      case "addbtn": return buttonModal(interaction, app, record);
      case "addbtnsave": return buttonSave(interaction, app, record);
      case "addsel": return selectModal(interaction, app, record);
      case "addselsave": return selectSave(interaction, app, record);
      case "clearcomp": return clearComponents(interaction, app, record);
      case "actions": return actionsGuide(interaction, app, record);
      case "editcomp": return pickComponent(interaction, app, record);
      case "editpick": return editComponentModal(interaction, app, record);
      case "editsave": return editComponentSave(interaction, app, record, extra);
      case "delcomp": return deleteComponent(interaction, app, record);
      case "togglev2": return toggleV2(interaction, app, record);
      case "preview": return livePreview(interaction, app, record);
      case "vars": return variablesGuide(interaction, app, record);
      case "tplsave": return templateSaveModal(interaction, app, record);
      case "tplsavego": return templateSave(interaction, app, record);
      case "tpls": return templatesPage(interaction, app, record);
      case "tplload": return templateLoad(interaction, app, record);
      case "tpldel": return templateDelete(interaction, app, record);
      case "sendpick": return sendPick(interaction, app, record);
      case "send": return sendTo(interaction, app, record);
      case "sync": return sync(interaction, app, record);
      case "delete": return confirmDelete(interaction, app, record);
      case "delyes": return doDelete(interaction, app, record);
      default: return null;
    }
  }
};

// ---------------- النصوص ----------------
async function textModal(interaction, app, record) {
  const d = record.data;
  const modal = new ModalBuilder().setCustomId(`eb:textsave:${record.id}`).setTitle("نصوص الإمبيد");
  modal.addComponents(
    input("title", "العنوان", TextInputStyle.Short, { value: d.title, max: 256 }),
    input("description", "الوصف", TextInputStyle.Paragraph, { value: d.description, max: 4000 }),
    input("author", "اسم الكاتب (أعلى الإمبيد)", TextInputStyle.Short, { value: d.author?.name, max: 256 }),
    input("footer", "الفوتر (أسفل الإمبيد)", TextInputStyle.Short, { value: d.footer?.text, max: 2048 }),
    input("content", "نص فوق الإمبيد (للمنشن مثلاً)", TextInputStyle.Paragraph, { value: record.content, max: 2000 })
  );
  return safeModal(interaction, modal);
}

async function textSave(interaction, app, record) {
  const get = (k) => interaction.fields.getTextInputValue(k).trim() || null;
  const data = { ...record.data };
  data.title = get("title");
  data.description = get("description");
  const authorName = get("author");
  data.author = authorName ? { ...(data.author || {}), name: authorName } : null;
  const footerText = get("footer");
  data.footer = footerText ? { ...(data.footer || {}), text: footerText } : null;

  const updated = app.embeds.save(record.id, { content: get("content"), data, components: record.components });
  return safeUpdate(interaction, editorView(app, updated));
}

// ---------------- الصور ----------------
async function mediaModal(interaction, app, record) {
  const d = record.data;
  const modal = new ModalBuilder().setCustomId(`eb:mediasave:${record.id}`).setTitle("صور الإمبيد");
  modal.addComponents(
    input("image", "الصورة الكبيرة (رابط)", TextInputStyle.Short, { value: d.image, placeholder: "https://..." }),
    input("thumbnail", "الصورة المصغّرة (رابط)", TextInputStyle.Short, { value: d.thumbnail, placeholder: "https://..." }),
    input("authorIcon", "أيقونة الكاتب (رابط)", TextInputStyle.Short, { value: d.author?.icon }),
    input("footerIcon", "أيقونة الفوتر (رابط)", TextInputStyle.Short, { value: d.footer?.icon }),
    input("url", "رابط العنوان", TextInputStyle.Short, { value: d.url })
  );
  return safeModal(interaction, modal);
}

/** يقبل الروابط الآمنة فقط لتفادي روابط غير صالحة أو مخططات خطرة. */
function safeUrl(value) {
  const v = (value || "").trim();
  if (!v) return null;
  return /^https:\/\/\S+$/i.test(v) ? v : null;
}

async function mediaSave(interaction, app, record) {
  const get = (k) => safeUrl(interaction.fields.getTextInputValue(k));
  const data = { ...record.data };
  data.image = get("image");
  data.thumbnail = get("thumbnail");
  data.url = get("url");

  const authorIcon = get("authorIcon");
  if (data.author) data.author.icon = authorIcon;
  else if (authorIcon) data.author = { name: "\u200b", icon: authorIcon };

  const footerIcon = get("footerIcon");
  if (data.footer) data.footer.icon = footerIcon;
  else if (footerIcon) data.footer = { text: "\u200b", icon: footerIcon };

  const updated = app.embeds.save(record.id, { content: record.content, data, components: record.components });
  return safeUpdate(interaction, editorView(app, updated));
}

// ---------------- اللون ----------------
async function colorModal(interaction, app, record) {
  const current = typeof record.data.color === "number" ? `#${record.data.color.toString(16).padStart(6, "0")}` : "";
  const modal = new ModalBuilder().setCustomId(`eb:colorsave:${record.id}`).setTitle("لون الإمبيد");
  modal.addComponents(
    input("color", "اللون بصيغة HEX", TextInputStyle.Short, { value: current, placeholder: "#FFD700", max: 7 }),
    input("timestamp", "إظهار الوقت؟ اكتب نعم أو لا", TextInputStyle.Short, {
      value: record.data.timestamp ? "نعم" : "لا", max: 4
    })
  );
  return safeModal(interaction, modal);
}

async function colorSave(interaction, app, record) {
  const raw = interaction.fields.getTextInputValue("color").trim().replace("#", "");
  const data = { ...record.data };
  if (/^[0-9a-fA-F]{6}$/.test(raw)) data.color = parseInt(raw, 16);
  data.timestamp = ["نعم", "yes", "true"].includes(interaction.fields.getTextInputValue("timestamp").trim().toLowerCase());

  const updated = app.embeds.save(record.id, { content: record.content, data, components: record.components });
  return safeUpdate(interaction, editorView(app, updated));
}

// ---------------- الحقول ----------------
async function fieldModal(interaction, app, record) {
  const modal = new ModalBuilder().setCustomId(`eb:fieldsave:${record.id}`).setTitle("إضافة حقل");
  modal.addComponents(
    input("name", "عنوان الحقل", TextInputStyle.Short, { required: true, max: 256 }),
    input("value", "محتوى الحقل", TextInputStyle.Paragraph, { required: true, max: 1024 }),
    input("inline", "بجانب غيره؟ نعم / لا", TextInputStyle.Short, { value: "لا", max: 4 }),
    input("remove", "لحذف حقل: اكتب رقمه (1، 2، ...)", TextInputStyle.Short, { max: 2 })
  );
  return safeModal(interaction, modal);
}

async function fieldSave(interaction, app, record) {
  const data = { ...record.data };
  data.fields = [...(data.fields || [])];

  const removeRaw = interaction.fields.getTextInputValue("remove").trim();
  if (removeRaw) {
    const index = parseInt(removeRaw, 10) - 1;
    if (index >= 0 && index < data.fields.length) data.fields.splice(index, 1);
  } else if (data.fields.length >= 25) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} وصلت للحد الأقصى (25 حقلًا).`, flags: 64 });
  } else {
    data.fields.push({
      name: interaction.fields.getTextInputValue("name"),
      value: interaction.fields.getTextInputValue("value"),
      inline: ["نعم", "yes", "true"].includes(interaction.fields.getTextInputValue("inline").trim().toLowerCase())
    });
  }

  const updated = app.embeds.save(record.id, { content: record.content, data, components: record.components });
  return safeUpdate(interaction, editorView(app, updated));
}

// ---------------- الأزرار ----------------
async function buttonModal(interaction, app, record) {
  const modal = new ModalBuilder().setCustomId(`eb:addbtnsave:${record.id}`).setTitle("إضافة زر");
  modal.addComponents(
    input("label", "نص الزر", TextInputStyle.Short, { required: true, max: 80 }),
    input("emoji", "إيموجي الزر (اختياري)", TextInputStyle.Short, { max: 32 }),
    input("style", "اللون: primary / secondary / success / danger", TextInputStyle.Short, { value: "secondary", max: 12 }),
    input("action", "إمبيد • ticket:نوع • apply:نوع • quiz • sys:... • link: • role:", TextInputStyle.Short, { required: true, max: 200 }),
    input("public", "الرد يشوفه الجميع؟ نعم / لا", TextInputStyle.Short, { value: "لا", max: 4 })
  );
  return safeModal(interaction, modal);
}

/** يحوّل ما كتبه الأدمن إلى إجراء مُتحقَّق منه. */
function parseAction(app, guildId, raw, isPublic) {
  const value = raw.trim();

  if (value.toLowerCase().startsWith("link:")) {
    const url = value.slice(5).trim();
    if (!/^https:\/\/\S+$/i.test(url)) return { error: "رابط غير صالح. لازم يبدأ بـ https://" };
    return { action: { type: "link", value: url } };
  }

  if (value.toLowerCase().startsWith("role:")) {
    const roleId = value.slice(5).trim().match(/\d{15,25}/)?.[0];
    if (!roleId) return { error: "آيدي رتبة غير صالح." };
    return { action: { type: "role", value: roleId } };
  }

  if (value.toLowerCase().startsWith("text:")) {
    return { action: { type: "text", value: value.slice(5).trim(), public: isPublic } };
  }

  if (value.toLowerCase().startsWith("ticket:")) {
    const typeName = value.slice(7).trim();
    const type = app.ticketTypes.getByName(guildId, typeName);
    if (!type) {
      return { error: `ما لقيت نوع تذكرة اسمه \`${typeName}\`. أنشئه بـ \`/ticket-type create\`.` };
    }
    return { action: { type: "ticket", value: type.id } };
  }

  if (value.toLowerCase().startsWith("apply:")) {
    const typeName = value.slice(6).trim();
    const type = app.applications.getTypeByName(guildId, typeName);
    if (!type) {
      return { error: `ما لقيت نوع تقديم اسمه \`${typeName}\`. أنشئه بـ \`/application create\`.` };
    }
    return { action: { type: "apply", value: type.id } };
  }

  if (value.toLowerCase() === "quiz") {
    return { action: { type: "quiz" } };
  }

  if (value.toLowerCase().startsWith("sys:")) {
    const raw = value.slice(4).trim();
    const { ACTIONS } = require("../economy/interactions");

    // بعض الإجراءات تقبل وسيطًا بعدها مثل: flight:join:MT-101
    const segments = raw.split(":");
    const baseKey = segments.slice(0, 2).join(":").toLowerCase();
    const argument = segments.slice(2).join(":").trim();

    const meta = ACTIONS[baseKey];
    if (!meta) {
      const list = Object.entries(ACTIONS)
        .map(([k, m]) => `\`${k}\`${m.arg ? `:<${m.arg}>` : ""}`)
        .join(" • ");
      return { error: `إجراء نظام غير معروف: \`${baseKey}\`\nالمتاح: ${list}` };
    }

    if (meta.arg && !argument) {
      return { error: `الإجراء \`${baseKey}\` يحتاج ${meta.arg}. مثال: \`sys:${baseKey}:القيمة\`` };
    }

    // نتحقق من وجود الرحلة وقت الإنشاء حتى لا يُنشر زر لرحلة غير موجودة
    if (baseKey === "flight:join") {
      const flight = app.flights.getByCode(guildId, argument);
      if (!flight) return { error: `ما لقيت رحلة برمز \`${argument}\`. أنشئها بـ \`/رحلة create\`.` };
    }

    return { action: { type: "system", value: argument ? `${baseKey}:${argument}` : baseKey } };
  }

  const target = app.embeds.getByName(guildId, value);
  if (!target) return { error: `ما لقيت إمبيد اسمه \`${value}\`. أنشئه أولًا بـ \`/embed create\`.` };
  return { action: { type: "embed", value: target.id, public: isPublic } };
}

async function buttonSave(interaction, app, record) {
  const label = interaction.fields.getTextInputValue("label").trim();
  const emoji = interaction.fields.getTextInputValue("emoji").trim() || null;
  const style = interaction.fields.getTextInputValue("style").trim().toLowerCase();
  const isPublic = ["نعم", "yes", "true"].includes(interaction.fields.getTextInputValue("public").trim().toLowerCase());

  const parsed = parseAction(app, interaction.guild.id, interaction.fields.getTextInputValue("action"), isPublic);
  if (parsed.error) return safeReply(interaction, { content: `${app.config.emoji("error")} ${parsed.error}`, flags: 64 });

  const components = [...(record.components || [])];
  if (components.length >= 20) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} وصلت للحد الأقصى من المكوّنات.`, flags: 64 });
  }
  components.push({ type: "button", label, emoji, style, action: parsed.action });

  const updated = app.embeds.save(record.id, { content: record.content, data: record.data, components });
  return safeUpdate(interaction, editorView(app, updated));
}

// ---------------- القوائم ----------------
async function selectModal(interaction, app, record) {
  const modal = new ModalBuilder().setCustomId(`eb:addselsave:${record.id}`).setTitle("إضافة قائمة اختيار");
  modal.addComponents(
    input("placeholder", "النص الظاهر في القائمة", TextInputStyle.Short, { required: true, max: 150 }),
    input(
      "options",
      "الخيارات: سطر لكل خيار",
      TextInputStyle.Paragraph,
      {
        required: true,
        max: 3000,
        placeholder: "الاسم | الوصف | اسم الإمبيد"
      }
    ),
    input("public", "الرد يشوفه الجميع؟ نعم / لا", TextInputStyle.Short, { value: "لا", max: 4 })
  );
  return safeModal(interaction, modal);
}

async function selectSave(interaction, app, record) {
  const placeholder = interaction.fields.getTextInputValue("placeholder").trim();
  const isPublic = ["نعم", "yes", "true"].includes(interaction.fields.getTextInputValue("public").trim().toLowerCase());
  const lines = interaction.fields.getTextInputValue("options").split("\n").map((l) => l.trim()).filter(Boolean);

  if (!lines.length) return safeReply(interaction, { content: `${app.config.emoji("error")} أدخل خيارًا واحدًا على الأقل.`, flags: 64 });

  const options = [];
  const errors = [];
  for (const line of lines.slice(0, 25)) {
    const [label, description, actionRaw] = line.split("|").map((p) => (p || "").trim());
    if (!label || !actionRaw) {
      errors.push(`\`${truncate(line, 60)}\` — الصيغة: الاسم | الوصف | اسم الإمبيد`);
      continue;
    }
    const parsed = parseAction(app, interaction.guild.id, actionRaw, isPublic);
    if (parsed.error) {
      errors.push(`\`${truncate(label, 40)}\` — ${parsed.error}`);
      continue;
    }
    options.push({ label, description: description || null, action: parsed.action });
  }

  if (!options.length) {
    return safeReply(interaction, {
      content: `${app.config.emoji("error")} ما نجح أي خيار:\n${errors.join("\n")}`,
      flags: 64
    });
  }

  const components = [...(record.components || []), { type: "select", placeholder, options }];
  const updated = app.embeds.save(record.id, { content: record.content, data: record.data, components });

  if (errors.length) {
    await safeReply(interaction, {
      content: `${app.config.emoji("warning")} أُضيفت ${options.length} خيارات، وتُجوهلت:\n${errors.join("\n")}`,
      flags: 64
    });
    return interaction.followUp({ ...editorView(app, updated), flags: 64 });
  }
  return safeUpdate(interaction, editorView(app, updated));
}

async function clearComponents(interaction, app, record) {
  const updated = app.embeds.save(record.id, { content: record.content, data: record.data, components: [] });
  return safeUpdate(interaction, editorView(app, updated));
}

// ---------------- دليل الإجراءات وتعديل المكوّنات ----------------

/** يعرض كل الإجراءات المتاحة فعليًا في هذا السيرفر، بأسمائها الجاهزة للنسخ. */
async function actionsGuide(interaction, app, record) {
  const guildId = interaction.guild.id;
  const { ACTIONS } = require("../economy/interactions");

  const ticketTypes = app.ticketTypes.list(guildId).filter((t) => t.enabled !== 0);
  const applyTypes = app.applications.listTypes(guildId).filter((t) => t.enabled);
  const embeds = app.embeds.list(guildId).filter((e) => e.id !== record.id);
  const openFlights = app.flights.listOpen(guildId);

  const section = (title, lines) => (lines.length ? `**${title}**\n${lines.join("\n")}` : null);

  const parts = [
    section("🎫 فتح تذكرة", ticketTypes.slice(0, 10).map((t) => `\`ticket:${t.name}\` — ${t.label}`)),
    section("📋 بدء تقديم", applyTypes.slice(0, 10).map((t) => `\`apply:${t.name}\` — ${t.label}`)),
    section("✈️ الانضمام لرحلة محددة", openFlights.slice(0, 10).map((f) => `\`sys:flight:join:${f.code}\` — ${f.destination}`)),
    section(
      "⚙️ إجراءات الأنظمة",
      Object.entries(ACTIONS).map(([k, m]) => `\`sys:${k}${m.arg ? `:<${m.arg}>` : ""}\` — ${m.label}`)
    ),
    section("📄 فتح إمبيد آخر", embeds.slice(0, 10).map((e) => `\`${e.name}\``)),
    section("🔧 إجراءات أخرى", [
      "`quiz` — بدء اختبار التفعيل",
      "`role:<آيدي الرتبة>` — إعطاء/سحب رتبة بالتبديل",
      "`text:<النص>` — رد نصي مباشر",
      "`link:https://...` — زر رابط خارجي"
    ])
  ].filter(Boolean);

  return safeReply(interaction, {
    embeds: [
      buildEmbed({
        title: "📖 الإجراءات المتاحة",
        description:
          "انسخ الإجراء واكتبه في خانة **الإجراء** عند إضافة زر أو خيار قائمة.\n\n" +
          truncate(parts.join("\n\n"), 3800),
        color: app.config.color("primary"),
        footer: "القوائم أعلاه تعكس ما هو موجود فعليًا في سيرفرك الآن"
      })
    ],
    flags: 64
  });
}

/** ملخص مقروء لإجراء مكوّن، يُعرض في قائمة التعديل. */
function describeAction(app, action) {
  if (!action) return "بلا إجراء";
  switch (action.type) {
    case "link": return `رابط: ${truncate(action.value, 40)}`;
    case "role": return `رتبة: ${action.value}`;
    case "text": return `نص: ${truncate(action.value, 40)}`;
    case "ticket": return `تذكرة: ${app.ticketTypes.get(action.value)?.name || action.value}`;
    case "apply": return `تقديم: ${app.applications.getType(action.value)?.name || action.value}`;
    case "quiz": return "اختبار التفعيل";
    case "system": return `نظام: ${action.value}`;
    case "embed": return `إمبيد: ${app.embeds.get(action.value)?.name || action.value}`;
    default: return action.type;
  }
}

/** يحوّل الإجراء المخزَّن إلى النص الذي يكتبه الأدمن، ليظهر جاهزًا في نافذة التعديل. */
function actionToText(app, action) {
  if (!action) return "";
  switch (action.type) {
    case "link": return `link:${action.value}`;
    case "role": return `role:${action.value}`;
    case "text": return `text:${action.value}`;
    case "ticket": return `ticket:${app.ticketTypes.get(action.value)?.name || action.value}`;
    case "apply": return `apply:${app.applications.getType(action.value)?.name || action.value}`;
    case "quiz": return "quiz";
    case "system": return `sys:${action.value}`;
    case "embed": return app.embeds.get(action.value)?.name || action.value;
    default: return "";
  }
}

async function pickComponent(interaction, app, record) {
  const components = record.components || [];
  if (!components.length) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} ما فيه مكوّنات لتعديلها.`, flags: 64 });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`eb:editpick:${record.id}`)
    .setPlaceholder("اختر المكوّن الذي تريد تعديله")
    .addOptions(
      components.slice(0, 25).map((c, i) => ({
        label: truncate(c.type === "button" ? c.label : c.placeholder || "قائمة", 80),
        description: truncate(
          c.type === "button" ? describeAction(app, c.action) : `قائمة فيها ${(c.options || []).length} خيار`,
          90
        ),
        value: String(i),
        emoji: c.type === "button" ? "🔘" : "📑"
      }))
    );

  return safeUpdate(interaction, {
    embeds: [buildEmbed({ title: "✏️ تعديل مكوّن", description: "اختر المكوّن من القائمة.", color: app.config.color("primary") })],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(btn(`eb:open:${record.id}`, "رجوع", "⬅️"))
    ]
  });
}

async function editComponentModal(interaction, app, record) {
  const index = parseInt(interaction.values[0], 10);
  const component = (record.components || [])[index];
  if (!component) return safeReply(interaction, { content: `${app.config.emoji("error")} المكوّن لم يعد موجودًا.`, flags: 64 });

  const modal = new ModalBuilder()
    .setCustomId(`eb:editsave:${record.id}:${index}`)
    .setTitle(component.type === "button" ? "تعديل الزر" : "تعديل القائمة");

  if (component.type === "button") {
    modal.addComponents(
      input("label", "نص الزر", TextInputStyle.Short, { required: true, max: 80, value: component.label }),
      input("emoji", "إيموجي الزر (اختياري)", TextInputStyle.Short, { max: 32, value: component.emoji || "" }),
      input("style", "اللون: primary / secondary / success / danger", TextInputStyle.Short, { max: 12, value: component.style || "secondary" }),
      input("action", "الإجراء عند الضغط", TextInputStyle.Short, { required: true, max: 200, value: actionToText(app, component.action) }),
      input("public", "الرد يشوفه الجميع؟ نعم / لا", TextInputStyle.Short, { max: 4, value: component.action?.public ? "نعم" : "لا" })
    );
  } else {
    const lines = (component.options || [])
      .map((o) => `${o.label} | ${o.description || ""} | ${actionToText(app, o.action)}`)
      .join("\n");
    modal.addComponents(
      input("placeholder", "النص الظاهر في القائمة", TextInputStyle.Short, { required: true, max: 150, value: component.placeholder }),
      input("options", "الخيارات: سطر لكل خيار", TextInputStyle.Paragraph, { required: true, max: 3000, value: lines }),
      input("public", "الرد يشوفه الجميع؟ نعم / لا", TextInputStyle.Short, { max: 4, value: "لا" })
    );
  }

  return safeModal(interaction, modal);
}

async function editComponentSave(interaction, app, record, indexRaw) {
  const index = parseInt(indexRaw, 10);
  const components = [...(record.components || [])];
  const existing = components[index];
  if (!existing) return safeReply(interaction, { content: `${app.config.emoji("error")} المكوّن لم يعد موجودًا.`, flags: 64 });

  const isPublic = ["نعم", "yes", "true"].includes(interaction.fields.getTextInputValue("public").trim().toLowerCase());

  if (existing.type === "button") {
    const parsed = parseAction(app, interaction.guild.id, interaction.fields.getTextInputValue("action"), isPublic);
    if (parsed.error) return safeReply(interaction, { content: `${app.config.emoji("error")} ${parsed.error}`, flags: 64 });

    components[index] = {
      type: "button",
      label: interaction.fields.getTextInputValue("label").trim(),
      emoji: interaction.fields.getTextInputValue("emoji").trim() || null,
      style: interaction.fields.getTextInputValue("style").trim().toLowerCase(),
      action: parsed.action
    };
  } else {
    const lines = interaction.fields.getTextInputValue("options").split("\n").map((l) => l.trim()).filter(Boolean);
    const options = [];
    const errors = [];

    for (const line of lines.slice(0, 25)) {
      const [label, description, actionRaw] = line.split("|").map((p) => (p || "").trim());
      if (!label || !actionRaw) {
        errors.push(`\`${truncate(line, 60)}\` — الصيغة: الاسم | الوصف | الإجراء`);
        continue;
      }
      const parsed = parseAction(app, interaction.guild.id, actionRaw, isPublic);
      if (parsed.error) {
        errors.push(`\`${truncate(label, 40)}\` — ${parsed.error}`);
        continue;
      }
      options.push({ label, description: description || null, action: parsed.action });
    }

    if (!options.length) {
      return safeReply(interaction, {
        content: `${app.config.emoji("error")} ما نجح أي خيار.\n${errors.slice(0, 5).join("\n")}`,
        flags: 64
      });
    }

    components[index] = {
      type: "select",
      placeholder: interaction.fields.getTextInputValue("placeholder").trim(),
      options
    };
  }

  const updated = app.embeds.save(record.id, { content: record.content, data: record.data, components });
  return safeUpdate(interaction, editorView(app, updated));
}

async function deleteComponent(interaction, app, record) {
  const index = parseInt(interaction.values[0], 10);
  const components = (record.components || []).filter((_, i) => i !== index);
  const updated = app.embeds.save(record.id, { content: record.content, data: record.data, components });
  return safeUpdate(interaction, editorView(app, updated));
}

// ---------------- الشكل الحديث والمعاينة ----------------

/** يبدّل بين الشكل التقليدي والحديث (الأزرار داخل الحاوية). */
async function toggleV2(interaction, app, record) {
  const updated = app.embeds.setV2(record.id, !record.use_v2);
  return safeUpdate(interaction, editorView(app, updated));
}

/**
 * معاينة حية بالشكل النهائي تمامًا.
 * تُرسل كرسالة مخفية منفصلة لأن الشكل الحديث لا يمكن دمجه مع إمبيدات المحرّر
 * في نفس الرسالة — ديسكورد يمنع خلط النمطين.
 */
async function livePreview(interaction, app, record) {
  const payload = app.embedService.payload(record, {
    member: interaction.member,
    guild: interaction.guild,
    allowMentions: false
  });

  if (payload.flags) {
    return safeReply(interaction, {
      flags: payload.flags | 64,
      components: payload.components,
      allowedMentions: { parse: [] }
    });
  }

  return safeReply(interaction, {
    content: payload.content,
    embeds: payload.embeds,
    components: payload.components,
    allowedMentions: { parse: [] },
    flags: 64
  });
}

// ---------------- الإرسال والتحديث ----------------
async function sendPick(interaction, app, record) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(`eb:send:${record.id}`)
    .setPlaceholder("اختر القناة")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  return safeUpdate(interaction, {
    embeds: [buildEmbed({ title: "📤 إرسال الإمبيد", description: "اختر القناة من القائمة.", color: app.config.color("primary") })],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(btn(`eb:open:${record.id}`, "رجوع", "⬅️"))
    ]
  });
}

async function sendTo(interaction, app, record) {
  const channelId = interaction.values[0];
  const channel = interaction.guild.channels.cache.get(channelId);
  const me = interaction.guild.members.me;

  if (!channel?.isTextBased() || !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    return safeUpdate(interaction, {
      embeds: [buildEmbed({
        description: `${app.config.emoji("error")} لا أملك صلاحية الإرسال في <#${channelId}>.`,
        color: app.config.color("danger")
      })],
      components: [new ActionRowBuilder().addComponents(btn(`eb:open:${record.id}`, "رجوع", "⬅️"))]
    });
  }

  const payload = app.embedService.payload(record, { guild: interaction.guild, allowMentions: true });
  const message = await channel.send(payload).catch(() => null);
  if (!message) {
    return safeUpdate(interaction, {
      embeds: [buildEmbed({ description: `${app.config.emoji("error")} فشل الإرسال.`, color: app.config.color("danger") })],
      components: [new ActionRowBuilder().addComponents(btn(`eb:open:${record.id}`, "رجوع", "⬅️"))]
    });
  }

  // نتتبّع الرسالة حتى نقدر نحدّثها لاحقًا عند تعديل الإمبيد
  app.embeds.trackMessage({
    embedId: record.id,
    guildId: interaction.guild.id,
    channelId: channel.id,
    messageId: message.id
  });

  return safeUpdate(interaction, {
    embeds: [buildEmbed({
      description: `${app.config.emoji("success")} تم الإرسال إلى <#${channel.id}>\nأي تعديل مستقبلي تطبّقه بزر **تحديث المرسل**.`,
      color: app.config.color("success")
    })],
    components: [new ActionRowBuilder().addComponents(btn(`eb:open:${record.id}`, "رجوع للمحرّر", "⬅️"))]
  });
}

async function sync(interaction, app, record) {
  await interaction.deferReply({ flags: 64 });
  const result = await app.embedService.syncMessages(record);

  // فشل تحديث رسائل موجودة مع بقاء تتبّعها يعني غالبًا تغيير نمط العرض،
  // وديسكورد يمنع تحويل رسالة منشورة بين التقليدي والحديث — ننبّه بدل الصمت
  const failed = result.total - result.updated - result.removed;

  return safeUpdate(interaction, {
    content:
      `${app.config.emoji("success")} تم تحديث \`${result.updated}\` رسالة.` +
      (result.removed ? `\n🧹 أُزيلت \`${result.removed}\` رسالة محذوفة من التتبّع.` : "") +
      (failed > 0
        ? `\n${app.config.emoji("warning")} تعذّر تحديث \`${failed}\` رسالة.\n` +
          "غالبًا لأنك غيّرت **الشكل** (تقليدي ↔ حديث) بعد نشرها — ديسكورد ما يسمح بتحويل رسالة منشورة بين النمطين.\n" +
          "الحل: احذف الرسالة القديمة وانشرها من جديد بـ **إرسال لقناة**."
        : "") +
      (result.total === 0 ? "\nℹ️ ما أرسلت هذا الإمبيد لأي قناة بعد." : "")
  });
}

// ---------------- الحذف ----------------
async function confirmDelete(interaction, app, record) {
  return safeUpdate(interaction, {
    embeds: [buildEmbed({
      title: `${app.config.emoji("warning")} تأكيد الحذف`,
      description: `متأكد من حذف \`${record.name}\`؟\nالأوامر المرتبطة به راح تفقد ارتباطها، والرسائل المنشورة تبقى لكن أزرارها تتوقف.`,
      color: app.config.color("danger")
    })],
    components: [
      new ActionRowBuilder().addComponents(
        btn(`eb:delyes:${record.id}`, "نعم، احذف", "🗑️", ButtonStyle.Danger),
        btn(`eb:open:${record.id}`, "إلغاء", "⬅️")
      )
    ]
  });
}

async function doDelete(interaction, app, record) {
  app.embeds.delete(record.id);
  return safeUpdate(interaction, {
    embeds: [buildEmbed({ description: `${app.config.emoji("success")} تم حذف \`${record.name}\`.`, color: app.config.color("neutral") })],
    components: []
  });
}

// ============================================================
//  المتغيرات والقوالب
// ============================================================

/** دليل المتغيرات: يعرضها مجمّعة مع معاينة حيّة بقيم المستخدم نفسه. */
async function variablesGuide(interaction, app, record) {
  const ctx = variables.buildContext({
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    client: app.client
  });

  const fields = Object.entries(variables.VARIABLE_GROUPS).map(([group, names]) => ({
    name: group,
    value: names.map((n) => `\`{${n}}\``).join(" • ")
  }));

  return safeUpdate(interaction, {
    embeds: [buildEmbed({
      title: "🔣 المتغيرات المتاحة",
      description:
        `اكتب أي متغير داخل نصوص الإمبيد ويُستبدل عند الإرسال.\n` +
        `**حالة الأحرف لا تهم** — \`{USER}\` و\`{user}\` سواء.\n\n` +
        `**معاينة حيّة بقيمك:**\n` +
        variables.apply("{USER} في {SERVER} • {MEMBERS} عضو • {CHANNEL} • {DATE}", ctx),
      color: app.config.color("primary"),
      fields,
      footer: `${variables.VARIABLE_NAMES.length} متغيرًا • المتغير غير المعروف يبقى كما هو`
    })],
    components: [new ActionRowBuilder().addComponents(btn(`eb:open:${record.id}`, "رجوع للمحرّر", "⬅️"))]
  });
}

async function templateSaveModal(interaction, app, record) {
  const modal = new ModalBuilder()
    .setCustomId(`eb:tplsavego:${record.id}`)
    .setTitle("حفظ كقالب");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("name")
        .setLabel("اسم القالب")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(60)
        .setValue(record.name)
    )
  );
  return safeModal(interaction, modal);
}

async function templateSave(interaction, app, record) {
  const name = interaction.fields.getTextInputValue("name").trim();
  if (!name) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} الاسم لا يصح فارغًا.`, flags: 64 });
  }

  const existed = !!app.embeds.getTemplate(interaction.guild.id, name);
  app.embeds.saveTemplate({
    guildId: interaction.guild.id,
    name,
    content: record.content,
    data: record.data,
    components: record.components,
    createdBy: interaction.user.id
  });

  return safeReply(interaction, {
    content:
      `${app.config.emoji("success")} ${existed ? "حُدِّث" : "حُفظ"} القالب **${name}**.\n` +
      "تقدر تحمّله على أي إمبيد من زر **📂 القوالب**.",
    flags: 64
  });
}

async function templatesPage(interaction, app, record) {
  const templates = app.embeds.listTemplates(interaction.guild.id);

  if (!templates.length) {
    return safeUpdate(interaction, {
      embeds: [buildEmbed({
        title: "📂 القوالب المحفوظة",
        description: "ما فيه قوالب بعد.\nاضغط **💾 حفظ كقالب** لحفظ الإمبيد الحالي كقالب تعيد استخدامه لاحقًا.",
        color: app.config.color("neutral")
      })],
      components: [new ActionRowBuilder().addComponents(btn(`eb:open:${record.id}`, "رجوع", "⬅️"))]
    });
  }

  const options = templates.slice(0, 25).map((t) => ({
    label: truncate(t.name, 100),
    description: truncate(t.data?.title || t.content || "بلا عنوان", 90),
    value: t.name
  }));

  const load = new StringSelectMenuBuilder()
    .setCustomId(`eb:tplload:${record.id}`)
    .setPlaceholder("تحميل قالب على هذا الإمبيد...")
    .addOptions(options);

  const del = new StringSelectMenuBuilder()
    .setCustomId(`eb:tpldel:${record.id}`)
    .setPlaceholder("حذف قالب...")
    .addOptions(options);

  return safeUpdate(interaction, {
    embeds: [buildEmbed({
      title: "📂 القوالب المحفوظة",
      description:
        `**${templates.length}** قالب.\n` +
        "⚠️ التحميل **يستبدل** محتوى الإمبيد الحالي بالكامل (الاسم يبقى).",
      color: app.config.color("primary"),
      fields: [{
        name: "القوالب",
        value: truncate(
          templates.map((t) => `• **${t.name}**${t.uses ? ` — استُخدم ${t.uses} مرة` : ""}`).join("\n"),
          1000
        )
      }]
    })],
    components: [
      new ActionRowBuilder().addComponents(load),
      new ActionRowBuilder().addComponents(del),
      new ActionRowBuilder().addComponents(btn(`eb:open:${record.id}`, "رجوع", "⬅️"))
    ]
  });
}

async function templateLoad(interaction, app, record) {
  const name = interaction.values?.[0];
  if (!name) return safeReply(interaction, { content: `${app.config.emoji("error")} لم تختر قالبًا.`, flags: 64 });

  const updated = app.embeds.applyTemplate(interaction.guild.id, name, record.id);
  if (!updated) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذا القالب لم يعد موجودًا.`, flags: 64 });
  }

  return safeUpdate(interaction, editorView(app, updated));
}

async function templateDelete(interaction, app, record) {
  const name = interaction.values?.[0];
  if (!name) return safeReply(interaction, { content: `${app.config.emoji("error")} لم تختر قالبًا.`, flags: 64 });

  app.embeds.deleteTemplate(interaction.guild.id, name);
  return templatesPage(interaction, app, app.embeds.get(record.id));
}
