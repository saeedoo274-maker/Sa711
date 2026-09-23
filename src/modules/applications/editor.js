const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits
} = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { buildEmbed, truncate, parseDuration, formatDuration } = require("../../core/utils/helpers");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * محرّر أنواع التقديم.
 * كل شيء قابل للتعديل بالأزرار: النصوص، الزخرفة، الأسئلة، المنشن، الرتب، القنوات.
 */

function btn(id, label, emoji, style = ButtonStyle.Secondary) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function input(id, label, style, { required = false, value, max, placeholder } = {}) {
  const t = new TextInputBuilder().setCustomId(id).setLabel(truncate(label, 45)).setStyle(style).setRequired(required);
  if (value !== undefined && value !== null && value !== "") t.setValue(truncate(String(value), max || 4000));
  if (max) t.setMaxLength(max);
  if (placeholder) t.setPlaceholder(truncate(placeholder, 100));
  return new ActionRowBuilder().addComponents(t);
}

/** اللوحة الرئيسية للمحرّر مع معاينة حية للطلب. */
function view(app, type, guild) {
  const style = type.style || {};
  const mentionText = app.applicationService.mentionText(type) || "—";

  const info = buildEmbed({
    title: `📋 محرّر التقديم — \`${type.name}\``,
    description:
      `**${type.label}**\n${type.description || "*(بلا وصف)*"}\n\n` +
      "المعاينة بالأسفل. اضغط أي زر لتعديل الجزء المقابل.",
    color: app.config.color("neutral"),
    fields: [
      { name: "الحالة", value: type.enabled ? "🟢 مفتوح" : "⚪ مغلق", inline: true },
      { name: "الأسئلة", value: `\`${type.questions.length}\``, inline: true },
      { name: "طريقة الجمع", value: type.collect_mode === "dm" ? "الخاص" : "نافذة", inline: true },
      { name: "قناة المراجعة", value: type.review_channel_id ? `<#${type.review_channel_id}>` : "⚠️ غير محددة", inline: true },
      { name: "رتبة القبول", value: type.accept_role_id ? `<@&${type.accept_role_id}>` : "—", inline: true },
      { name: "رتبة تُسحب", value: type.remove_role_id ? `<@&${type.remove_role_id}>` : "—", inline: true },
      { name: "المنشن عند طلب جديد", value: mentionText, inline: false },
      { name: "مهلة إعادة التقديم", value: type.cooldown_ms ? formatDuration(type.cooldown_ms) : "بلا مهلة", inline: true },
      { name: "الإجراء في اللوحات", value: `\`apply:${type.name}\``, inline: true }
    ],
    timestamp: false
  });

  // معاينة بطلب وهمي حتى يرى الأدمن الشكل النهائي قبل النشر
  const sample = {
    number: 0,
    user_id: "000000000000000000",
    status: "pending",
    answers: Object.fromEntries(type.questions.slice(0, 5).map((q) => [q.label, "..."])),
    image_url: null
  };
  const preview = app.applicationService.buildEmbed(guild, type, sample, null);

  const rows = [
    new ActionRowBuilder().addComponents(
      btn(`app:ed:text:${type.id}`, "النصوص", "📝", ButtonStyle.Primary),
      btn(`app:ed:style:${type.id}`, "الزخرفة", "🎨"),
      btn(`app:ed:q:${type.id}`, "الأسئلة", "❓", ButtonStyle.Primary),
      btn(`app:ed:cfg:${type.id}`, "الإعدادات", "⚙️")
    ),
    new ActionRowBuilder().addComponents(
      btn(`app:ed:chan:${type.id}`, "قناة المراجعة", "📥"),
      btn(`app:ed:role:${type.id}`, "رتبة القبول", "🎖️"),
      btn(`app:ed:rrole:${type.id}`, "رتبة تُسحب", "➖"),
      btn(`app:ed:mention:${type.id}`, "المنشن", "🔔")
    ),
    new ActionRowBuilder().addComponents(
      btn(`app:ed:toggle:${type.id}`, type.enabled ? "إغلاق التقديم" : "فتح التقديم", type.enabled ? "🔒" : "🔓"),
      btn(`app:ed:panel:${type.id}`, "نشر لوحة التقديم", "📤", ButtonStyle.Success),
      btn(`app:ed:del:${type.id}`, "حذف النوع", "🗑️", ButtonStyle.Danger)
    )
  ];

  return { embeds: [info, preview], components: rows };
}

/** لوحة إدارة الأسئلة. */
function questionsView(app, type) {
  const list = type.questions.length
    ? type.questions
        .map((q, i) => {
          const tags = [q.image && "🖼️ صورة", q.numeric && "🔢 أرقام", q.long && "📝 طويل"].filter(Boolean).join(" • ");
          return `\`${i + 1}.\` ${truncate(q.label, 120)}${tags ? `\n   ${tags}` : ""}`;
        })
        .join("\n")
    : "*(ما فيه أسئلة بعد)*";

  const needsDM = type.questions.length > 5 || type.questions.some((q) => q.image);

  const embed = buildEmbed({
    title: `❓ أسئلة — ${type.label}`,
    description: list,
    color: app.config.color("primary"),
    fields: [
      {
        name: "طريقة الجمع الفعلية",
        value: needsDM
          ? "📩 الخاص — لأن الأسئلة أكثر من 5 أو فيها صورة"
          : type.collect_mode === "dm"
            ? "📩 الخاص — باختيارك"
            : "🪟 نافذة سريعة"
      }
    ],
    timestamp: false
  });

  const rows = [
    new ActionRowBuilder().addComponents(
      btn(`app:ed:qadd:${type.id}`, "إضافة سؤال", "➕", ButtonStyle.Success),
      btn(`app:ed:qpick:${type.id}`, "تعديل سؤال", "✏️"),
      btn(`app:ed:qdelpick:${type.id}`, "حذف سؤال", "🗑️", ButtonStyle.Danger),
      btn(`app:ed:qmove:${type.id}`, "ترتيب", "↕️")
    ),
    new ActionRowBuilder().addComponents(btn(`app:ed:open:${type.id}`, "رجوع", "⬅️"))
  ];

  return { embeds: [embed], components: rows };
}

async function handle(interaction, app, action, args) {
  // المحرّر للأدمن فقط، والفحص من الخادم عند كل ضغطة
  if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
    return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
  }

  const typeId = args[0];
  const type = app.applications.getType(typeId);
  if (!type || type.guild_id !== interaction.guild.id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} نوع التقديم لم يعد موجودًا.`, flags: 64 });
  }

  const back = (t) => safeUpdate(interaction, view(app, t, interaction.guild));

  switch (action) {
    case "open":
      return back(type);

    // ---------------- النصوص ----------------
    case "text": {
      const modal = new ModalBuilder().setCustomId(`app:ed:textsave:${type.id}`).setTitle("نصوص التقديم");
      modal.addComponents(
        input("label", "الاسم الظاهر", TextInputStyle.Short, { required: true, value: type.label, max: 80 }),
        input("description", "الوصف", TextInputStyle.Paragraph, { value: type.description, max: 500 }),
        input("accept", "رسالة القبول", TextInputStyle.Paragraph, {
          value: type.accept_message, max: 1000, placeholder: "تشعرك لجنة القبول بقبولك في {type}"
        }),
        input("reject", "رسالة الرفض", TextInputStyle.Paragraph, { value: type.reject_message, max: 1000 })
      );
      return safeModal(interaction, modal);
    }
    case "textsave": {
      const g = (k) => interaction.fields.getTextInputValue(k).trim() || null;
      app.applications.updateType(type.id, "label", g("label") || type.label);
      app.applications.updateType(type.id, "description", g("description"));
      app.applications.updateType(type.id, "accept_message", g("accept"));
      app.applications.updateType(type.id, "reject_message", g("reject"));
      return back(app.applications.getType(type.id));
    }

    // ---------------- الزخرفة ----------------
    case "style": {
      const st = type.style || {};
      const hex = typeof st.color === "number" ? `#${st.color.toString(16).padStart(6, "0")}` : "";
      const modal = new ModalBuilder().setCustomId(`app:ed:stylesave:${type.id}`).setTitle("زخرفة إمبيد الطلب");
      modal.addComponents(
        input("title", "عنوان الطلب", TextInputStyle.Short, {
          value: st.title, max: 200, placeholder: "طلب تقديم — {type}"
        }),
        input("color", "لون الانتظار HEX", TextInputStyle.Short, { value: hex, max: 7, placeholder: "#FFD700" }),
        input("image", "صورة كبيرة (رابط https)", TextInputStyle.Short, { value: st.image }),
        input("thumbnail", "صورة مصغّرة (رابط https)", TextInputStyle.Short, { value: st.thumbnail }),
        input("footer", "الفوتر", TextInputStyle.Short, { value: st.footer, max: 200, placeholder: "طلب رقم {number}" })
      );
      return safeModal(interaction, modal);
    }
    case "stylesave": {
      const g = (k) => interaction.fields.getTextInputValue(k).trim();
      const url = (v) => (/^https:\/\/\S+$/i.test(v) ? v : null);
      const style = { ...(type.style || {}) };

      style.title = g("title") || null;
      style.footer = g("footer") || null;
      style.image = url(g("image"));
      style.thumbnail = url(g("thumbnail"));

      const raw = g("color").replace("#", "");
      style.color = /^[0-9a-fA-F]{6}$/.test(raw) ? parseInt(raw, 16) : undefined;

      app.applications.setStyle(type.id, style);
      return back(app.applications.getType(type.id));
    }

    // ---------------- الأسئلة ----------------
    case "q":
      return safeUpdate(interaction, questionsView(app, type));

    case "qadd": {
      if (type.questions.length >= 20) {
        return safeReply(interaction, { content: `${app.config.emoji("error")} وصلت للحد الأقصى (20 سؤال).`, flags: 64 });
      }
      const modal = new ModalBuilder().setCustomId(`app:ed:qaddsave:${type.id}`).setTitle("إضافة سؤال");
      modal.addComponents(
        input("label", "نص السؤال", TextInputStyle.Short, { required: true, max: 200 }),
        input("kind", "النوع: عادي / طويل / أرقام / صورة", TextInputStyle.Short, { value: "عادي", max: 10 })
      );
      return safeModal(interaction, modal);
    }
    case "qaddsave": {
      const label = interaction.fields.getTextInputValue("label").trim();
      app.applications.addQuestion(type.id, { label, ...parseKind(interaction.fields.getTextInputValue("kind")), required: true });
      return safeUpdate(interaction, questionsView(app, app.applications.getType(type.id)));
    }

    case "qpick":
    case "qdelpick": {
      if (!type.questions.length) {
        return safeReply(interaction, { content: `${app.config.emoji("warning")} ما فيه أسئلة.`, flags: 64 });
      }
      const isDelete = action === "qdelpick";
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`app:ed:${isDelete ? "qdel" : "qedit"}:${type.id}`)
        .setPlaceholder(isDelete ? "اختر السؤال المراد حذفه" : "اختر السؤال المراد تعديله")
        .addOptions(
          type.questions.slice(0, 25).map((q, i) => ({
            label: `${i + 1}. ${truncate(q.label, 90)}`,
            value: String(i)
          }))
        );
      return safeUpdate(interaction, {
        embeds: [buildEmbed({ title: isDelete ? "🗑️ حذف سؤال" : "✏️ تعديل سؤال", color: app.config.color("primary"), timestamp: false })],
        components: [
          new ActionRowBuilder().addComponents(menu),
          new ActionRowBuilder().addComponents(btn(`app:ed:q:${type.id}`, "رجوع", "⬅️"))
        ]
      });
    }
    case "qdel": {
      const index = parseInt(interaction.values[0], 10);
      app.applications.removeQuestion(type.id, index);
      return safeUpdate(interaction, questionsView(app, app.applications.getType(type.id)));
    }
    case "qedit": {
      const index = parseInt(interaction.values[0], 10);
      const q = type.questions[index];
      if (!q) return safeUpdate(interaction, questionsView(app, type));
      const kind = q.image ? "صورة" : q.numeric ? "أرقام" : q.long ? "طويل" : "عادي";
      const modal = new ModalBuilder().setCustomId(`app:ed:qeditsave:${type.id}:${index}`).setTitle(`تعديل السؤال ${index + 1}`);
      modal.addComponents(
        input("label", "نص السؤال", TextInputStyle.Short, { required: true, value: q.label, max: 200 }),
        input("kind", "النوع: عادي / طويل / أرقام / صورة", TextInputStyle.Short, { value: kind, max: 10 })
      );
      return safeModal(interaction, modal);
    }
    case "qeditsave": {
      const index = parseInt(args[1], 10);
      app.applications.updateQuestion(type.id, index, {
        label: interaction.fields.getTextInputValue("label").trim(),
        ...parseKind(interaction.fields.getTextInputValue("kind"))
      });
      return safeUpdate(interaction, questionsView(app, app.applications.getType(type.id)));
    }

    case "qmove": {
      const modal = new ModalBuilder().setCustomId(`app:ed:qmovesave:${type.id}`).setTitle("ترتيب الأسئلة");
      modal.addComponents(
        input("from", "رقم السؤال الحالي", TextInputStyle.Short, { required: true, max: 2 }),
        input("to", "الموضع الجديد", TextInputStyle.Short, { required: true, max: 2 })
      );
      return safeModal(interaction, modal);
    }
    case "qmovesave": {
      const from = parseInt(interaction.fields.getTextInputValue("from"), 10) - 1;
      const to = parseInt(interaction.fields.getTextInputValue("to"), 10) - 1;
      if (isNaN(from) || isNaN(to) || !app.applications.moveQuestion(type.id, from, to)) {
        return safeReply(interaction, { content: `${app.config.emoji("error")} أرقام غير صالحة.`, flags: 64 });
      }
      return safeUpdate(interaction, questionsView(app, app.applications.getType(type.id)));
    }

    // ---------------- القنوات والرتب ----------------
    case "chan": {
      const select = new ChannelSelectMenuBuilder()
        .setCustomId(`app:ed:chanset:${type.id}`)
        .setPlaceholder("اختر قناة مراجعة الطلبات")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
      return pickerView(interaction, app, type, "📥 قناة المراجعة", select);
    }
    case "chanset": {
      const channelId = interaction.values[0];
      const channel = interaction.guild.channels.cache.get(channelId);
      const me = interaction.guild.members.me;
      if (channel && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
        return safeUpdate(interaction, {
          embeds: [buildEmbed({ description: `${app.config.emoji("error")} لا أملك صلاحية الإرسال في <#${channelId}>.`, color: app.config.color("danger") })],
          components: [new ActionRowBuilder().addComponents(btn(`app:ed:open:${type.id}`, "رجوع", "⬅️"))]
        });
      }
      app.applications.updateType(type.id, "review_channel_id", channelId);
      return back(app.applications.getType(type.id));
    }

    case "role":
    case "rrole": {
      const isAccept = action === "role";
      const select = new RoleSelectMenuBuilder()
        .setCustomId(`app:ed:${isAccept ? "roleset" : "rroleset"}:${type.id}`)
        .setPlaceholder(isAccept ? "اختر رتبة القبول" : "اختر الرتبة التي تُسحب");
      return pickerView(interaction, app, type, isAccept ? "🎖️ رتبة القبول" : "➖ رتبة تُسحب عند القبول", select);
    }
    case "roleset":
    case "rroleset": {
      const roleId = interaction.values[0];
      const role = interaction.guild.roles.cache.get(roleId);
      const me = interaction.guild.members.me;
      if (role && (role.managed || role.position >= me.roles.highest.position)) {
        return safeUpdate(interaction, {
          embeds: [buildEmbed({
            description: `${app.config.emoji("error")} لا أستطيع إدارة <@&${roleId}>. ارفع رتبة البوت فوقها.`,
            color: app.config.color("danger")
          })],
          components: [new ActionRowBuilder().addComponents(btn(`app:ed:open:${type.id}`, "رجوع", "⬅️"))]
        });
      }
      app.applications.updateType(type.id, action === "roleset" ? "accept_role_id" : "remove_role_id", roleId);
      return back(app.applications.getType(type.id));
    }

    // ---------------- المنشن ----------------
    case "mention": {
      const select = new RoleSelectMenuBuilder()
        .setCustomId(`app:ed:mentionset:${type.id}`)
        .setPlaceholder("اختر الرتب التي تُمنشن عند طلب جديد")
        .setMinValues(0)
        .setMaxValues(5);
      return safeUpdate(interaction, {
        embeds: [buildEmbed({
          title: "🔔 المنشن عند وصول طلب جديد",
          description:
            `الحالي: ${app.applicationService.mentionText(type) || "—"}\n\n` +
            "اختر حتى 5 رتب، أو استخدم الأزرار لإضافة `@everyone` و `@here`.\n" +
            "اختيار فارغ يلغي كل المنشنات.",
          color: app.config.color("primary"),
          timestamp: false
        })],
        components: [
          new ActionRowBuilder().addComponents(select),
          new ActionRowBuilder().addComponents(
            btn(`app:ed:mtoggle:${type.id}:everyone`, "everyone@", "📢"),
            btn(`app:ed:mtoggle:${type.id}:here`, "here@", "📣"),
            btn(`app:ed:mclear:${type.id}`, "مسح الكل", "🧹", ButtonStyle.Danger),
            btn(`app:ed:open:${type.id}`, "رجوع", "⬅️")
          )
        ]
      });
    }
    case "mentionset": {
      // نحتفظ بـ everyone/here ونستبدل الرتب فقط
      const keep = (type.mentions || []).filter((m) => m === "everyone" || m === "here");
      app.applications.setMentions(type.id, [...keep, ...interaction.values]);
      return back(app.applications.getType(type.id));
    }
    case "mtoggle": {
      const which = args[1];
      const current = new Set(type.mentions || []);
      if (current.has(which)) current.delete(which);
      else current.add(which);
      app.applications.setMentions(type.id, [...current]);
      return back(app.applications.getType(type.id));
    }
    case "mclear": {
      app.applications.setMentions(type.id, []);
      return back(app.applications.getType(type.id));
    }

    // ---------------- الإعدادات ----------------
    case "cfg": {
      const modal = new ModalBuilder().setCustomId(`app:ed:cfgsave:${type.id}`).setTitle("إعدادات التقديم");
      modal.addComponents(
        input("mode", "طريقة الجمع: نافذة / خاص", TextInputStyle.Short, {
          value: type.collect_mode === "dm" ? "خاص" : "نافذة", max: 10
        }),
        input("cooldown", "مهلة إعادة التقديم بعد الرفض", TextInputStyle.Short, {
          value: type.cooldown_ms ? `${Math.round(type.cooldown_ms / 86400000)}d` : "", max: 10, placeholder: "7d"
        }),
        input("emoji", "إيموجي النوع", TextInputStyle.Short, { value: type.emoji, max: 32 }),
        input("fieldEmoji", "إيموجي حقول الطلب", TextInputStyle.Short, {
          value: type.style?.fieldEmoji ?? "👤", max: 32, placeholder: "👤"
        })
      );
      return safeModal(interaction, modal);
    }
    case "cfgsave": {
      const mode = interaction.fields.getTextInputValue("mode").trim();
      app.applications.updateType(type.id, "collect_mode", ["خاص", "dm", "الخاص"].includes(mode) ? "dm" : "modal");

      const cd = interaction.fields.getTextInputValue("cooldown").trim();
      app.applications.updateType(type.id, "cooldown_ms", cd ? parseDuration(cd) || 0 : 0);

      app.applications.updateType(type.id, "emoji", interaction.fields.getTextInputValue("emoji").trim() || null);

      const style = { ...(type.style || {}), fieldEmoji: interaction.fields.getTextInputValue("fieldEmoji").trim() };
      app.applications.setStyle(type.id, style);

      return back(app.applications.getType(type.id));
    }

    case "toggle": {
      app.applications.updateType(type.id, "enabled", type.enabled ? 0 : 1);
      return back(app.applications.getType(type.id));
    }

    // ---------------- نشر لوحة التقديم ----------------
    case "panel": {
      const select = new ChannelSelectMenuBuilder()
        .setCustomId(`app:ed:panelsend:${type.id}`)
        .setPlaceholder("اختر قناة نشر لوحة التقديم")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
      return pickerView(interaction, app, type, "📤 نشر لوحة التقديم", select);
    }
    case "panelsend": {
      const channel = interaction.guild.channels.cache.get(interaction.values[0]);
      if (!channel?.isTextBased()) {
        return safeUpdate(interaction, {
          embeds: [buildEmbed({ description: `${app.config.emoji("error")} قناة غير صالحة.`, color: app.config.color("danger") })],
          components: [new ActionRowBuilder().addComponents(btn(`app:ed:open:${type.id}`, "رجوع", "⬅️"))]
        });
      }

      const style = type.style || {};
      const button = new ButtonBuilder()
        .setCustomId(`app:start:${type.id}`)
        .setLabel(truncate(type.label, 80))
        .setStyle(ButtonStyle.Primary);
      try {
        if (type.emoji) button.setEmoji(type.emoji);
      } catch { /* إيموجي غير صالح يُتجاهل */ }

      await channel.send({
        embeds: [
          buildEmbed({
            title: truncate(type.label, 256),
            description: type.description || "اضغط الزر أدناه لبدء التقديم.",
            color: typeof style.color === "number" ? style.color : app.config.color("primary"),
            image: style.image || undefined,
            thumbnail: style.thumbnail || undefined,
            footer: interaction.guild.name,
            timestamp: false
          })
        ],
        components: [new ActionRowBuilder().addComponents(button)]
      }).catch(() => null);

      return safeUpdate(interaction, {
        embeds: [buildEmbed({
          description: `${app.config.emoji("success")} تم نشر لوحة التقديم في <#${channel.id}>`,
          color: app.config.color("success")
        })],
        components: [new ActionRowBuilder().addComponents(btn(`app:ed:open:${type.id}`, "رجوع للمحرّر", "⬅️"))]
      });
    }

    // ---------------- الحذف ----------------
    case "del": {
      return safeUpdate(interaction, {
        embeds: [buildEmbed({
          title: `${app.config.emoji("warning")} تأكيد الحذف`,
          description: `متأكد من حذف **${type.label}**؟\nالطلبات السابقة تبقى محفوظة، لكن أزرار التقديم راح تتوقف.`,
          color: app.config.color("danger")
        })],
        components: [
          new ActionRowBuilder().addComponents(
            btn(`app:ed:delyes:${type.id}`, "نعم، احذف", "🗑️", ButtonStyle.Danger),
            btn(`app:ed:open:${type.id}`, "إلغاء", "⬅️")
          )
        ]
      });
    }
    case "delyes": {
      app.applications.deleteType(interaction.guild.id, type.name);
      return safeUpdate(interaction, {
        embeds: [buildEmbed({ description: `${app.config.emoji("success")} تم حذف **${type.label}**.`, color: app.config.color("neutral") })],
        components: []
      });
    }

    default:
      return null;
  }
}

function pickerView(interaction, app, type, title, select) {
  return safeUpdate(interaction, {
    embeds: [buildEmbed({ title, color: app.config.color("primary"), timestamp: false })],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(btn(`app:ed:open:${type.id}`, "رجوع", "⬅️"))
    ]
  });
}

/** يحوّل وصف النوع المكتوب بالعربي إلى أعلام السؤال. */
function parseKind(raw) {
  const v = (raw || "").trim().toLowerCase();
  return {
    long: ["طويل", "long"].includes(v),
    numeric: ["أرقام", "ارقام", "رقم", "numeric"].includes(v),
    image: ["صورة", "صوره", "image"].includes(v)
  };
}

module.exports = { handle, view, questionsView };
