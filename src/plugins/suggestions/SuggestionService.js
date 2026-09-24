const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { truncate } = require("../../core/utils/common");
const { progressBar } = require("../../core/utils/canvas");

const STATUS_STYLE = {
  pending: { emoji: "🕓", color: "info" },
  review: { emoji: "🔍", color: "warning" },
  accepted: { emoji: "✅", color: "success" },
  rejected: { emoji: "❌", color: "danger" }
};
const REFRESH_DEBOUNCE_MS = 1500;

class SuggestionService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    this._refreshTimers = new Map(); // suggestionId -> timer (فقط للاقتراحات التي صُوّت عليها للتو)
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "suggestions") || {};
  }

  isReady(guildId) {
    return this.app.features.isEnabled(guildId, "suggestions") && !!this.config(guildId).channelId;
  }

  isStaff(member) {
    const cfg = this.config(member.guild.id);
    return this.app.permissions.resolveLevel(member) >= (cfg.staffLevel ?? 2);
  }

  /** هل يستطيع العضو رفع اقتراح من هذه القناة الآن؟ */
  canCreate(member, channelId = null) {
    const cfg = this.config(member.guild.id);
    if (!cfg.channelId) return { ok: false, reason: "notConfigured" };
    if ((cfg.requiredRoleIds || []).length && !cfg.requiredRoleIds.some((r) => member.roles.cache.has(r))) {
      return { ok: false, reason: "missingRole", roles: cfg.requiredRoleIds };
    }
    if (channelId && (cfg.allowedChannelIds || []).length && !cfg.allowedChannelIds.includes(channelId)) {
      return { ok: false, reason: "wrongChannel", channels: cfg.allowedChannelIds };
    }
    const last = this.repo.lastByAuthor(member.guild.id, member.id);
    const cooldown = cfg.cooldownMs ?? 300_000;
    if (last && Date.now() - last.created_at < cooldown && !this.isStaff(member)) {
      return { ok: false, reason: "cooldown", seconds: Math.ceil((cooldown - (Date.now() - last.created_at)) / 1000) };
    }
    return { ok: true };
  }

  async create(member, content, { anonymous = false, channelId = null } = {}) {
    const guild = member.guild;
    const cfg = this.config(guild.id);
    const text = String(content || "").trim();
    if (text.length < (cfg.minLength ?? 10)) return { ok: false, reason: "tooShort", min: cfg.minLength ?? 10 };
    if (anonymous && !cfg.anonymousAllowed) return { ok: false, reason: "noAnonymous" };
    const check = this.canCreate(member, channelId);
    if (!check.ok) return check;

    const target = await this.app.client.channels.fetch(cfg.channelId).catch(() => null);
    if (!target?.isTextBased?.()) return { ok: false, reason: "notConfigured" };

    const suggestion = this.repo.create({ guildId: guild.id, authorId: member.id, content: truncate(text, 3500), anonymous });
    let message;
    try {
      message = await target.send(this.render(suggestion, guild));
    } catch (error) {
      // فشل النشر: لا نترك اقتراحًا يتيمًا بلا رسالة
      this.repo.delete(suggestion.id);
      this.app.logger.warn(`تعذّر نشر اقتراح في ${guild.id}: ${error.message}`);
      return { ok: false, reason: "sendFailed" };
    }
    let threadId = null;
    if (cfg.threads !== false && typeof message.startThread === "function") {
      const t = this.app.i18n.forGuild(guild.id);
      const thread = await message.startThread({ name: truncate(`${t("suggest.thread")} #${suggestion.number}`, 90), autoArchiveDuration: 10080 }).catch(() => null);
      threadId = thread?.id || null;
    }
    this.repo.setMessage(suggestion.id, { channelId: target.id, messageId: message.id, threadId });
    const saved = this.repo.get(suggestion.id);
    this.app.bus.emitSafe("suggestion:created", { guildId: guild.id, suggestion: saved, userId: member.id });
    return { ok: true, suggestion: saved, url: `https://discord.com/channels/${guild.id}/${target.id}/${message.id}` };
  }

  render(s, guild) {
    const t = this.app.i18n.forGuild(guild.id);
    const style = STATUS_STYLE[s.status] || STATUS_STYLE.pending;
    const total = s.upvotes + s.downvotes;
    const upPct = total ? Math.round((s.upvotes / total) * 100) : 0;
    const downPct = total ? 100 - upPct : 0;
    const fields = [
      { name: t("suggest.author"), value: s.anonymous ? `🕶️ ${t("suggest.anonymous")}` : `<@${s.author_id}>`, inline: true },
      { name: t("suggest.statusLabel"), value: `${style.emoji} ${t(`suggest.status.${s.status}`)}`, inline: true },
      { name: t("suggest.votes"), value: `👍 **${s.upvotes}** (${upPct}%) • 👎 **${s.downvotes}** (${downPct}%)\n${progressBar(total ? s.upvotes / total : 0.5, 20)}` }
    ];
    if (s.response || s.staff_id) {
      fields.push({ name: `${t("suggest.staffResponse")}${s.staff_id ? ` — <@${s.staff_id}>` : ""}`, value: truncate(s.response || "—", 1000) });
    }
    const embed = this.app.theme.embed(guild.id, {
      title: `💡 ${t("suggest.title")} #${s.number}`,
      description: s.content,
      color: style.color,
      fields,
      footer: t("suggest.footer")
    });
    const closed = s.status === "accepted" || s.status === "rejected";
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sug:v:${s.id}:u`).setEmoji("👍").setLabel(String(s.upvotes)).setStyle(ButtonStyle.Success).setDisabled(closed),
      new ButtonBuilder().setCustomId(`sug:v:${s.id}:d`).setEmoji("👎").setLabel(String(s.downvotes)).setStyle(ButtonStyle.Danger).setDisabled(closed),
      new ButtonBuilder().setCustomId(`sug:m:${s.id}`).setEmoji("⚙️").setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
  }

  canVote(member) {
    const roles = this.config(member.guild.id).voteRoleIds || [];
    return !roles.length || roles.some((r) => member.roles.cache.has(r));
  }

  vote(member, suggestionId, direction) {
    if (!this.canVote(member)) return { ok: false, reason: "missingRole" };
    const s = this.repo.get(suggestionId);
    if (!s || s.guild_id !== member.guild.id) return { ok: false, reason: "notFound" };
    const result = this.repo.vote({
      suggestionId, userId: member.id, vote: direction === "u" ? 1 : -1,
      allowChange: this.config(member.guild.id).allowVoteChange !== false
    });
    if (result.ok) this.scheduleRefresh(suggestionId);
    return result;
  }

  /** دمج تحديثات الرسالة: عشرات الأصوات في ثانية = تعديل واحد. */
  scheduleRefresh(id) {
    if (this._refreshTimers.has(id)) return;
    const timer = setTimeout(() => {
      this._refreshTimers.delete(id);
      this.refresh(id).catch((err) => this.app.errors.capture(err, { system: "suggestions/refresh" }));
    }, REFRESH_DEBOUNCE_MS);
    if (timer.unref) timer.unref();
    this._refreshTimers.set(id, timer);
  }

  async refresh(id) {
    const s = this.repo.get(id);
    if (!s?.channel_id || !s.message_id) return false;
    const guild = this.app.client.guilds?.cache?.get(s.guild_id);
    const channel = await this.app.client.channels.fetch(s.channel_id).catch(() => null);
    const message = channel ? await channel.messages.fetch(s.message_id).catch(() => null) : null;
    if (!message || !guild) return false;
    await message.edit(this.render(s, guild));
    return true;
  }

  async decide(guild, id, status, staffMember, reason = null) {
    const s = this.repo.get(id);
    if (!s || s.guild_id !== guild.id) return { ok: false, reason: "notFound" };
    const result = this.repo.setStatus(id, { status, staffId: staffMember.id, reason });
    if (!result.ok) return result;
    const updated = result.suggestion;
    const cfg = this.config(guild.id);
    const final = status === "accepted" || status === "rejected";

    if (final && cfg.archiveChannelId && cfg.archiveChannelId !== updated.channel_id) {
      await this._archive(guild, updated, cfg.archiveChannelId);
    } else {
      await this.refresh(id).catch((err) => this.app.logger.debug(`تحديث الاقتراح فشل: ${err.message}`));
    }

    if (cfg.dmAuthor !== false) {
      const t = this.app.i18n.forGuild(guild.id);
      await this.app.notifications.notify({
        guildId: guild.id,
        userId: updated.author_id,
        category: "suggestions",
        payload: {
          content: t("suggest.dmDecision", { number: updated.number, guild: guild.name, status: t(`suggest.status.${status}`) }) + (reason ? `\n> ${truncate(reason, 500)}` : "")
        }
      });
    }
    this.app.bus.emitSafe("suggestion:decided", { guildId: guild.id, suggestion: updated, status, previous: result.previous, staffId: staffMember.id, reason });
    return { ok: true, suggestion: this.repo.get(id) };
  }

  async _archive(guild, s, archiveChannelId) {
    const archive = await this.app.client.channels.fetch(archiveChannelId).catch(() => null);
    if (!archive?.isTextBased?.()) return this.refresh(s.id);
    const sent = await archive.send(this.render(s, guild)).catch(() => null);
    if (!sent) return this.refresh(s.id);
    const oldChannel = await this.app.client.channels.fetch(s.channel_id).catch(() => null);
    const old = oldChannel ? await oldChannel.messages.fetch(s.message_id).catch(() => null) : null;
    if (old) await old.delete().catch(() => {});
    this.repo.markArchived(s.id, { channelId: archive.id, messageId: sent.id });
    return true;
  }

  async remove(guild, id, staffMember) {
    const s = this.repo.get(id);
    if (!s || s.guild_id !== guild.id) return { ok: false, reason: "notFound" };
    const channel = s.channel_id ? await this.app.client.channels.fetch(s.channel_id).catch(() => null) : null;
    const message = channel ? await channel.messages.fetch(s.message_id).catch(() => null) : null;
    if (message) await message.delete().catch(() => {});
    this.repo.delete(id);
    this.app.bus.emitSafe("suggestion:deleted", { guildId: guild.id, suggestion: s, staffId: staffMember.id });
    return { ok: true };
  }

  static get STATUS_STYLE() {
    return STATUS_STYLE;
  }
}

module.exports = SuggestionService;
