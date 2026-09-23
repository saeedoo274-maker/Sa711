const { buildEmbed, timestamp } = require("../../core/utils/helpers");

/**
 * بث سجل الإصدارات لكل السيرفرات المشتركة.
 * التحقق من "آخر إصدار أُرسل" يمنع الإرسال المكرر عند إعادة تشغيل البوت.
 */
class ChangelogService {
  constructor(app) {
    this.app = app;
  }

  publish({ version, title, body, publishedBy }) {
    return this.app.changelogs.publish({ version, title, body, publishedBy });
  }

  embed(entry) {
    return buildEmbed({
      title: `🆕 تحديث جديد — v${entry.version}`,
      description: `**${entry.title}**\n\n${entry.body}`,
      color: this.app.config.color("primary"),
      footer: `أُصدر ${timestamp(entry.created_at, "R")}`
    });
  }

  /** يبث آخر إصدار لكل سيرفر مشترك لم يستلمه بعد. */
  async broadcast() {
    const latest = this.app.changelogs.latest();
    if (!latest) return { sent: 0 };

    const targets = this.app.changelogs.pendingBroadcasts(latest.id);
    let sent = 0;

    for (const target of targets) {
      const channel = await this.app.client.channels.fetch(target.channel_id).catch(() => null);
      if (channel?.isTextBased()) {
        const ok = await channel.send({ embeds: [this.embed(latest)] }).then(() => true).catch(() => false);
        if (ok) sent++;
      }
      // نُسجّل الاستلام حتى لو فشل الإرسال، فلا نُغرق قناة معطوبة بمحاولات متكررة
      this.app.changelogs.markSent(target.guild_id, latest.id);
    }

    return { sent, total: targets.length, version: latest.version };
  }
}

module.exports = ChangelogService;
