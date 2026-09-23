const { Events } = require("../events/EventBus");
const { buildEmbed, formatDuration, truncate } = require("../utils/helpers");

const TYPE_LABELS = {
  ban: "حظر",
  unban: "فك حظر",
  kick: "طرد",
  timeout: "إسكات",
  untimeout: "فك إسكات",
  warn: "تحذير"
};

/**
 * نظام السجلات.
 * يستمع لأحداث EventBus بدل أن يُستدعى من داخل كل نظام،
 * فيبقى كل نظام مستقلًا ولا يعرف بوجود السجلات أصلًا.
 */
class LogService {
  constructor(app) {
    this.app = app;
  }

  register() {
    const moderationEvents = [
      Events.MEMBER_BANNED,
      Events.MEMBER_UNBANNED,
      Events.MEMBER_KICKED,
      Events.MEMBER_TIMEOUT,
      Events.MEMBER_UNTIMEOUT,
      Events.MEMBER_WARNED
    ];
    for (const event of moderationEvents) {
      this.app.bus.on(event, (payload) => this.logModeration(payload));
    }

    this.app.bus.on(Events.WARN_REMOVED, (p) => this.logSimple("moderation", "حذف تحذير", p));
    this.app.bus.on(Events.MESSAGES_CLEARED, (p) => this.logSimple("messages", "حذف رسائل", p));
    this.app.bus.on(Events.CHANNEL_LOCKED, (p) => this.logSimple("channels", "قفل قناة", p));
    this.app.bus.on(Events.CHANNEL_UNLOCKED, (p) => this.logSimple("channels", "فتح قناة", p));
    this.app.bus.on(Events.SLOWMODE_SET, (p) => this.logSimple("channels", "وضع بطيء", p));
    this.app.bus.on(Events.ROLE_ADDED, (p) => this.logSimple("roles", "إضافة رتبة", p));
    this.app.bus.on(Events.ROLE_REMOVED, (p) => this.logSimple("roles", "إزالة رتبة", p));
    this.app.bus.on(Events.NICKNAME_CHANGED, (p) => this.logSimple("members", "تغيير اسم", p));
    this.app.bus.on(Events.VOICE_ACTION, (p) => this.logSimple("voice", p.action || "إجراء صوتي", p));
  }

  async _channel(guildId, logType) {
    const channelId = this.app.guildConfig.value(guildId, `logs.${logType}`);
    if (!channelId) return null;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;
    return channel;
  }

  async logModeration({ guild, case: record }) {
    const channel = await this._channel(guild.id, "moderation");
    if (!channel) return;

    const fields = [
      { name: this.app.i18n.t("common.caseNumber"), value: `#${record.case_number}`, inline: true },
      { name: this.app.i18n.t("common.target"), value: `<@${record.target_id}>\n\`${record.target_tag || record.target_id}\``, inline: true },
      { name: this.app.i18n.t("common.moderator"), value: `<@${record.moderator_id}>`, inline: true },
      { name: this.app.i18n.t("common.reason"), value: truncate(record.reason || this.app.i18n.t("common.noReason")) }
    ];
    if (record.duration_ms) {
      fields.push({ name: this.app.i18n.t("common.duration"), value: formatDuration(record.duration_ms), inline: true });
    }

    const embed = buildEmbed({
      title: `${this.app.config.emoji("shield")} ${TYPE_LABELS[record.type] || record.type}`,
      color: this.app.config.color(record.type === "unban" || record.type === "untimeout" ? "success" : "danger"),
      fields,
      footer: `${this.app.i18n.t("logs.moderationTitle")} • #${record.case_number}`
    });

    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  async logSimple(logType, title, payload = {}) {
    const guild = payload.guild;
    if (!guild) return;
    const channel = await this._channel(guild.id, logType);
    if (!channel) return;

    const fields = [];
    if (payload.executor) fields.push({ name: this.app.i18n.t("common.moderator"), value: `<@${payload.executor.id}>`, inline: true });
    if (payload.target) fields.push({ name: this.app.i18n.t("common.target"), value: `<@${payload.target.id}>`, inline: true });
    if (payload.channel) fields.push({ name: "القناة", value: `<#${payload.channel.id}>`, inline: true });
    if (payload.role) fields.push({ name: "الرتبة", value: `<@&${payload.role.id}>`, inline: true });
    if (payload.details) fields.push({ name: "التفاصيل", value: truncate(payload.details) });
    if (payload.reason) fields.push({ name: this.app.i18n.t("common.reason"), value: truncate(payload.reason) });

    const embed = buildEmbed({
      title: `${this.app.config.emoji("logs")} ${title}`,
      color: this.app.config.color("info"),
      fields
    });
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

module.exports = LogService;
