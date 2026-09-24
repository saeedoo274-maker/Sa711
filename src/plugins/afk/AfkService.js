const { formatDuration, truncate } = require("../../core/utils/common");

const SELF_MESSAGE_GRACE_MS = 5_000;

/**
 * حالة الغياب (AFK).
 *
 * الأداء: فهرس في الذاكرة لمفاتيح `guild:user` الغائبين فقط، فالرسائل العادية
 * (الغالبية الساحقة) لا تلمس قاعدة البيانات إطلاقًا. الفهرس يُبنى عند الإقلاع
 * ويُحدَّث مع كل تفعيل/إزالة، وحجمه = عدد الغائبين فعلًا.
 */
class AfkService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    this.index = new Set();
    this._noticeCooldown = new Map(); // `${channel}:${afkUser}` -> ts (محدود)
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "afk") || {};
  }

  key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  load() {
    this.index.clear();
    for (const row of this.repo.all()) this.index.add(this.key(row.guild_id, row.user_id));
  }

  isAfk(guildId, userId) {
    return this.index.has(this.key(guildId, userId));
  }

  async setAfk(member, { reason = null, durationMs = null } = {}) {
    const guildId = member.guild.id;
    const cfg = this.config(guildId);
    const cleanReason = reason ? truncate(reason.replace(/@(everyone|here)/g, "@​$1"), cfg.maxReasonLength || 200) : null;
    const now = Date.now();
    const existing = this.repo.get(guildId, member.id);

    let originalNick = existing?.original_nick ?? member.nickname ?? null;
    let nickChanged = !!existing?.nick_changed;
    if (!existing && cfg.setNickname !== false && member.manageable !== false && member.setNickname) {
      const prefix = cfg.nickPrefix || "[AFK] ";
      const base = member.nickname || member.displayName || member.user.username;
      if (!base.startsWith(prefix)) {
        try {
          await member.setNickname(`${prefix}${base}`.slice(0, 32), "AFK");
          nickChanged = true;
        } catch (error) {
          this.app.logger.debug(`تعذّر تغيير اسم ${member.id} للغياب: ${error.message}`);
        }
      }
    }

    const row = this.repo.set(guildId, member.id, {
      reason: cleanReason,
      since: now,
      expiresAt: durationMs ? now + durationMs : null,
      originalNick,
      nickChanged,
      lastActiveAt: now
    });
    this.index.add(this.key(guildId, member.id));

    const jobKey = `afk:${guildId}:${member.id}`;
    if (durationMs) {
      this.app.scheduler.schedule({ type: "afk:expire", guildId, uniqueKey: jobKey, runAt: now + durationMs, payload: { guildId, userId: member.id } });
    } else {
      this.app.scheduler.cancelByKey(jobKey);
    }
    this.app.bus.emitSafe("afk:set", { guildId, userId: member.id, reason: cleanReason, durationMs });
    return row;
  }

  /** يزيل الحالة ويعيد الاسم. يُرجع السجل المحذوف أو null. */
  async clear(guild, userId, { member = null, reason = "return" } = {}) {
    const removed = this.repo.remove(guild.id, userId);
    this.index.delete(this.key(guild.id, userId));
    this.app.scheduler.cancelByKey(`afk:${guild.id}:${userId}`);
    if (!removed) return null;

    if (removed.nick_changed) {
      const target = member || (await guild.members.fetch(userId).catch(() => null));
      if (target?.setNickname) {
        await target.setNickname(removed.original_nick || null, "AFK: عودة").catch((error) =>
          this.app.logger.debug(`تعذّر إعادة اسم ${userId}: ${error.message}`)
        );
      }
    }
    this.app.bus.emitSafe("afk:clear", { guildId: guild.id, userId, reason, mentions: removed.mentions, durationMs: Date.now() - removed.since });
    return removed;
  }

  async handleMessage(message) {
    if (!message.guild || message.author.bot) return;
    const guildId = message.guild.id;
    const cfg = this.config(guildId);
    const t = this.app.i18n.forGuild(guildId);

    // 1) صاحب الرسالة غائب ← عاد
    if (this.isAfk(guildId, message.author.id)) {
      const row = this.repo.get(guildId, message.author.id);
      const prefix = this.app.guildConfig.value(guildId, "prefix") || this.app.config.bot.defaultPrefix;
      const content = message.content || "";
      const isAfkCommand = content.startsWith(prefix) && /^(afk|away|غياب)(\s|$)/i.test(content.slice(prefix.length).trim());
      if (row && message.createdTimestamp - row.since > SELF_MESSAGE_GRACE_MS && !isAfkCommand) {
        const removed = await this.clear(message.guild, message.author.id, { member: message.member });
        if (removed) {
          const lines = removed.mentionList.slice(0, 5).map((m) =>
            `• <@${m.author_id}> — [${t("afk.jump")}](https://discord.com/channels/${guildId}/${m.channel_id}/${m.message_id})${m.excerpt ? `: ${m.excerpt}` : ""}`
          );
          const content =
            `${this.app.config.emoji("success")} ${t("afk.welcomeBack", { user: `<@${message.author.id}>`, duration: formatDuration(Date.now() - removed.since), count: removed.mentions })}` +
            (lines.length ? `\n${lines.join("\n")}` : "");
          const sent = await message.reply({ content: content.slice(0, 2000), allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
          if (sent && cfg.welcomeBackDeleteAfterMs > 0) {
            const timer = setTimeout(() => sent.delete().catch(() => {}), cfg.welcomeBackDeleteAfterMs);
            if (timer.unref) timer.unref();
          }
        }
      }
    }

    // 2) منشن لعضو غائب ← تنبيه
    if ((cfg.ignoredChannels || []).includes(message.channel.id)) return;
    const mentioned = [...(message.mentions?.users?.values?.() || [])].filter((u) => !u.bot && u.id !== message.author.id && this.isAfk(guildId, u.id));
    if (!mentioned.length) return;

    const notices = [];
    for (const user of mentioned.slice(0, 5)) {
      const row = this.repo.get(guildId, user.id);
      if (!row) continue;
      this.repo.recordMention(guildId, user.id, {
        authorId: message.author.id,
        channelId: message.channel.id,
        messageId: message.id,
        excerpt: truncate((message.content || "").replace(/<@!?\d+>/g, "").trim(), 80) || null
      });
      const cdKey = `${message.channel.id}:${user.id}`;
      const last = this._noticeCooldown.get(cdKey) || 0;
      if (Date.now() - last < (cfg.mentionCooldownMs ?? 30_000)) continue;
      if (this._noticeCooldown.size > 10_000) this._noticeCooldown.clear();
      this._noticeCooldown.set(cdKey, Date.now());
      notices.push(t(row.reason ? "afk.isAfkReason" : "afk.isAfk", {
        user: user.username,
        since: `<t:${Math.floor(row.since / 1000)}:R>`,
        reason: row.reason || "",
        until: row.expires_at ? ` — ${t("afk.until", { time: `<t:${Math.floor(row.expires_at / 1000)}:R>` })}` : ""
      }));
    }
    if (notices.length) {
      await message.reply({ content: notices.join("\n").slice(0, 2000), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    }
  }
}

module.exports = AfkService;
