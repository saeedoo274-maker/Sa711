const WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,25}\/[\w-]{20,200}$/;

/**
 * مركز الإشعارات الموحّد.
 *
 * بدل أن يكتب كل نظام منطق الإرسال للخاص/القناة/الطاقم بنفسه، يستدعي:
 *   app.notifications.notify({ guildId, userId, category, payload, targets: ["dm", "channel"] ... })
 *
 * الأهداف:
 *  - dm       : خاص العضو (يحترم تفضيله لكل فئة — يمكنه إيقاف فئة كاملة)
 *  - channel  : قناة محددة `channelId`
 *  - staff    : قناة إشعارات الطاقم `notifications.staffChannelId`
 *  - admin    : قناة إشعارات الإدارة العليا `notifications.adminChannelId`
 *  - webhook  : رابط Webhook ديسكورد فقط (يُرفض أي رابط آخر لمنع استخدامه لطلبات خارجية)
 *
 * `mention` يضيف منشن العضو أو رتبة للإشعار في القنوات.
 * الإرسال لا يرمي أبدًا — يرجع ملخصًا بما نجح وما فشل.
 */
class NotificationService {
  constructor(app) {
    this.app = app;
    this.repo = app.platform;
    /** فئات معروفة تظهر في قائمة التفضيلات. الأنظمة تسجّل فئاتها عند التحميل. */
    this.categories = new Map();
  }

  registerCategory(key, label) {
    this.categories.set(key, label || key);
  }

  /** هل يقبل العضو إشعارات الخاص لهذه الفئة؟ الافتراضي: نعم. */
  allowsDm(guildId, userId, category) {
    if (!guildId || !category) return true;
    const pref = this.repo.notificationPref(guildId, userId, category);
    return pref === null ? true : pref;
  }

  setPreference(guildId, userId, category, dm) {
    this.repo.setNotificationPref(guildId, userId, category, dm);
  }

  preferences(guildId, userId) {
    const saved = new Map(this.repo.notificationPrefs(guildId, userId).map((r) => [r.category, !!r.dm]));
    return [...this.categories.entries()].map(([key, label]) => ({ key, label, dm: saved.has(key) ? saved.get(key) : true }));
  }

  async notify({ guildId = null, userId = null, category = "general", payload, targets = ["dm"], channelId = null, webhookUrl = null, mention = null, force = false }) {
    const body = typeof payload === "string" ? { content: payload } : { ...payload };
    const report = { sent: [], failed: [], skipped: [] };

    for (const target of targets) {
      try {
        if (target === "dm") {
          if (!userId) { report.skipped.push("dm:noUser"); continue; }
          if (!force && !this.allowsDm(guildId, userId, category)) { report.skipped.push("dm:optOut"); continue; }
          const user = await this.app.client.users.fetch(userId);
          await user.send(body);
          report.sent.push("dm");
          continue;
        }

        if (target === "webhook") {
          if (!webhookUrl || !WEBHOOK_RE.test(webhookUrl)) { report.skipped.push("webhook:invalid"); continue; }
          await this._postWebhook(webhookUrl, body);
          report.sent.push("webhook");
          continue;
        }

        const resolvedChannel =
          target === "channel" ? channelId
          : target === "staff" ? this.app.guildConfig.value(guildId, "notifications.staffChannelId")
          : target === "admin" ? this.app.guildConfig.value(guildId, "notifications.adminChannelId")
          : null;
        if (!resolvedChannel) { report.skipped.push(`${target}:noChannel`); continue; }

        const channel = await this.app.client.channels.fetch(resolvedChannel);
        if (!channel?.isTextBased()) { report.failed.push(`${target}:notText`); continue; }
        const prefix = mention ? `${mention} ` : "";
        const channelBody = prefix ? { ...body, content: `${prefix}${body.content || ""}`.trim() } : body;
        await channel.send({ ...channelBody, allowedMentions: { parse: [], users: userId ? [userId] : [], roles: mention?.startsWith("<@&") ? [mention.slice(3, -1)] : [] } });
        report.sent.push(target);
      } catch (error) {
        // DM مغلق أو قناة محذوفة حالة متوقعة؛ تُسجَّل بمستوى تحذير لا خطأ
        report.failed.push(`${target}:${error.code || error.message}`);
        this.app.logger.debug?.(`إشعار ${category} → ${target} فشل: ${error.message}`);
      }
    }
    return report;
  }

  async _postWebhook(url, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: body.content || undefined,
          embeds: (body.embeds || []).map((e) => (typeof e.toJSON === "function" ? e.toJSON() : e)),
          allowed_mentions: { parse: [] }
        }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`webhook ${res.status}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  static isDiscordWebhook(url) {
    return WEBHOOK_RE.test(url || "");
  }
}

module.exports = NotificationService;
