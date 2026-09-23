const { truncate } = require("../../core/utils/common");

/**
 * الردود التلقائية على الكلمات المفتاحية.
 *
 * تُقرأ مرة واحدة لكل سيرفر وتُخزَّن مؤقتًا، فلا يوجد استعلام قاعدة بيانات
 * على كل رسالة تُكتب — وهذا حرج لأن هذا الكود يعمل على **كل** رسالة في السيرفر.
 */
class AutoReplyService {
  constructor(app) {
    this.app = app;
    this.cache = new Map(); // guildId -> { rules, expiresAt }
    this.cooldowns = new Map(); // `${ruleId}:${scope}` -> timestamp
    this.ttlMs = 300_000;
  }

  invalidate(guildId) {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
  }

  rules(guildId) {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.rules;

    const rules = this.app.autoReplies.listEnabled(guildId);
    this.cache.set(guildId, { rules, expiresAt: Date.now() + this.ttlMs });
    return rules;
  }

  /** يوحّد النص للمطابقة: حروف صغيرة، بلا تشكيل، وتوحيد الألف والياء والتاء المربوطة. */
  static normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0670]/g, "")
      .replace(/[إأآا]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** يطابق نص الرسالة مع محفّزات القاعدة حسب نوع المطابقة. */
  matches(rule, content) {
    const text = AutoReplyService.normalize(content);
    if (!text) return false;

    for (const raw of rule.triggers) {
      const trigger = AutoReplyService.normalize(raw);
      if (!trigger) continue;

      switch (rule.match_type) {
        case "exact":
          if (text === trigger) return true;
          break;
        case "starts":
          if (text.startsWith(trigger)) return true;
          break;
        case "word": {
          // كلمة مستقلة: تتجنب مطابقة "سلام" داخل "استسلام"
          const parts = text.split(/[\s.,!؟?،:؛"'()\[\]]+/).filter(Boolean);
          if (parts.includes(trigger)) return true;
          break;
        }
        default:
          if (text.includes(trigger)) return true;
      }
    }
    return false;
  }

  /** يتحقق من شروط القناة والرتب والفرصة والتبريد. */
  allowed(rule, message) {
    if (rule.channels.length && !rule.channels.includes(message.channel.id)) return false;
    if (rule.ignored_channels.includes(message.channel.id)) return false;

    if (rule.role_ids.length) {
      const has = rule.role_ids.some((id) => message.member?.roles.cache.has(id));
      if (!has) return false;
    }

    if (rule.chance < 100 && Math.random() * 100 >= rule.chance) return false;

    if (rule.cooldown_ms) {
      // التبريد لكل عضو على حدة حتى لا يعطّل عضو واحد الرد على الجميع
      const key = `${rule.id}:${message.author.id}`;
      const last = this.cooldowns.get(key) || 0;
      if (Date.now() - last < rule.cooldown_ms) return false;
      this.cooldowns.set(key, Date.now());
      if (this.cooldowns.size > 10_000) this.cooldowns.clear();
    }

    return true;
  }

  /**
   * يبحث عن أول قاعدة مطابقة ويرد بها.
   * @returns {Promise<boolean>} true إذا رُدّ على الرسالة
   */
  async handle(message) {
    const rules = this.rules(message.guild.id);
    if (!rules.length) return false;

    const rule = rules.find((r) => this.matches(r, message.content) && this.allowed(r, message));
    if (!rule) return false;

    const vars = { member: message.member, guild: message.guild };
    let payload;

    if (rule.embed_id) {
      const record = this.app.embeds.get(rule.embed_id);
      if (!record) return false; // الإمبيد محذوف — نتجاهل بصمت بدل إزعاج الأعضاء
      payload = this.app.embedService.payload(record, { ...vars, allowMentions: false });
    } else if (rule.reply_text) {
      payload = {
        content: truncate(this.app.embedService.replaceVariables(rule.reply_text, vars), 2000),
        allowedMentions: { parse: ["users"] }
      };
    } else {
      return false;
    }

    const sent = rule.reply_to
      ? await message.reply({ ...payload, allowedMentions: { ...payload.allowedMentions, repliedUser: false } }).catch(() => null)
      : await message.channel.send(payload).catch(() => null);

    if (!sent) return false;

    this.app.autoReplies.recordUse(rule.id);
    if (rule.delete_trigger) await message.delete().catch(() => {});
    return true;
  }
}

module.exports = AutoReplyService;
