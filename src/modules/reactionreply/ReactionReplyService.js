/**
 * الرد على التفاعلات: العضو يضغط إيموجي على رسالة معيّنة فيحصل على رد أو رتبة.
 *
 * يُفرَّق بين قواعد السيرفر بالاسم لا بالرسالة، فقاعدة واحدة تعمل
 * على أي رسالة يُضاف لها نفس الإيموجي — هذا هو الفرق عن الرتب الذاتية
 * التي تُربط بلوحة محددة.
 */
class ReactionReplyService {
  constructor(app) {
    this.app = app;
    this.cache = new Map();
    this.ttlMs = 300_000;
  }

  invalidate(guildId) {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
  }

  rules(guildId) {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.rules;
    const rules = this.app.reactionReplies.listEnabled(guildId);
    this.cache.set(guildId, { rules, expiresAt: Date.now() + this.ttlMs });
    return rules;
  }

  emojiKey(emoji) {
    return emoji.id || emoji.name;
  }

  /** يجد القاعدة المطابقة لتفاعل معيّن، مع احترام قيود القنوات. */
  match(guildId, emoji, channelId) {
    const key = this.emojiKey(emoji);
    return this.rules(guildId).find((r) => {
      if (r.emoji !== key && r.emoji !== emoji.name) return false;
      if (r.channels.length && !r.channels.includes(channelId)) return false;
      return true;
    }) || null;
  }

  async handle(reaction, user, guild) {
    const rule = this.match(guild.id, reaction.emoji, reaction.message.channel.id);
    if (!rule) return false;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return false;

    let acted = false;

    if (rule.role_id) {
      const role = guild.roles.cache.get(rule.role_id);
      const me = guild.members.me;
      if (role && !role.managed && role.position < me.roles.highest.position) {
        if (member.roles.cache.has(role.id)) await member.roles.remove(role, "رد تفاعل").catch(() => {});
        else await member.roles.add(role, "رد تفاعل").catch(() => {});
        acted = true;
      }
    }

    const vars = { member, guild };
    let payload = null;

    if (rule.embed_id) {
      const record = this.app.embeds.get(rule.embed_id);
      if (record) payload = this.app.embedService.payload(record, { ...vars, allowMentions: false });
    } else if (rule.reply_text) {
      payload = {
        content: this.app.embedService.replaceVariables(rule.reply_text, vars).slice(0, 2000),
        allowedMentions: { parse: [] }
      };
    }

    if (payload) {
      const target = rule.dm ? await user.send(payload).catch(() => null) : await reaction.message.channel.send(payload).catch(() => null);
      if (target) acted = true;
    }

    if (acted) this.app.reactionReplies.recordUse(rule.id);
    return acted;
  }
}

module.exports = ReactionReplyService;
