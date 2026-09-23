const { buildEmbed } = require("../../core/utils/helpers");

/**
 * حماية البوت والاستضافة من الإساءة.
 *
 * هذه هي الطبقة التي تحمي البوت فعليًا من السيرفرات المسيئة:
 * إغراق الأوامر يستهلك موارد الاستضافة ويعرّضها للإيقاف، فنوقفه عند المصدر.
 *
 * التصعيد تلقائي وتدريجي:
 *   تجاوز الحد → تبريد مؤقت للسيرفر
 *   تكرار التجاوز → قائمة سوداء ومغادرة السيرفر
 *
 * كل شيء يحدث **داخل حدود البوت نفسه** — نمنعه من الاستجابة ونغادر،
 * ولا نتخذ أي إجراء عقابي ضد أعضاء السيرفر.
 */
class AbuseGuard {
  constructor(app) {
    this.app = app;
    this.guildWindow = new Map(); // guildId -> [timestamps]
    this.userWindow = new Map(); // `${guildId}:${userId}` -> [timestamps]
    this.cooldowns = new Map(); // guildId -> until
    this.strikes = new Map(); // guildId -> count

    this.limits = {
      guildPerMinute: parseInt(process.env.ABUSE_GUILD_PER_MIN || "80", 10),
      userPerMinute: parseInt(process.env.ABUSE_USER_PER_MIN || "25", 10),
      cooldownMs: parseInt(process.env.ABUSE_COOLDOWN_MS || "300000", 10),
      strikesBeforeBlacklist: parseInt(process.env.ABUSE_STRIKES || "3", 10),
      autoLeave: process.env.ABUSE_AUTO_LEAVE !== "false"
    };

    // تنظيف دوري حتى لا تتضخم الذاكرة على البوتات الكبيرة
    this.timer = setInterval(() => this.sweep(), 120_000);
    if (this.timer.unref) this.timer.unref();
  }

  sweep() {
    const cutoff = Date.now() - 120_000;
    for (const [key, list] of this.guildWindow) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length) this.guildWindow.set(key, kept);
      else this.guildWindow.delete(key);
    }
    for (const [key, list] of this.userWindow) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length) this.userWindow.set(key, kept);
      else this.userWindow.delete(key);
    }
    for (const [key, until] of this.cooldowns) {
      if (until < Date.now()) this.cooldowns.delete(key);
    }
  }

  _hit(map, key, windowMs = 60_000) {
    const now = Date.now();
    const list = (map.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    map.set(key, list);
    return list.length;
  }

  /**
   * يُستدعى قبل تنفيذ أي أمر.
   * @returns {{allowed:boolean, reason?:string, silent?:boolean}}
   */
  check(guild, userId) {
    if (!guild) return { allowed: true };

    // السيرفرات المحظورة لا تُخدَم إطلاقًا
    if (this.app.oversight.isBlacklisted(guild.id)) {
      return { allowed: false, reason: "blacklisted", silent: true };
    }

    const cooling = this.cooldowns.get(guild.id);
    if (cooling && cooling > Date.now()) {
      return { allowed: false, reason: "cooldown", silent: true };
    }

    // المطورون معفيّون حتى لا يُقفل عليهم البوت أثناء الصيانة
    if (this.app.config.isDeveloper(userId)) return { allowed: true };

    const userCount = this._hit(this.userWindow, `${guild.id}:${userId}`);
    if (userCount > this.limits.userPerMinute) {
      this.app.oversight.recordAbuse({
        guildId: guild.id,
        userId,
        kind: "userFlood",
        detail: `${userCount} أمر في دقيقة`
      });
      return { allowed: false, reason: "userFlood" };
    }

    const guildCount = this._hit(this.guildWindow, guild.id);
    if (guildCount > this.limits.guildPerMinute) {
      this.escalate(guild, `${guildCount} أمر في دقيقة من السيرفر`).catch(() => {});
      return { allowed: false, reason: "guildFlood", silent: true };
    }

    return { allowed: true };
  }

  /** التصعيد: تبريد أولًا، ثم قائمة سوداء ومغادرة عند التكرار. */
  async escalate(guild, detail) {
    this.app.oversight.recordAbuse({ guildId: guild.id, kind: "guildFlood", detail });

    const strikes = (this.strikes.get(guild.id) || 0) + 1;
    this.strikes.set(guild.id, strikes);
    this.cooldowns.set(guild.id, Date.now() + this.limits.cooldownMs);

    this.app.logger.warn(`إساءة من سيرفر ${guild.name} (${guild.id}) — إنذار ${strikes}: ${detail}`);

    if (strikes < this.limits.strikesBeforeBlacklist) {
      await this.notifyDevelopers(guild, `⚠️ تبريد مؤقت — الإنذار ${strikes}/${this.limits.strikesBeforeBlacklist}`, detail);
      return;
    }

    // بلغ الحد: قائمة سوداء ومغادرة
    this.app.oversight.blacklist(guild.id, {
      reason: `إغراق أوامر متكرر: ${detail}`,
      by: "النظام التلقائي"
    });
    await this.notifyDevelopers(guild, "🚫 حُظر السيرفر تلقائيًا", detail);

    if (this.limits.autoLeave) {
      await guild.leave().catch(() => {});
      this.app.logger.warn(`غادر البوت السيرفر ${guild.id} بسبب الإساءة المتكررة.`);
    }
  }

  /** يبلّغ المطورين في الخاص — لا يعتمد على قناة قد تكون في السيرفر المسيء. */
  async notifyDevelopers(guild, title, detail) {
    const embed = buildEmbed({
      title: `🛡️ ${title}`,
      color: this.app.config.color("danger"),
      fields: [
        { name: "السيرفر", value: `${guild.name}\n\`${guild.id}\`` },
        { name: "الأعضاء", value: `\`${guild.memberCount}\``, inline: true },
        { name: "المالك", value: `<@${guild.ownerId}>`, inline: true },
        { name: "التفاصيل", value: String(detail).slice(0, 500) }
      ]
    });

    for (const devId of this.app.config.developerIds) {
      const user = await this.app.client.users.fetch(devId).catch(() => null);
      await user?.send({ embeds: [embed] }).catch(() => {});
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = AbuseGuard;
