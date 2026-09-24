const {
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  StringSelectMenuBuilder
} = require("discord.js");
const { buildEmbed, parseAmount, truncate } = require("../../core/utils/helpers");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * مركز الخدمات: قائمة واحدة تفتح للأعضاء تقييم الخدمة، أو رفع اقتراح، أو حاسبة الضريبة.
 * كل هذا بدون فتح ثلاثة أوامر منفصلة — نمط UX واحد لثلاث وظائف خفيفة الاستخدام.
 *
 * الحاسبة تستخدم منطق الاقتصاد الحقيقي (EconomyService.calculateTax)، لا صيغة منفصلة،
 * فتبقى نتيجة واحدة متسقة سواء استُدعيت من هنا أو من `/bank tax`.
 */

const MENU_OPTIONS = [
  { label: "تقييم الخدمة", description: "شارك رأيك في مستوى الخدمة المقدّمة", value: "rating", emoji: "⭐" },
  { label: "تقديم اقتراح", description: "اقترح تحسينًا أو فكرة جديدة", value: "suggestion", emoji: "💡" },
  { label: "حاسبة الضريبة", description: "احسب المبلغ الإجمالي شامل الضريبة", value: "tax", emoji: "🧮" }
];

function servicesMenuRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("services:menu")
    .setPlaceholder("اختر خدمة من القائمة")
    .addOptions(MENU_OPTIONS);
  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  prefix: "services",
  servicesMenuRow,

  async handle(interaction, app) {
    const [, action] = interaction.customId.split(":");

    if (action === "menu") return openModal(interaction, app, interaction.values[0]);
    if (action === "rating") return submitRating(interaction, app);
    if (action === "suggestion") return submitSuggestion(interaction, app);
    if (action === "tax") return submitTax(interaction, app);
    return null;
  }
};

async function openModal(interaction, app, choice) {
  if (choice === "rating") {
    const modal = new ModalBuilder().setCustomId("services:rating").setTitle("تقييم الخدمة");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("text").setLabel("تقييمك").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
      )
    );
    return safeModal(interaction, modal);
  }

  if (choice === "suggestion") {
    const modal = new ModalBuilder().setCustomId("services:suggestion").setTitle("تقديم اقتراح");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("text").setLabel("اقتراحك").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
      )
    );
    return safeModal(interaction, modal);
  }

  if (choice === "tax") {
    const modal = new ModalBuilder().setCustomId("services:tax").setTitle("حاسبة الضريبة");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("المبلغ الصافي")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("مثال: 10k أو 1.5m أو 5000")
          .setRequired(true)
          .setMaxLength(20)
      )
    );
    return safeModal(interaction, modal);
  }
  return null;
}

async function submitRating(interaction, app) {
  const text = interaction.fields.getTextInputValue("text");
  const delivered = await deliver(interaction, app, {
    configKey: "logs.ratings",
    title: "⭐ تقييم جديد",
    text,
    color: "success"
  });

  // لا نقول "تم الإرسال" إن لم يصل لأحد فعلًا — وإلا ضاع رأي العضو بصمت
  return safeReply(interaction, {
    content: delivered
      ? `${app.config.emoji("success")} تم إرسال تقييمك بنجاح، شكرًا لك.`
      : `${app.config.emoji("warning")} تعذّر تسليم تقييمك — قناة التقييمات غير مضبوطة في هذا السيرفر.\nأبلغ الإدارة لضبطها من \`/لوحة\` ← السجلات.`,
    flags: 64
  });
}

async function submitSuggestion(interaction, app) {
  const text = interaction.fields.getTextInputValue("text");

  // نظام الاقتراحات الكامل (تصويت وحالات) إن كان مضبوطًا — وإلا السلوك القديم كما هو
  if (app.suggestions?.isReady(interaction.guild.id)) {
    const res = await app.suggestions.create(interaction.member, text, { channelId: null });
    const t = app.i18n.forGuild(interaction.guild.id);
    return safeReply(interaction, {
      content: res.ok
        ? `${app.config.emoji("success")} ${t("suggest.created", { number: res.suggestion.number, url: res.url })}`
        : `${app.config.emoji("error")} ${t(`suggest.err.${res.reason}`, { seconds: res.seconds, min: res.min, roles: (res.roles || []).map((r) => `<@&${r}>`).join(" ") })}`,
      flags: 64
    });
  }

  const delivered = await deliver(interaction, app, {
    configKey: "logs.suggestions",
    title: "💡 اقتراح جديد",
    text,
    color: "info"
  });

  return safeReply(interaction, {
    content: delivered
      ? `${app.config.emoji("success")} تم إرسال اقتراحك بنجاح، شكرًا لك.`
      : `${app.config.emoji("warning")} تعذّر تسليم اقتراحك — قناة الاقتراحات غير مضبوطة في هذا السيرفر.\nأبلغ الإدارة لضبطها من \`/لوحة\` ← السجلات.`,
    flags: 64
  });
}

/**
 * ينشر مساهمة العضو في القناة المخصصة.
 * يُرجع true فقط عند وصولها فعلًا — فلا نَعِد العضو بنجاح وهمي.
 */
async function deliver(interaction, app, { configKey, title, text, color }) {
  const channelId = app.guildConfig.value(interaction.guild.id, configKey);
  if (!channelId) return false;

  const channel = await app.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const sent = await channel
    .send({
      embeds: [
        buildEmbed({
          title,
          description: `**من:** <@${interaction.user.id}>\n\n${truncate(text, 3500)}`,
          color: app.config.color(color)
        })
      ],
      allowedMentions: { parse: [] }
    })
    .catch(() => null);

  return !!sent;
}

async function submitTax(interaction, app) {
  const raw = interaction.fields.getTextInputValue("amount");
  const net = parseAmount(raw);

  if (net === null || net <= 0) {
    return safeReply(interaction, {
      content: `${app.config.emoji("error")} أدخل مبلغًا صالحًا، مثل \`10000\` أو \`10k\` أو \`1.5m\`.`,
      flags: 64
    });
  }

  const result = app.economyService.calculateTax(interaction.guild.id, net);
  if (!result.ok) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} نسبة الضريبة المضبوطة للسيرفر غير صالحة.`, flags: 64 });
  }

  return safeReply(interaction, {
    embeds: [
      buildEmbed({
        title: "🧮 نتيجة حساب الضريبة",
        color: app.config.color("primary"),
        fields: [
          { name: "المبلغ الصافي", value: app.economyService.format(interaction.guild.id, net), inline: true },
          { name: "نسبة الضريبة", value: `${result.percent}%`, inline: true },
          { name: "الإجمالي المطلوب", value: `**${app.economyService.format(interaction.guild.id, result.gross)}**` }
        ]
      })
    ],
    flags: 64
  });
}
