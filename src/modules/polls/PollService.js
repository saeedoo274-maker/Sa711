const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildEmbed, timestamp } = require("../../core/utils/helpers");

const EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

class PollService {
  constructor(app) {
    this.app = app;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), 15000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    for (const poll of this.app.polls.listDue()) {
      await this.close(poll.id).catch((err) => this.app.errors.capture(err, { system: "polls", guildId: poll.guild_id }));
    }
  }

  bar(percent) {
    const filled = Math.round(percent / 10);
    return "█".repeat(filled) + "░".repeat(10 - filled);
  }

  buildEmbed(poll, { closed = false } = {}) {
    const results = this.app.polls.results(poll.id);
    const total = Object.values(results).reduce((a, b) => a + b, 0);

    const lines = poll.options.map((option, index) => {
      const votes = results[index] || 0;
      const percent = total ? Math.round((votes / total) * 100) : 0;
      // النتائج تُخفى أثناء التصويت في الاستطلاع المجهول لتفادي التأثير على الناخبين
      const detail = closed || !poll.anonymous ? ` \`${votes}\` (${percent}%)\n${this.bar(percent)}` : "";
      return `${EMOJIS[index]} **${option}**${detail}`;
    });

    const fields = [{ name: "إجمالي المصوّتين", value: `\`${this.app.polls.totalVoters(poll.id)}\``, inline: true }];
    if (poll.ends_at) {
      fields.push({ name: closed ? "أُغلق" : "يُغلق", value: timestamp(poll.ends_at, "R"), inline: true });
    }
    fields.push({ name: "النوع", value: poll.multiple ? "اختيار متعدد" : "اختيار واحد", inline: true });

    return buildEmbed({
      title: `📊 ${poll.question}`,
      description: lines.join("\n\n") + (closed ? "\n\n**انتهى التصويت**" : ""),
      color: this.app.config.color(closed ? "neutral" : "primary"),
      fields,
      footer: `استطلاع #${poll.id} • بواسطة`
    });
  }

  buttons(poll, closed = false) {
    if (closed) return [];
    const buttons = poll.options.map((option, index) =>
      new ButtonBuilder()
        .setCustomId(`poll:vote:${poll.id}:${index}`)
        .setLabel(String(index + 1))
        .setEmoji(EMOJIS[index])
        .setStyle(ButtonStyle.Secondary)
    );
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`poll:results:${poll.id}`).setLabel("نتيجتي الحالية").setEmoji("👁️").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`poll:close:${poll.id}`).setLabel("إغلاق التصويت").setEmoji("🔒").setStyle(ButtonStyle.Danger)
      )
    );
    return rows;
  }

  async close(pollId) {
    const poll = this.app.polls.getById(pollId);
    if (!poll) return { ok: false };
    if (!this.app.polls.close(pollId)) return { ok: false, reason: "alreadyClosed" };

    const fresh = this.app.polls.getById(pollId);
    const channel = await this.app.client.channels.fetch(poll.channel_id).catch(() => null);
    if (channel?.isTextBased() && poll.message_id) {
      const message = await channel.messages.fetch(poll.message_id).catch(() => null);
      if (message) await message.edit({ embeds: [this.buildEmbed(fresh, { closed: true })], components: [] }).catch(() => {});
    }
    this.app.bus.emitSafe("poll:closed", { poll: fresh });
    return { ok: true };
  }
}

module.exports = PollService;
module.exports.EMOJIS = EMOJIS;
