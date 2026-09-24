const crypto = require("node:crypto");
const { AttachmentBuilder } = require("discord.js");
const LevelRepository = require("./LevelRepository");
const { dayKeyIn, weekKey } = require("../../core/utils/time");
const variables = require("../../core/utils/variables");
const canvas = require("../../core/utils/canvas");

const VOICE_TICK_MS = 60_000;
const CACHE_TTL_MS = 60_000;

/**
 * خدمة المستويات.
 *
 * منع استغلال الـXP (Anti XP Farming):
 *  - تبريد بين كل منح (افتراضي 60 ثانية) — داخل المعاملة نفسها
 *  - رفض الرسالة المكررة بنفس النص مباشرة
 *  - حد أدنى لطول الرسالة، وسقف يومي اختياري
 *  - XP الصوت فقط لمن ليس وحيدًا في الروم، وغير مُصمّ، وليس في روم الخمول
 *  - البوتات والقائمة السوداء والقنوات/الرتب المتجاهلة لا تكسب شيئًا
 */
class LevelService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    this.voiceSessions = new Map(); // `${guildId}:${userId}` -> { channelId, lastAt }
    this.voiceTimer = null;
    this._cache = new Map(); // guildId -> { at, multipliers, blacklist } — محدود بعدد السيرفرات
  }

  static xpToNext(level) { return LevelRepository.xpToNext(level); }
  static levelFromXp(xp) { return LevelRepository.levelFromXp(xp); }

  /** تقدّم العضو داخل مستواه الحالي. */
  static progress(xp) {
    let level = 0;
    let remaining = Math.max(0, xp);
    while (remaining >= LevelRepository.xpToNext(level) && level < 1000) {
      remaining -= LevelRepository.xpToNext(level);
      level++;
    }
    return { level, xpInLevel: remaining, xpForNext: LevelRepository.xpToNext(level) };
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "levels") || {};
  }

  enabled(guildId) {
    return this.app.features.isEnabled(guildId, "levels");
  }

  keys(now = Date.now()) {
    return { dayKey: dayKeyIn(now, "UTC"), weekKey: weekKey(now) };
  }

  invalidate(guildId) {
    this._cache.delete(guildId);
  }

  _guildCache(guildId) {
    const hit = this._cache.get(guildId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
    const entry = { at: Date.now(), multipliers: this.repo.multipliers(guildId), blacklist: this.repo.blacklistSet(guildId) };
    this._cache.set(guildId, entry);
    return entry;
  }

  /** أعلى مضاعف رتبة × مضاعف القناة، بحد أقصى من الإعدادات. */
  multiplierFor(guildId, member, channelId) {
    const { multipliers } = this._guildCache(guildId);
    let role = 1;
    let channel = 1;
    for (const m of multipliers) {
      if (m.target_type === "role" && member?.roles?.cache?.has(m.target_id)) role = Math.max(role, m.multiplier);
      if (m.target_type === "channel" && m.target_id === channelId) channel = m.multiplier;
    }
    const max = this.config(guildId).multiplierMax || 5;
    return Math.max(0, Math.min(max, role * channel));
  }

  /** لماذا لا يكسب هذا العضو XP هنا؟ null = يكسب. */
  ineligibleReason(guildId, member, channel) {
    if (!member || member.user?.bot) return "bot";
    const cfg = this.config(guildId);
    const channelId = channel?.id;
    const parentId = channel?.parentId;
    if ((cfg.ignoredChannels || []).some((c) => c === channelId || c === parentId)) return "ignoredChannel";
    if ((cfg.xpChannels || []).length && !cfg.xpChannels.some((c) => c === channelId || c === parentId)) return "notXpChannel";
    if ((cfg.ignoredRoles || []).some((r) => member.roles?.cache?.has(r))) return "ignoredRole";
    if (this._guildCache(guildId).blacklist.has(member.id)) return "blacklisted";
    return null;
  }

  // ---------------- XP الرسائل ----------------

  async handleMessage(message) {
    if (!message.guild || message.author.bot) return null;
    const guildId = message.guild.id;
    if (!this.enabled(guildId)) return null;
    const cfg = this.config(guildId);

    const content = (message.content || "").trim();
    if (content.length < (cfg.minMessageLength ?? 3) && !message.attachments?.size) return null;
    if (this.ineligibleReason(guildId, message.member, message.channel)) return null;

    const multiplier = this.multiplierFor(guildId, message.member, message.channel.id);
    if (multiplier <= 0) return null;
    const min = Math.max(0, cfg.messageXpMin ?? 15);
    const max = Math.max(min, cfg.messageXpMax ?? 25);
    const base = min + Math.floor(Math.random() * (max - min + 1));
    const amount = Math.max(1, Math.round(base * multiplier));

    const hash = content ? crypto.createHash("sha1").update(content.toLowerCase()).digest("hex").slice(0, 16) : null;
    const result = this.repo.awardMessage({
      guildId,
      userId: message.author.id,
      amount,
      cooldownMs: Math.max(0, cfg.cooldownMs ?? 60_000),
      hash,
      now: Date.now(),
      ...this.keys(),
      dailyCap: Math.max(0, cfg.dailyCap || 0)
    });
    if (!result) return null;

    this.app.bus.emitSafe("levels:xp", { guildId, userId: message.author.id, amount: result.granted, source: "message" });
    if (result.newLevel > result.oldLevel) {
      await this.onLevelUp(message.guild, message.author.id, result.oldLevel, result.newLevel, { member: message.member, channel: message.channel });
    }
    return result;
  }

  // ---------------- التعديل الإداري والمكافآت ----------------

  /**
   * يضيف (أو يخصم بقيمة سالبة) XP ويعالج الترقية. يُستخدم من المكافآت والإدارة والصوت.
   * silent: لا إعلان ترقية (مثلًا XP مكافأة المستوى نفسه، لتفادي سلسلة إعلانات).
   */
  addXp(guildId, userId, delta, { reason = null, actorId = null, silent = false, voiceSeconds = 0, log = true } = {}) {
    const result = this.repo.add({
      guildId, userId, delta: Math.trunc(delta), now: Date.now(), ...this.keys(), voiceSeconds,
      log: log ? { reason, actorId } : null
    });
    if (result.applied > 0) this.app.bus.emitSafe("levels:xp", { guildId, userId, amount: result.applied, source: reason || "manual" });
    if (result.newLevel !== result.oldLevel && !silent) {
      const guild = this.app.client.guilds?.cache?.get(guildId);
      if (guild && result.newLevel > result.oldLevel) {
        this.onLevelUp(guild, userId, result.oldLevel, result.newLevel, {}).catch((err) =>
          this.app.errors.capture(err, { system: "levels/levelUp", guildId })
        );
      }
    }
    return result;
  }

  setXp(guildId, userId, xp, actorId) {
    const current = this.repo.get(guildId, userId)?.xp || 0;
    return this.addXp(guildId, userId, Math.max(0, xp) - current, { reason: "set", actorId, silent: true });
  }

  transfer(guildId, fromId, toId, amount, actorId) {
    if (fromId === toId) return { ok: false, reason: "self" };
    if (!(amount > 0)) return { ok: false, reason: "invalid" };
    return this.repo.transfer({ guildId, fromId, toId, amount, actorId, now: Date.now() });
  }

  // ---------------- الترقية ----------------

  async onLevelUp(guild, userId, oldLevel, newLevel, { member = null, channel = null } = {}) {
    const cfg = this.config(guild.id);
    const target = member || (await guild.members.fetch(userId).catch(() => null));

    // مكافآت كل المستويات التي تم تجاوزها (قد يقفز العضو أكثر من مستوى بمكافأة كبيرة)
    const rewards = this.repo.rewardsBetween(guild.id, oldLevel, newLevel);
    const granted = [];
    for (const reward of rewards) {
      const result = await this.app.rewards.grant(guild.id, userId, { roleId: reward.role_id, money: reward.money }, {
        source: "level", ref: String(reward.level), member: target
      });
      if (result.ok) granted.push(reward);
    }

    // بلا تكديس: تُزال رتب مكافآت المستويات الأقل بعد نيل رتبة أعلى
    if (!cfg.stackRewards && target && granted.some((r) => r.role_id)) {
      const keep = new Set(granted.filter((r) => r.role_id).map((r) => r.role_id));
      for (const r of this.repo.rewards(guild.id)) {
        if (!r.role_id || keep.has(r.role_id) || r.level > newLevel) continue;
        if (target.roles.cache.has(r.role_id)) {
          await target.roles.remove(r.role_id, "مكافأة مستوى أقل (بلا تكديس)").catch((err) =>
            this.app.logger.warn(`تعذّر إزالة رتبة مستوى ${r.role_id}: ${err.message}`)
          );
        }
      }
    }

    this.app.bus.emitSafe("levels:up", { guildId: guild.id, userId, oldLevel, newLevel, rewards: granted });
    await this._announce(guild, userId, newLevel, granted, { member: target, channel, cfg });
  }

  async _announce(guild, userId, level, granted, { member, channel, cfg }) {
    const mode = cfg.levelUp?.mode || "current";
    if (mode === "off") return;
    const template = cfg.levelUp?.message || this.app.i18n.tg(guild.id, "xp.levelUpDefault");
    const row = this.repo.get(guild.id, userId);
    const text = variables.apply(template, variables.buildContext({
      member, user: member?.user, guild, channel, client: this.app.client,
      level, xp: row?.xp || 0, rank: this.repo.rankOf(guild.id, userId)
    }));
    const extra = granted.length
      ? `\n${this.app.i18n.tg(guild.id, "xp.rewardsEarned")} ${granted.map((r) => this.app.rewards.describe(guild.id, { roleId: r.role_id, money: r.money })).join(" • ")}`
      : "";
    const payload = { content: `${text}${extra}`.slice(0, 2000), allowedMentions: { users: [userId] } };

    if (mode === "dm") {
      await this.app.notifications.notify({ guildId: guild.id, userId, category: "levels", payload: { content: payload.content } });
      return;
    }
    const target = mode === "channel" && cfg.levelUp?.channelId
      ? await this.app.client.channels.fetch(cfg.levelUp.channelId).catch(() => null)
      : channel;
    if (!target?.isTextBased?.()) return;
    await target.send(payload).catch((err) => this.app.logger.debug(`إعلان المستوى فشل في ${guild.id}: ${err.message}`));
  }

  // ---------------- XP الصوت ----------------

  onVoiceState(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const member = newState.member || oldState.member;
    if (!guild || !member || member.user?.bot) return;
    const key = `${guild.id}:${member.id}`;
    if (!newState.channelId) {
      this._creditVoice(key, guild, member, Date.now());
      this.voiceSessions.delete(key);
      return;
    }
    const existing = this.voiceSessions.get(key);
    if (!existing) this.voiceSessions.set(key, { guildId: guild.id, userId: member.id, lastAt: Date.now() });
  }

  /** يُحتسب الوقت منذ آخر احتساب إن كانت الحالة مؤهلة. */
  _creditVoice(key, guild, member, now) {
    const session = this.voiceSessions.get(key);
    if (!session || !this.enabled(guild.id)) return 0;
    const minutes = Math.floor((now - session.lastAt) / 60_000);
    if (minutes < 1) return 0;
    session.lastAt += minutes * 60_000;
    const state = guild.voiceStates?.cache?.get(member.id);
    if (!this._voiceEligible(guild, member, state)) return 0;
    const cfg = this.config(guild.id);
    const multiplier = this.multiplierFor(guild.id, member, state?.channelId);
    const amount = Math.round(minutes * (cfg.voiceXpPerMinute ?? 10) * multiplier);
    if (amount <= 0) return 0;
    this.addXp(guild.id, member.id, amount, { reason: "voice", voiceSeconds: minutes * 60, log: false });
    return amount;
  }

  _voiceEligible(guild, member, state) {
    if (!state?.channelId) return false;
    const cfg = this.config(guild.id);
    if (guild.afkChannelId && state.channelId === guild.afkChannelId) return false;
    if (state.selfDeaf || state.serverDeaf) return false;
    if (cfg.voiceIgnoreMuted && (state.selfMute || state.serverMute)) return false;
    if (this.ineligibleReason(guild.id, member, state.channel || { id: state.channelId })) return false;
    if (cfg.voiceRequireOthers !== false) {
      const humans = state.channel?.members?.filter?.((m) => !m.user.bot)?.size ?? 0;
      if (humans < 2) return false;
    }
    return true;
  }

  voiceTick(now = Date.now()) {
    let credited = 0;
    for (const [key, session] of this.voiceSessions) {
      const guild = this.app.client.guilds?.cache?.get(session.guildId);
      const member = guild?.members?.cache?.get(session.userId);
      if (!guild || !member) {
        this.voiceSessions.delete(key);
        continue;
      }
      credited += this._creditVoice(key, guild, member, now);
    }
    return credited;
  }

  startVoice() {
    // جلسات الصوت الجارية عند الإقلاع تبدأ احتسابها من الآن
    for (const guild of this.app.client.guilds?.cache?.values() || []) {
      for (const state of guild.voiceStates?.cache?.values() || []) {
        if (state.channelId && state.member && !state.member.user.bot) {
          this.voiceSessions.set(`${guild.id}:${state.id}`, { guildId: guild.id, userId: state.id, lastAt: Date.now() });
        }
      }
    }
    this.voiceTimer = setInterval(() => {
      try {
        this.voiceTick();
      } catch (error) {
        this.app.errors.capture(error, { system: "levels/voice" });
      }
    }, VOICE_TICK_MS);
    if (this.voiceTimer.unref) this.voiceTimer.unref();
  }

  stopVoice() {
    if (this.voiceTimer) clearInterval(this.voiceTimer);
    this.voiceTimer = null;
  }

  // ---------------- العرض ----------------

  leaderboard(guildId, { period = "all", limit = 10, offset = 0 } = {}) {
    return this.repo.leaderboard(guildId, { period, limit, offset, ...this.keys() });
  }

  count(guildId, period = "all") {
    return this.repo.count(guildId, { period, ...this.keys() });
  }

  profile(guildId, userId) {
    const row = this.repo.get(guildId, userId) || { xp: 0, level: 0, messages: 0, voice_seconds: 0, daily_xp: 0, weekly_xp: 0 };
    const keys = this.keys();
    return {
      ...row,
      daily_xp: row.day_key === keys.dayKey ? row.daily_xp : 0,
      weekly_xp: row.week_key === keys.weekKey ? row.weekly_xp : 0,
      ...LevelService.progress(row.xp),
      rank: this.repo.rankOf(guildId, userId),
      total: this.repo.count(guildId, { period: "all" })
    };
  }

  /** بطاقة الرتبة: صورة إن توفرت مكتبة الرسم، وإلا إمبيد بشريط تقدم. */
  async rankPayload(guild, user, member) {
    const p = this.profile(guild.id, user.id);
    const t = this.app.i18n.forGuild(guild.id);
    const color = this.app.theme.color(guild.id, "primary");
    const buffer = await canvas.rankCard({
      username: member?.displayName || user.username,
      avatarUrl: user.displayAvatarURL?.({ extension: "png", size: 256 }),
      level: p.level, rank: p.rank || "-", xpInLevel: p.xpInLevel, xpForNext: p.xpForNext, totalXp: p.xp,
      // خلفية تجميلية اشتراها العضو من المتجر تتقدّم على خلفية السيرفر
      color, backgroundUrl: this.app.shop?.cosmetic(guild.id, user.id, "rankBackground") || this.config(guild.id).cardBackgroundUrl
    });
    const embed = this.app.theme.embed(guild.id, {
      author: { name: member?.displayName || user.username, iconURL: user.displayAvatarURL?.() },
      color: "primary",
      fields: [
        { name: t("xp.level"), value: `\`${p.level}\``, inline: true },
        { name: t("xp.rank"), value: p.rank ? `\`#${p.rank}\` / ${p.total}` : "—", inline: true },
        { name: "XP", value: `\`${p.xp}\``, inline: true },
        { name: t("xp.progress"), value: `${canvas.progressBar(p.xpInLevel / p.xpForNext)} \`${p.xpInLevel}/${p.xpForNext}\`` },
        { name: t("xp.today"), value: `\`${p.daily_xp}\``, inline: true },
        { name: t("xp.week"), value: `\`${p.weekly_xp}\``, inline: true },
        { name: t("xp.voice"), value: `\`${Math.round(p.voice_seconds / 60)}\` ${t("xp.minutes")}`, inline: true }
      ]
    });
    if (buffer) {
      embed.setImage("attachment://rank.png");
      return { embeds: [embed], files: [new AttachmentBuilder(buffer, { name: "rank.png" })] };
    }
    return { embeds: [embed] };
  }
}

module.exports = LevelService;
