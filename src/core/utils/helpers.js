const { EmbedBuilder } = require("discord.js");
const common = require("./common");

/** يبني إمبيد مع احترام كل حدود ديسكورد تلقائيًا. */
function buildEmbed({ title, description, color, fields, footer, thumbnail, image, author, url, timestamp: ts = true }) {
  const embed = new EmbedBuilder();
  if (title) embed.setTitle(String(title).slice(0, 256));
  if (url && /^https?:\/\/\S+$/i.test(url)) embed.setURL(url);
  if (description) embed.setDescription(String(description).slice(0, 4000));
  if (color !== undefined) embed.setColor(color);
  if (fields?.length) {
    embed.addFields(
      fields.slice(0, 25).map((f) => ({
        name: common.truncate(f.name, 256),
        value: common.truncate(f.value ?? "—", 1024),
        inline: !!f.inline
      }))
    );
  }
  if (footer) embed.setFooter(typeof footer === "string" ? { text: common.truncate(footer, 2048) } : footer);
  // رأس الإمبيد: يُستخدم لاسم السيرفر وشعاره فوق العنوان
  if (author) {
    embed.setAuthor(
      typeof author === "string"
        ? { name: common.truncate(author, 256) }
        : { ...author, name: common.truncate(author.name ?? "", 256) }
    );
  }
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (ts) embed.setTimestamp();
  return embed;
}

// يُعاد تصدير الدوال النقية حتى تستورد الوحدات من مكان واحد
module.exports = { ...common, buildEmbed };
