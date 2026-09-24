const { dayKeyIn } = require("../../core/utils/time");
const { formatDuration } = require("../../core/utils/common");

const FLUSH_MS = 30_000;
const MAX_BUFFER = 20_000;

/**
 * سجل الأعضاء.
 *
 * الأداء: عدّادات الرسائل والصوت وآخر ظهور تُجمع في الذاكرة وتُكتب دفعة واحدة
 * كل 30 ثانية داخل معاملة واحدة — بدل ثلاث كتابات مع كل رسالة. الحجم محدود
 * بعدد الأعضاء النشطين في النافذة، ويُفرّغ فورًا إن تجاوز الحد.
 */
class HistoryService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    this.activity = new Map(); // `${guild}:${user}:${day}` -> { guildId, userId, day, messages, voiceSeconds }
    this.seen = new Map(); // `${guild}:${user}` -> { guildId, userId, lastMessageAt, channelId, lastVoiceAt }
    this.voice = new Map(); // `${guild}:${user}` -> since
    this.roleActors = new Map(); // `${guild}:${user}:${role}` -> actorId (من أوامر البوت)
    this.timer = null;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "history") || {};
  }

  _bump(guildId, userId, { messages = 0, voiceSeconds = 0, at = Date.now() }) {
    const day = dayKeyIn(at, "UTC");
    const key = `${guildId}:${userId}:${day}`;
    const row = this.activity.get(key) || { guildId, userId, day, messages: 0, voiceSeconds: 0 };
    row.messages += messages;
    row.voiceSeconds += voiceSeconds;
    this.activity.set(key, row);
    if (this.activity.size + this.seen.size > MAX_BUFFER) this.flush();
  }

  onMessage(message) {
    if (!message.guild || message.author.bot) return;
    if (this.config(message.guild.id).trackMessages === false) return;
    this._bump(message.guild.id, message.author.id, { messages: 1, at: message.createdTimestamp || Date.now() });
    const key = `${message.guild.id}:${message.author.id}`;
    const s = this.seen.get(key) || { guildId: message.guild.id, userId: message.author.id };
    s.lastMessageAt = Date.now();
    s.channelId = message.channel.id;
    this.seen.set(key, s);
    // التحليلات تستهلك نفس الحدث بلا استعلام إضافي
    this.app.bus.emitSafe("activity:message", { guildId: message.guild.id, userId: message.author.id });
  }

  onVoice(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const member = newState.member || oldState.member;
    if (!guild || !member || member.user?.bot) return;
    if (this.config(guild.id).trackVoice === false) return;
    const key = `${guild.id}:${member.id}`;
    const now = Date.now();
    if (!oldState.channelId && newState.channelId) {
      this.voice.set(key, now);
    } else if (oldState.channelId && !newState.channelId) {
      this._closeVoice(key, guild.id, member.id, now);
    }
    const s = this.seen.get(key) || { guildId: guild.id, userId: member.id };
    s.lastVoiceAt = now;
    this.seen.set(key, s);
  }

  _closeVoice(key, guildId, userId, now) {
    const since = this.voice.get(key);
    this.voice.delete(key);
    if (!since) return 0;
    const seconds = Math.round((now - since) / 1000);
    if (seconds <= 0 || seconds > 86_400) return 0;
    this._bump(guildId, userId, { voiceSeconds: seconds, at: now });
    this.app.bus.emitSafe("activity:voice", { guildId, userId, seconds });
    return seconds;
  }

  /** يحتسب جلسات الصوت الجارية حتى الآن (عند الإغلاق أو كل تفريغ) دون إنهائها. */
  _checkpointVoice(now = Date.now()) {
    for (const [key, since] of this.voice) {
      const [guildId, userId] = key.split(":");
      const seconds = Math.round((now - since) / 1000);
      if (seconds < 60) continue;
      this._bump(guildId, userId, { voiceSeconds: seconds, at: now });
      this.app.bus.emitSafe("activity:voice", { guildId, userId, seconds });
      this.voice.set(key, now);
    }
  }

  onJoin(member) {
    this.repo.addPresence(member.guild.id, member.id, "join", member.user?.username || null);
  }

  onLeave(member) {
    this.repo.addPresence(member.guild.id, member.id, "leave", member.user?.username || null);
    this._closeVoice(`${member.guild.id}:${member.id}`, member.guild.id, member.id, Date.now());
  }

  rememberRoleActor(guildId, userId, roleId, actorId) {
    if (this.roleActors.size > 2000) this.roleActors.clear();
    this.roleActors.set(`${guildId}:${userId}:${roleId}`, actorId);
  }

  onMemberUpdate(oldMember, newMember) {
    if (oldMember.partial) return;
    const guildId = newMember.guild.id;
    if (oldMember.nickname !== newMember.nickname) {
      this.repo.addName(guildId, newMember.id, "nickname", oldMember.nickname || null, newMember.nickname || null);
    }
    const oldRoles = oldMember.roles?.cache;
    const newRoles = newMember.roles?.cache;
    if (!oldRoles || !newRoles) return;
    for (const id of newRoles.keys()) {
      if (!oldRoles.has(id)) this.repo.addRole(guildId, newMember.id, id, "add", this.roleActors.get(`${guildId}:${newMember.id}:${id}`) || null);
    }
    for (const id of oldRoles.keys()) {
      if (!newRoles.has(id)) this.repo.addRole(guildId, newMember.id, id, "remove", this.roleActors.get(`${guildId}:${newMember.id}:${id}`) || null);
    }
  }

  onUserUpdate(oldUser, newUser) {
    if (oldUser.partial) return;
    if (oldUser.username !== newUser.username) this.repo.addName("*", newUser.id, "username", oldUser.username, newUser.username);
    if ((oldUser.globalName || null) !== (newUser.globalName || null)) this.repo.addName("*", newUser.id, "globalname", oldUser.globalName || null, newUser.globalName || null);
  }

  flush() {
    if (!this.activity.size && !this.seen.size) return 0;
    const activity = [...this.activity.values()];
    const seen = [...this.seen.values()];
    this.activity.clear();
    this.seen.clear();
    try {
      this.repo.flush(activity, seen);
    } catch (error) {
      this.app.errors.capture(error, { system: "history/flush" });
    }
    return activity.length + seen.length;
  }

  start() {
    // جلسات الصوت الجارية وقت الإقلاع
    for (const guild of this.app.client.guilds?.cache?.values() || []) {
      for (const state of guild.voiceStates?.cache?.values() || []) {
        if (state.channelId && !state.member?.user?.bot) this.voice.set(`${guild.id}:${state.id}`, Date.now());
      }
    }
    this.timer = setInterval(() => {
      this._checkpointVoice();
      this.flush();
    }, FLUSH_MS);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this._checkpointVoice();
    this.flush();
  }

  // ---------------- الملف الموحّد ----------------

  profile(guildId, userId) {
    this.flush(); // أحدث بيانات قبل العرض
    const since30 = dayKeyIn(Date.now() - 30 * 86_400_000, "UTC");
    const since7 = dayKeyIn(Date.now() - 7 * 86_400_000, "UTC");
    const economy = this.app.economy?.get(guildId, userId) || null;
    const levels = this.app.levels ? this.app.levels.repo.get(guildId, userId) : null;
    return {
      presence: this.repo.presenceCounts(guildId, userId),
      lastSeen: this.repo.lastSeen(guildId, userId),
      activity30: this.repo.activity(guildId, userId, since30),
      activity7: this.repo.activity(guildId, userId, since7),
      moderation: this.repo.moderationSummary(guildId, userId),
      tickets: this.repo.ticketSummary(guildId, userId),
      ticketsHandled: this.repo.ticketsHandled(guildId, userId),
      applications: this.repo.applicationSummary(guildId, userId),
      economy,
      xp: levels ? { xp: levels.xp, level: levels.level, rank: this.app.levels.repo.rankOf(guildId, userId) } : null
    };
  }

  /** إمبيد قسم من ملف العضو. */
  sectionEmbed(guild, user, member, section) {
    const t = this.app.i18n.forGuild(guild.id);
    const ts = (ms, style = "R") => (ms ? `<t:${Math.floor(ms / 1000)}:${style}>` : "—");
    const base = {
      author: { name: `${member?.displayName || user.username} (${user.id})`, iconURL: user.displayAvatarURL?.() },
      thumbnail: user.displayAvatarURL?.(),
      color: "primary"
    };

    if (section === "names") {
      const rows = this.repo.names(guild.id, user.id, 20);
      return this.app.theme.embed(guild.id, {
        ...base,
        title: `🏷️ ${t("hist.names")}`,
        description: rows.map((r) => `${ts(r.changed_at, "d")} \`${t(`hist.kind.${r.kind}`)}\` ${r.old_value || "—"} ← **${r.new_value || "—"}**`).join("\n") || t("ui.empty")
      });
    }
    if (section === "roles") {
      const rows = this.repo.roles(guild.id, user.id, 20);
      return this.app.theme.embed(guild.id, {
        ...base,
        title: `🎭 ${t("hist.roles")}`,
        description: rows.map((r) => `${ts(r.changed_at, "d")} ${r.action === "add" ? "➕" : "➖"} <@&${r.role_id}>${r.actor_id ? ` — <@${r.actor_id}>` : ""}`).join("\n") || t("ui.empty")
      });
    }
    if (section === "presence") {
      const rows = this.repo.presence(guild.id, user.id, 20);
      return this.app.theme.embed(guild.id, {
        ...base,
        title: `🚪 ${t("hist.presence")}`,
        description: rows.map((r) => `${ts(r.at, "f")} ${r.action === "join" ? `📥 ${t("hist.joined")}` : `📤 ${t("hist.left")}`}`).join("\n") || t("ui.empty")
      });
    }
    if (section === "moderation") {
      const cases = this.app.cases.listByTarget(guild.id, user.id, { limit: 15 });
      return this.app.theme.embed(guild.id, {
        ...base,
        title: `⚖️ ${t("hist.moderation")}`,
        color: "danger",
        description: cases.map((c) => `\`#${c.case_number}\` **${c.type}** ${ts(c.created_at, "d")} — <@${c.moderator_id}>${c.active ? "" : " ~~"}\n> ${String(c.reason || "—").slice(0, 80)}`).join("\n") || t("ui.empty")
      });
    }

    // overview
    const p = this.profile(guild.id, user.id);
    const mod = p.moderation.map((m) => `${m.type}: ${m.c}`).join(" • ") || "—";
    const apps = p.applications.map((a) => `${a.status}: ${a.c}`).join(" • ") || "—";
    const economy = p.economy ? `${this.app.economyService.format(guild.id, p.economy.wallet + p.economy.bank)}` : "—";
    return this.app.theme.embed(guild.id, {
      ...base,
      title: `📇 ${t("hist.overview")}`,
      fields: [
        { name: t("hist.accountCreated"), value: ts(user.createdTimestamp, "D"), inline: true },
        { name: t("hist.joinedServer"), value: member?.joinedTimestamp ? ts(member.joinedTimestamp, "D") : `❌ ${t("hist.notMember")}`, inline: true },
        { name: t("hist.joinsLeaves"), value: `📥 ${p.presence.joins} • 📤 ${p.presence.leaves}`, inline: true },
        { name: t("hist.lastSeen"), value: `💬 ${ts(p.lastSeen?.last_message_at)}\n🔊 ${ts(p.lastSeen?.last_voice_at)}`, inline: true },
        { name: t("hist.activity"), value: `7d: 💬 ${p.activity7.messages} • 🔊 ${formatDuration(p.activity7.voiceSeconds * 1000)}\n30d: 💬 ${p.activity30.messages} • 🔊 ${formatDuration(p.activity30.voiceSeconds * 1000)}`, inline: true },
        { name: "XP", value: p.xp ? `${t("xp.level")} ${p.xp.level} • ${p.xp.xp} XP • #${p.xp.rank}` : "—", inline: true },
        { name: t("hist.economy"), value: economy, inline: true },
        { name: t("hist.tickets"), value: `${p.tickets.opened} (${t("hist.open")}: ${p.tickets.open}) • ${t("hist.handled")}: ${p.ticketsHandled.claimed}/${p.ticketsHandled.closed}`, inline: true },
        { name: t("hist.applications"), value: apps, inline: true },
        { name: t("hist.moderation"), value: mod },
        { name: t("hist.roleCount"), value: member ? `${Math.max(0, member.roles.cache.size - 1)}` : "—", inline: true }
      ]
    });
  }
}

module.exports = HistoryService;
