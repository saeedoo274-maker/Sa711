const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const COOLDOWN_MS = 3000;

/**
 * إطار الألعاب.
 *
 * كل لعبة وحدة صغيرة في games/ تعرّف: key, emoji, start(), وحسب نوعها handle() و expire().
 * الإطار يتولى المشترك بينها:
 *  - التحقق من الرهان (حد أدنى/أعلى، رصيد الجيب، حساب مجمّد)
 *  - حجز الرهان وصرف الأرباح عبر الاقتصاد الموجود (adjustWallet) داخل معاملات
 *  - جلسات محفوظة في قاعدة البيانات، وانتهاء صلاحيتها عبر المجدول
 *  - استرداد الرهانات تلقائيًا للجلسات العالقة بعد إعادة التشغيل
 *  - إحصاءات كل لاعب وكل لعبة
 *  - عشوائية آمنة (crypto.randomInt) بدل Math.random
 */
class GameEngine {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    this.games = new Map();
    this._cooldowns = new Map();
    this.loadGames();
  }

  loadGames() {
    const dir = path.join(__dirname, "games");
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const game = require(path.join(dir, file));
      this.games.set(game.key, game);
    }
  }

  config(guildId) {
    return { minBet: 10, maxBet: 100_000, lobbyMs: 30_000, sessionMs: 120_000, ...(this.app.guildConfig.value(guildId, "games") || {}) };
  }

  static int(min, max) {
    return crypto.randomInt(min, max + 1);
  }

  static chance(p) {
    return crypto.randomInt(0, 1_000_000) < p * 1_000_000;
  }

  static shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  t(guildId) {
    return this.app.i18n.forGuild(guildId);
  }

  fmt(guildId, v) {
    return this.app.economyService.format(guildId, v);
  }

  /** يتحقق من الرهان قبل فتح أي جلسة. bet = 0 مسموح فقط للألعاب المجانية. */
  checkBet(member, bet, { allowFree = false } = {}) {
    const guildId = member.guild.id;
    const cfg = this.config(guildId);
    if (this.app.guildConfig.value(guildId, "economy.enabled") === false && bet > 0) return { ok: false, reason: "economyDisabled" };
    if (bet === 0 && allowFree) return { ok: true };
    if (!Number.isInteger(bet) || bet < cfg.minBet || bet > cfg.maxBet) return { ok: false, reason: "betRange", min: cfg.minBet, max: cfg.maxBet };
    const account = this.app.economy.get(guildId, member.id) || this.app.economyService.account(guildId, member.id);
    if (account.frozen) return { ok: false, reason: "frozen" };
    if (account.wallet < bet) return { ok: false, reason: "insufficient", wallet: account.wallet };
    const key = `${guildId}:${member.id}`;
    const last = this._cooldowns.get(key) || 0;
    if (Date.now() - last < COOLDOWN_MS) return { ok: false, reason: "cooldown" };
    if (this._cooldowns.size > 10_000) this._cooldowns.clear();
    this._cooldowns.set(key, Date.now());
    const busy = this.repo.activeFor(guildId, member.id);
    if (busy) return { ok: false, reason: "busy", game: busy.game };
    return { ok: true };
  }

  /** يفتح جلسة ويحجز الرهان ويجدول انتهاءها. */
  open(member, channel, game, bet, state = {}, ttlMs = null) {
    const cfg = this.config(member.guild.id);
    const expiresAt = Date.now() + (ttlMs || cfg.sessionMs);
    const res = this.repo.openSession({ guildId: member.guild.id, channelId: channel?.id || null, hostId: member.id, game, bet, state, expiresAt });
    if (!res.ok) return res;
    this.app.scheduler.schedule({ type: "games:expire", guildId: member.guild.id, uniqueKey: `game:${res.session.id}`, runAt: expiresAt, payload: { id: res.session.id } });
    return res;
  }

  /** ينهي الجلسة (مرة واحدة فقط) ويصرف الأرباح ويبث حدثًا للإنجازات والتحليلات. */
  finish(session, results, status = "finished") {
    const res = this.repo.finish(session.id, results, status);
    if (!res.ok) return res;
    this.app.scheduler.cancelByKey(`game:${session.id}`);
    for (const r of results) {
      this.app.bus.emitSafe("game:finished", { guildId: session.guild_id, userId: r.userId, game: session.game, bet: session.bet, payout: r.payout, outcome: r.outcome, status });
    }
    return res;
  }

  refund(session) {
    return this.finish(session, session.players.map((userId) => ({ userId, payout: session.bet, outcome: "draw" })), "refunded");
  }

  /** لعبة فورية (بلا تفاعل): تُفتح وتُحسم في نفس اللحظة. */
  instant(member, channel, game, bet, resolve) {
    const opened = this.open(member, channel, game, bet);
    if (!opened.ok) return opened;
    const { payout, outcome, data } = resolve();
    const res = this.finish(opened.session, [{ userId: member.id, payout, outcome }]);
    if (!res.ok) return res;
    return { ok: true, payout, outcome, data, account: this.app.economy.get(member.guild.id, member.id) };
  }

  async start(ctx, key, options) {
    const game = this.games.get(key);
    if (!game) return { ok: false, reason: "unknownGame" };
    return game.start(this, ctx, options);
  }

  async handle(interaction, sessionId, action, arg) {
    const session = this.repo.get(sessionId);
    if (!session || session.guild_id !== interaction.guild.id) return { ok: false, reason: "closed" };
    const game = this.games.get(session.game);
    if (!game?.handle) return { ok: false, reason: "closed" };
    if (session.status !== "active") return { ok: false, reason: "closed" };
    return game.handle(this, interaction, session, action, arg);
  }

  /** انتهاء المهلة: كل لعبة تقرر (إكمال تلقائي أو استرداد). الافتراضي استرداد. */
  async expire(sessionId) {
    const session = this.repo.get(sessionId);
    if (!session || session.status !== "active") return;
    const game = this.games.get(session.game);
    if (game?.expire) return game.expire(this, session);
    return this.refund(session);
  }

  /** عند الإقلاع: أي جلسة ما زالت نشطة من قبل التوقف تُستردّ لأن رسالتها التفاعلية ضاعت. */
  refundAllStale() {
    let refunded = 0;
    for (const session of this.repo.staleSessions(Date.now(), { includeUnexpired: true })) {
      if (this.refund(session).ok) refunded++;
    }
    return refunded;
  }

  /** يرد على الأمر ويحفظ آيدي رسالة اللعبة في حالة الجلسة (للتعديل عند انتهاء المهلة). */
  async replyAndTrack(ctx, session, payload) {
    const sent = await ctx.reply(payload);
    let message = sent && typeof sent.edit === "function" && sent.id ? sent : null;
    if (!message && ctx.isSlash && typeof ctx.interaction.fetchReply === "function") {
      message = await ctx.interaction.fetchReply().catch(() => null);
    }
    if (message?.id) {
      const fresh = this.repo.get(session.id);
      this.repo.saveState(session.id, { ...(fresh?.state || session.state), messageId: message.id });
    }
    return message;
  }

  async editMessage(session, payload) {
    const state = session.state || {};
    if (!session.channel_id || !state.messageId) return;
    const channel = await this.app.client.channels.fetch(session.channel_id).catch(() => null);
    const message = channel ? await channel.messages.fetch(state.messageId).catch(() => null) : null;
    if (message) await message.edit(payload).catch((err) => this.app.logger.debug(`تعديل رسالة اللعبة فشل: ${err.message}`));
  }
}

module.exports = GameEngine;
