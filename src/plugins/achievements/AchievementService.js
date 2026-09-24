const { Events } = require("../../core/events/EventBus");
const { dayKeyIn } = require("../../core/utils/time");
const { progressBar } = require("../../core/utils/canvas");
const { METRICS, BUILTINS } = require("./catalog");

const FLUSH_MS = 30_000;

/**
 * الإنجازات: تستمع لأحداث الأنظمة على الناقل (لا تستدعي أي نظام مباشرة)،
 * تجمع المقاييس في الذاكرة وتكتبها دفعة واحدة، ثم تفحص الإنجازات المتأثرة فقط.
 */
class AchievementService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    this.pending = new Map(); // `${g}:${u}:${metric}` -> { guildId, userId, metric, value, mode }
    this._activeDay = new Set();
    this._activeDayKey = null;
    this._defs = new Map(); // guildId -> { at, list } كاش قصير
    this.timer = null;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "achievements") || {};
  }

  enabled(guildId) {
    return this.app.features.isEnabled(guildId, "achievements");
  }

  /** كل إنجازات السيرفر: المدمجة (مع تجاوزاتها) + المخصصة. */
  definitions(guildId) {
    const hit = this._defs.get(guildId);
    if (hit && Date.now() - hit.at < 60_000) return hit.list;
    const custom = this.repo.custom(guildId);
    const byKey = new Map(custom.map((c) => [c.key, c]));
    const list = [];
    if (this.config(guildId).builtins !== false) {
      for (const b of BUILTINS) {
        const o = byKey.get(b.key);
        if (o) {
          if (o.enabled) list.push({ ...b, ...o, builtin: true });
          byKey.delete(b.key);
        } else list.push(b);
      }
    }
    for (const c of byKey.values()) if (c.enabled) list.push(c);
    if (this._defs.size > 1000) this._defs.clear();
    this._defs.set(guildId, { at: Date.now(), list });
    return list;
  }

  invalidate(guildId) {
    this._defs.delete(guildId);
  }

  // ---------------- جمع المقاييس ----------------

  track(guildId, userId, metric, value = 1) {
    if (!guildId || !userId || !METRICS[metric] || !this.enabled(guildId)) return;
    const mode = METRICS[metric].mode;
    const key = `${guildId}:${userId}:${metric}`;
    const row = this.pending.get(key) || { guildId, userId, metric, value: 0, mode };
    row.value = mode === "max" ? Math.max(row.value, value) : row.value + value;
    this.pending.set(key, row);
    if (this.pending.size > 20_000) this.flush().catch((err) => this.app.errors.capture(err, { system: "achievements/flush" }));
  }

  /** يكتب المقاييس ثم يفحص إنجازات من تغيّرت مقاييسهم فقط. */
  async flush() {
    if (!this.pending.size) return [];
    const rows = [...this.pending.values()];
    this.pending.clear();
    this.repo.flush(rows);
    const affected = new Map();
    for (const r of rows) affected.set(`${r.guildId}:${r.userId}`, { guildId: r.guildId, userId: r.userId });
    const unlocked = [];
    for (const { guildId, userId } of affected.values()) unlocked.push(...(await this.evaluate(guildId, userId)));
    return unlocked;
  }

  async evaluate(guildId, userId) {
    const metrics = this.repo.metrics(guildId, userId);
    const owned = this.repo.unlocks(guildId, userId);
    const unlocked = [];
    for (const def of this.definitions(guildId)) {
      if (owned.has(def.key)) continue;
      if ((metrics[def.metric] || 0) < def.target) continue;
      if (!this.repo.unlock(guildId, userId, def.key)) continue;
      unlocked.push(def);
      await this._onUnlock(guildId, userId, def);
    }
    return unlocked;
  }

  async _onUnlock(guildId, userId, def) {
    let rewardText = "";
    if (def.reward && this.app.rewards) {
      const res = await this.app.rewards.grant(guildId, userId, def.reward, { source: "achievement", ref: def.key });
      if (res.ok) rewardText = this.app.rewards.describe(guildId, { ...def.reward, roleId: res.applied.roleId || null });
    }
    this.app.bus.emitSafe("achievement:unlocked", { guildId, userId, key: def.key, name: def.name });
    const t = this.app.i18n.forGuild(guildId);
    const cfg = this.config(guildId);
    const text = `🏆 ${t("ach.unlocked", { user: `<@${userId}>`, name: `${def.emoji || "🏅"} **${def.name}**` })}${rewardText ? `\n🎁 ${rewardText}` : ""}`;
    const targets = [];
    if (cfg.announceChannelId) targets.push("channel");
    if (cfg.dm !== false) targets.push("dm");
    if (targets.length) {
      await this.app.notifications.notify({ guildId, userId, category: "achievements", targets, channelId: cfg.announceChannelId, payload: { content: text.slice(0, 2000) } });
    }
  }

  // ---------------- ربط الأحداث ----------------

  wire() {
    const bus = this.app.bus;
    bus.on("activity:message", ({ guildId, userId }) => {
      this.track(guildId, userId, "messages");
      const day = dayKeyIn(Date.now(), "UTC");
      if (this._activeDayKey !== day) {
        this._activeDay.clear();
        this._activeDayKey = day;
      }
      const k = `${guildId}:${userId}`;
      if (!this._activeDay.has(k) && this._activeDay.size < 200_000) {
        this._activeDay.add(k);
        this.track(guildId, userId, "active_days");
      }
    });
    bus.on("activity:voice", ({ guildId, userId, seconds }) => this.track(guildId, userId, "voice_minutes", Math.floor(seconds / 60)));
    bus.on("levels:up", ({ guildId, userId, newLevel }) => this.track(guildId, userId, "level", newLevel));
    bus.on("levels:xp", ({ guildId, userId, amount }) => amount > 0 && this.track(guildId, userId, "xp", amount));
    bus.on("economy:claim", ({ guildId, userId, kind, streak }) => kind === "daily" && this.track(guildId, userId, "daily_streak", streak));
    bus.on("economy:transaction", ({ guildId, userId }) => {
      const acc = this.app.economy.get(guildId, userId);
      if (acc) this.track(guildId, userId, "balance", acc.wallet + acc.bank);
    });
    bus.on("shop:purchase", ({ guildId, userId, quantity }) => this.track(guildId, userId, "shop_purchases", quantity || 1));
    bus.on("game:finished", ({ guildId, userId, outcome, status }) => {
      if (status !== "finished") return;
      this.track(guildId, userId, "games_played");
      if (outcome === "won") this.track(guildId, userId, "games_won");
    });
    bus.on("ticket:created", ({ guild, ticket }) => guild && ticket && this.track(guild.id, ticket.owner_id, "tickets_opened"));
    bus.on("ticket:closed", ({ guild, member }) => guild && member && this.track(guild.id, member.id, "tickets_closed"));
    bus.on("suggestion:created", ({ guildId, suggestion }) => this.track(guildId, suggestion.author_id, "suggestions"));
    bus.on("suggestion:decided", ({ guildId, suggestion, status }) => status === "accepted" && this.track(guildId, suggestion.author_id, "suggestions_accepted"));
    bus.on(Events.STAFF_PROMOTED, ({ guild, target }) => guild && target && this.track(guild.id, target.id, "staff_promotions"));
  }

  start() {
    this.timer = setInterval(() => {
      this.flush().catch((err) => this.app.errors.capture(err, { system: "achievements/flush" }));
    }, FLUSH_MS);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.flush().catch(() => {});
  }

  // ---------------- العرض ----------------

  /** قائمة إنجازات العضو مع التقدّم؛ المخفية تظهر ??? حتى تُفتح. */
  overview(guildId, userId) {
    const metrics = this.repo.metrics(guildId, userId);
    const owned = this.repo.unlocks(guildId, userId);
    return this.definitions(guildId).map((d) => {
      const value = metrics[d.metric] || 0;
      const done = owned.has(d.key);
      return { ...d, value, done, unlockedAt: owned.get(d.key) || null, ratio: Math.min(1, value / d.target), visible: done || !d.hidden };
    });
  }

  payload(guild, user) {
    const t = this.app.i18n.forGuild(guild.id);
    const list = this.overview(guild.id, user.id);
    const done = list.filter((a) => a.done).length;
    const byCategory = {};
    for (const a of list) (byCategory[a.category] ||= []).push(a);
    const fields = Object.entries(byCategory).slice(0, 25).map(([cat, items]) => ({
      name: t(`ach.cat.${cat}`),
      value: items.map((a) => {
        if (!a.visible) return `🔒 ??? — ${t("ach.hidden")}`;
        if (a.done) return `✅ ${a.emoji || "🏅"} **${a.name}** — <t:${Math.floor(a.unlockedAt / 1000)}:d>`;
        return `▫️ ${a.emoji || "🏅"} ${a.name} ${progressBar(a.ratio, 8)} \`${Math.min(a.value, a.target)}/${a.target}\``;
      }).join("\n").slice(0, 1024)
    }));
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `🏆 ${t("ach.title", { user: user.username })}`,
        description: `${progressBar(list.length ? done / list.length : 0, 20)} **${done}/${list.length}**`,
        color: "warning",
        thumbnail: user.displayAvatarURL?.(),
        fields
      })],
      allowedMentions: { parse: [] }
    };
  }
}

module.exports = AchievementService;
