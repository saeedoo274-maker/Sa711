const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { buildEmbed, truncate } = require("../../core/utils/helpers");

/**
 * لوحة النجوم: الرسائل التي تتجاوز عدد نجوم معيّن تُنشر في قناة مخصصة.
 *
 * السجل يربط الرسالة الأصلية برسالة اللوحة، فيُحدَّث العدّاد بدل تكرار النشر.
 */
class StarboardService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "starboard") || {};
  }

  enabled(guildId) {
    const cfg = this.config(guildId);
    return !!cfg.enabled && !!cfg.channelId;
  }

  /** يُستدعى عند إضافة أو إزالة تفاعل. */
  async sync(reaction, guild) {
    const cfg = this.config(guild.id);
    if (!this.enabled(guild.id)) return;

    const emoji = cfg.emoji || "⭐";
    const reactionEmoji = reaction.emoji.id || reaction.emoji.name;
    if (reactionEmoji !== emoji && reaction.emoji.name !== emoji) return;

    const message = reaction.message;
    if (!message?.id) return;
    if (message.channel.id === cfg.channelId) return; // لا نُرشّح رسائل اللوحة نفسها
    if ((cfg.ignoredChannels || []).includes(message.channel.id)) return;
    if (message.author?.bot && !cfg.allowBots) return;

    // عدّ النجوم مع استبعاد نجمة صاحب الرسالة إن كان ذلك معطّلًا
    let stars = reaction.count || 0;
    if (!cfg.allowSelfStar && message.author) {
      const users = await reaction.users.fetch().catch(() => null);
      if (users?.has(message.author.id)) stars -= 1;
    }

    const threshold = cfg.threshold || 3;
    const entry = this.app.starboard.get(guild.id, message.id);

    if (stars < threshold) {
      // نزل تحت الحد: نحذف من اللوحة إن كان منشورًا
      if (entry?.board_message_id) {
        const board = await this.app.client.channels.fetch(cfg.channelId).catch(() => null);
        const boardMsg = board?.isTextBased()
          ? await board.messages.fetch(entry.board_message_id).catch(() => null)
          : null;
        if (boardMsg) await boardMsg.delete().catch(() => {});
        this.app.starboard.remove(guild.id, message.id);
      }
      return;
    }

    const board = await this.app.client.channels.fetch(cfg.channelId).catch(() => null);
    if (!board?.isTextBased()) return;

    const me = guild.members.me;
    if (!board.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) return;

    const payload = this.buildPayload(message, stars, emoji);

    if (entry?.board_message_id) {
      const boardMsg = await board.messages.fetch(entry.board_message_id).catch(() => null);
      if (boardMsg) {
        await boardMsg.edit(payload).catch(() => {});
        this.app.starboard.upsert({
          guildId: guild.id, messageId: message.id, channelId: message.channel.id,
          authorId: message.author?.id, stars, boardMessageId: entry.board_message_id
        });
        return;
      }
    }

    const sent = await board.send(payload).catch(() => null);
    this.app.starboard.upsert({
      guildId: guild.id,
      messageId: message.id,
      channelId: message.channel.id,
      authorId: message.author?.id,
      stars,
      boardMessageId: sent?.id || null
    });
  }

  buildPayload(message, stars, emoji) {
    const image = message.attachments?.find((a) => /^image\//i.test(a.contentType || ""));

    const embed = buildEmbed({
      description: truncate(message.content || "*(بلا نص)*", 3000),
      color: this.app.config.color("warning"),
      image: image?.url,
      footer: `${message.id}`
    });
    embed.setAuthor({
      name: message.author?.tag || "عضو",
      iconURL: message.author?.displayAvatarURL?.()
    });

    return {
      content: `${emoji} **${stars}** — <#${message.channel.id}>`,
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("الذهاب للرسالة").setStyle(ButtonStyle.Link).setURL(message.url)
        )
      ],
      allowedMentions: { parse: [] }
    };
  }
}

module.exports = StarboardService;
