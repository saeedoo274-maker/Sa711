const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { safeReply } = require("./interactionSafe");

/**
 * أدوات واجهة موحّدة للأنظمة الجديدة:
 *  - طوابع انتهاء الصلاحية داخل customId (لا تعمل الأزرار القديمة للأبد)
 *  - أزرار التصفح بين الصفحات
 *  - صف تأكيد/إلغاء
 *  - فحص "صاحب اللوحة فقط"
 */

/** طابع زمني مختصر (ثوانٍ بصيغة base36) يوضع داخل customId. */
function stamp(now = Date.now()) {
  return Math.floor(now / 1000).toString(36);
}

function stampAge(value, now = Date.now()) {
  const seconds = parseInt(value, 36);
  if (!Number.isFinite(seconds)) return Infinity;
  return now - seconds * 1000;
}

function isExpired(value, maxAgeMs, now = Date.now()) {
  return stampAge(value, now) > maxAgeMs;
}

/** رد موحّد على زر منتهي الصلاحية. */
function replyExpired(interaction, app) {
  return safeReply(interaction, {
    content: app.i18n.tg(interaction.guild?.id, "ui.expired", { emoji: app.config.emoji("warning") }),
    flags: 64
  });
}

/** يتحقق أن الضاغط هو صاحب اللوحة. يرد برسالة خاصة ويُرجع false إن لم يكن. */
async function ensureOwner(interaction, ownerId, app) {
  if (!ownerId || interaction.user.id === ownerId) return true;
  await safeReply(interaction, {
    content: app.i18n.tg(interaction.guild?.id, "ui.notYours", { emoji: app.config.emoji("error") }),
    flags: 64
  });
  return false;
}

/**
 * أزرار صفحات: ⏮ ◀ [2/5] ▶ ⏭
 * build(page) يُرجع customId لكل صفحة.
 */
function pageRow(build, page, pages) {
  const last = Math.max(1, pages);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(build(1, "f")).setEmoji("⏮").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(build(Math.max(1, page - 1), "p")).setEmoji("◀").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(build(page, "c")).setLabel(`${page}/${last}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(build(Math.min(last, page + 1), "n")).setEmoji("▶").setStyle(ButtonStyle.Secondary).setDisabled(page >= last),
    new ButtonBuilder().setCustomId(build(last, "l")).setEmoji("⏭").setStyle(ButtonStyle.Secondary).setDisabled(page >= last)
  );
}

function confirmRow(yesId, noId, { yes = "تأكيد", no = "إلغاء", danger = true } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(yesId).setLabel(yes).setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId(noId).setLabel(no).setStyle(ButtonStyle.Secondary)
  );
}

/** يقسّم مصفوفة لصفحات ويُرجع الصفحة المطلوبة مع العدد الكلي. */
function paginate(items, page = 1, perPage = 10) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  return { page: current, pages, items: items.slice((current - 1) * perPage, current * perPage) };
}

const MEDALS = ["🥇", "🥈", "🥉"];
function medal(position) {
  return MEDALS[position - 1] || `\`#${position}\``;
}

module.exports = { stamp, stampAge, isExpired, replyExpired, ensureOwner, pageRow, confirmRow, paginate, medal };
