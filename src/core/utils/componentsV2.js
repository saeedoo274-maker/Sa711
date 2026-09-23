/**
 * أدوات Components v2 — واجهة ديسكورد الحديثة البديلة عن EmbedBuilder التقليدي.
 * تسمح بدمج نصوص وصور وفواصل وأزرار داخل حاوية واحدة متكاملة التنسيق،
 * بخلاف الإمبيد الذي يفصل العنوان والوصف والصورة كل بحقل منفصل.
 *
 * الاستخدام محدود عمدًا لأماكن تفيد فيها فعلاً (رسائل ترحيبية، فواتير، لوحات تعريفية) —
 * الإمبيد العادي (buildEmbed في helpers.js) يبقى الافتراضي لبقية البوت لأنه أبسط وأخف.
 *
 * ملاحظة: رسالة تستخدم Components v2 يجب أن تحمل `flags: MessageFlags.IsComponentsV2`،
 * ولا يمكن مزجها مع `embeds` أو `content` في نفس الرسالة — كل المحتوى يمر عبر الحاوية.
 */
const {
  ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder,
  ActionRowBuilder, MessageFlags
} = require("discord.js");
const { truncate } = require("./common");

/**
 * يبني حاوية Components v2 من وصف مبسّط، فيتولى الأمور التالية تلقائيًا:
 * - قص النصوص لحدود ديسكورد
 * - إضافة فواصل بين الأقسام تلقائيًا
 * - تحويل روابط الصور إلى معرض وسائط
 *
 * @param {object} opts
 * @param {string} [opts.text] نص أساسي (يدعم **تنسيق ماركداون**)
 * @param {string} [opts.color] لون الشريط الجانبي (hex كرقم، مثل 0x5865F2)
 * @param {string[]} [opts.images] روابط صور تُعرض كمعرض وسائط
 * @param {import("discord.js").ActionRowBuilder[]} [opts.rows] صفوف أزرار أو قوائم
 * @param {boolean} [opts.divide=true] إظهار فواصل بين الأقسام
 */
function buildContainer({ text, color, images = [], rows = [], divide = true }) {
  const container = new ContainerBuilder();
  if (color !== undefined) container.setAccentColor(color);

  const addDivider = () => {
    if (divide) container.addSeparatorComponents((sep) => sep.setDivider(true).setSpacing(1));
  };

  if (text) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(text, 4000)));
    addDivider();
  }

  if (images.length) {
    const gallery = new MediaGalleryBuilder().addItems(
      images.slice(0, 10).map((url) => ({ media: { url } }))
    );
    container.addMediaGalleryComponents(gallery);
    addDivider();
  }

  for (const row of rows) {
    container.addActionRowComponents(row);
    addDivider();
  }

  return container;
}

/**
 * يبني حمولة رسالة كاملة جاهزة للإرسال بـ Components v2.
 * @returns {{flags: number, components: import("discord.js").ContainerBuilder[]}}
 */
function containerPayload(opts) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [buildContainer(opts)]
  };
}

module.exports = { buildContainer, containerPayload };
