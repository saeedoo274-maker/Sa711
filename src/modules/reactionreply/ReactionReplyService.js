const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

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
    this.cooldowns = new Map(); // `${ruleId}:${userId}` -> until
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

  /**
   * يجد القاعدة المطابقة لتفاعل معيّن، مع احترام قيود القنوات والرسالة.
   * القاعدة المربوطة برسالة محددة تتقدم على القاعدة العامة لنفس الإيموجي.
   */
  match(guildId, emoji, channelId, messageId = null, channel = null) {
    const key = this.emojiKey(emoji);
    const parentId = channel?.parentId || null;
    const candidates = this.rules(guildId).filter((r) => {
      if (r.emoji !== key && r.emoji !== emoji.name) return false;
      if (r.message_id && r.message_id !== messageId) return false;
      if (r.channels.length && !r.channels.includes(channelId) && !(parentId && r.channels.includes(parentId))) return false;
      return true;
    });
    return candidates.find((r) => r.message_id) || candidates[0] || null;
  }

  /** الشروط: رتب مطلوبة/محظورة، عمر الحساب، المستوى. يُرجع null عند السماح. */
  checkRequirements(rule, member) {
    if (rule.required_roles?.length && !rule.required_roles.some((r) => member.roles.cache.has(r))) return "requiredRole";
    if (rule.blocked_roles?.length && rule.blocked_roles.some((r) => member.roles.cache.has(r))) return "blockedRole";
    if (rule.min_account_days && Date.now() - (member.user.createdTimestamp || 0) < rule.min_account_days * 86_400_000) return "accountAge";
    if (rule.min_level) {
      const level = this.app.levels && this.app.features.isEnabled(member.guild.id, "levels") ? this.app.levels.profile(member.guild.id, member.id).level : 0;
      if (level < rule.min_level) return "level";
    }
    return null;
  }

  _cooldown(rule, userId) {
    if (!rule.cooldown_ms) return 0;
    this.cooldowns ||= new Map();
    const key = `${rule.id}:${userId}`;
    const now = Date.now();
    const until = this.cooldowns.get(key) || 0;
    if (until > now) return until - now;
    if (this.cooldowns.size > 20_000) for (const [k, v] of this.cooldowns) if (v <= now) this.cooldowns.delete(k);
    this.cooldowns.set(key, now + rule.cooldown_ms);
    return 0;
  }

  _manageable(guild, roleId) {
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    const me = guild.members.me;
    return role && !role.managed && role.position < me.roles.highest.position ? role : null;
  }

  async _log(guild, rule, member, actions, removed) {
    if (!rule.log_channel_id || !actions.length) return;
    const channel = guild.channels.cache.get(rule.log_channel_id) || (await this.app.client.channels.fetch(rule.log_channel_id).catch(() => null));
    if (!channel?.send) return;
    await channel.send({
      embeds: [this.app.theme.embed(guild.id, {
        title: `🎭 ${rule.name} ${rule.emoji}`,
        description: `${member} ${removed ? "أزال التفاعل" : "تفاعل"}\n${actions.map((a) => `• ${a}`).join("\n")}`,
        color: removed ? "neutral" : "info"
      })],
      allowedMentions: { parse: [] }
    }).catch(() => {});
  }

  async handle(reaction, user, guild, { removed = false } = {}) {
    const message = reaction.message;
    const rule = this.match(guild.id, reaction.emoji, message.channel.id, message.id, message.channel);
    if (!rule) return false;
    // عند إزالة التفاعل لا يُعكس إلا وضع المزامنة (رتبة/قناة)
    if (removed && rule.role_mode !== "sync") return false;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return false;

    const failed = this.checkRequirements(rule, member);
    const wait = !failed && !removed ? this._cooldown(rule, user.id) : 0;
    if (failed || wait > 0) {
      if (!removed) {
        await reaction.users?.remove?.(user.id).catch(() => {});
        const reasons = { requiredRole: "لا تملك الرتبة المطلوبة", blockedRole: "رتبتك لا تسمح بهذا", accountAge: "حسابك جديد جدًا", level: `تحتاج المستوى ${rule.min_level}` };
        await user.send({ content: `${this.app.config.emoji("warning")} ${failed ? reasons[failed] : "انتظر قليلًا قبل التفاعل مجددًا"} — ${rule.emoji} **${guild.name}**`, allowedMentions: { parse: [] } }).catch(() => {});
      }
      return false;
    }

    let acted = false;
    const actions = [];
    const mode = rule.role_mode || "toggle";

    const role = this._manageable(guild, rule.role_id);
    if (role) {
      const has = member.roles.cache.has(role.id);
      const add = mode === "add" || (mode === "sync" && !removed) || (mode === "toggle" && !has);
      const remove = mode === "remove" || (mode === "sync" && removed) || (mode === "toggle" && has);
      if (add && !has) {
        await member.roles.add(role, "رد تفاعل").catch(() => {});
        actions.push(`➕ <@&${role.id}>`);
      } else if (remove && has) {
        await member.roles.remove(role, "رد تفاعل").catch(() => {});
        actions.push(`➖ <@&${role.id}>`);
      }
      acted = true;
    }

    if (!removed) {
      const removeRole = this._manageable(guild, rule.remove_role_id);
      if (removeRole && member.roles.cache.has(removeRole.id)) {
        await member.roles.remove(removeRole, "رد تفاعل").catch(() => {});
        actions.push(`➖ <@&${removeRole.id}>`);
        acted = true;
      }
    }

    if (rule.target_channel_id && rule.channel_action) {
      const target = guild.channels.cache.get(rule.target_channel_id);
      if (target?.permissionOverwrites) {
        const grant = rule.channel_action === "view" ? !removed : removed;
        await target.permissionOverwrites.edit(member.id, { ViewChannel: grant ? true : null }).catch(() => {});
        actions.push(`${grant ? "👁️" : "🙈"} <#${target.id}>`);
        acted = true;
      }
    }

    if (!removed) {
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

      if (payload && rule.button_label && rule.button_url) {
        payload.components = [...(payload.components || []), new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(rule.button_label.slice(0, 80)).setURL(rule.button_url)
        )].slice(0, 5);
      }

      if (payload) {
        const target = rule.dm ? await user.send(payload).catch(() => null) : await message.channel.send(payload).catch(() => null);
        if (target) {
          acted = true;
          actions.push(rule.dm ? "✉️ رد في الخاص" : "💬 رد في القناة");
        }
      }

      if (rule.open_ticket && this.app.ticketService) {
        const res = await this.app.ticketService.open({ guild, member }).catch((err) => {
          this.app.errors.capture(err, { system: "reactionreply/ticket", guildId: guild.id });
          return { ok: false };
        });
        if (res.ok) {
          acted = true;
          actions.push(`🎫 <#${res.channel.id}>`);
          await user.send({ content: `🎫 ${guild.name}: <#${res.channel.id}>` }).catch(() => {});
        }
      }

      if (rule.remove_reaction) await reaction.users?.remove?.(user.id).catch(() => {});
    }

    if (acted) {
      this.app.reactionReplies.recordUse(rule.id);
      await this._log(guild, rule, member, actions, removed);
      this.app.bus.emitSafe("reactionAutomation:fired", { guildId: guild.id, guild, rule: rule.name, userId: user.id, removed });
    }
    return acted;
  }
}

module.exports = ReactionReplyService;
