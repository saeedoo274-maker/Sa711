/**
 * نشر لوحة فتح التذاكر في قناة — كان داخل أمر `/لوحة_تذاكر`،
 * ونُقل هنا لتستدعيه لوحة التحكم المركزية بعد دمج الأمر فيها.
 */
const crypto = require("crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildEmbed } = require("../../core/utils/helpers");

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const URL_RE = /^https:\/\/\S+$/i;

/** يطبّع مدخلات المستخدم ويعيد إعداد اللوحة أو { error }. */
function normalize(app, input = {}) {
  let color = app.config.color("primary");
  if (input.color) {
    if (!HEX_RE.test(input.color)) return { error: "اللون يجب أن يكون بصيغة #RRGGBB." };
    color = parseInt(input.color.replace("#", ""), 16);
  }
  for (const key of ["banner", "thumbnail"]) {
    if (input[key] && !URL_RE.test(input[key])) return { error: "روابط الصور يجب أن تبدأ بـ https://" };
  }
  return {
    config: {
      title: (input.title || "🎫 نظام التذاكر").slice(0, 256),
      description: (input.description || "اضغط الزر أدناه لفتح تذكرة والتواصل مع الإدارة.").slice(0, 4000),
      buttonLabel: (input.buttonLabel || "فتح تذكرة").slice(0, 80),
      buttonEmoji: input.buttonEmoji === undefined ? "🎫" : input.buttonEmoji || null,
      color,
      banner: input.banner || null,
      thumbnail: input.thumbnail || null,
      categoryId: input.categoryId || null
    }
  };
}

async function publishTicketPanel(app, guild, channel, input) {
  const { config, error } = normalize(app, input);
  if (error) return { ok: false, error };

  const panelId = crypto.randomBytes(6).toString("hex");
  const embed = buildEmbed({
    title: config.title,
    description: config.description,
    color: config.color,
    image: config.banner || undefined,
    thumbnail: config.thumbnail || undefined,
    footer: guild.name,
    timestamp: false
  });
  const button = new ButtonBuilder().setCustomId(`ticket:open:${panelId}`).setLabel(config.buttonLabel).setStyle(ButtonStyle.Primary);
  try {
    if (config.buttonEmoji) button.setEmoji(config.buttonEmoji);
  } catch { /* إيموجي غير صالح يُتجاهل بدل إسقاط النشر */ }

  const message = await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] }).catch(() => null);
  if (!message) return { ok: false, error: "تعذّر نشر اللوحة." };
  app.tickets.savePanel({ id: panelId, guildId: guild.id, channelId: channel.id, messageId: message.id, config });
  return { ok: true, id: panelId, message };
}

module.exports = { publishTicketPanel, normalize };
