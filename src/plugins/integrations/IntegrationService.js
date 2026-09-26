const crypto = require("node:crypto");
const { PermissionFlagsBits } = require("discord.js");
const { safeFetch } = require("../../core/utils/safeFetch");
const { truncate } = require("../../core/utils/common");

const PUSH_EVENTS = [
  "ticket:created", "ticket:closed", "suggestion:created", "giveaway:ended", "appeal:created", "report:created",
  "announcement:sent", "starboard:posted", "application:submitted", "member:banned", "member:kicked", "levels:levelUp"
];
const MAX_POSTS_PER_POLL = 5;
const SEEN_KEEP = 100;
const BATCH = 20;
const MAX_FAILS = 10;

/**
 * التكاملات: اشتراكات لكل سيرفر في مزوّدات خارجية.
 *
 *  - feed   : عناصر جديدة (يُنشر الجديد فقط؛ أول فحص يسجّل الموجود دون نشر)
 *  - status : تغيّر حالة (تشغيل/إيقاف، بث مباشر، تحديث لعبة)
 *  - push   : Webhook صادر لأحداث البوت، موقّع بـ HMAC-SHA256 إن حُدد سر
 *
 * الفحص دفعات صغيرة عبر المجدول، مع تراجع أُسّي عند الفشل وتعطيل تلقائي بعد
 * فشل متكرر، وكل الطلبات عبر safeFetch (حماية SSRF، مهلة، حد حجم).
 */
class IntegrationService {
  constructor(app) {
    this.app = app;
    this.providers = new Map();
    for (const list of [require("./providers/feeds"), require("./providers/status"), require("./providers/custom")]) {
      for (const p of list) this.providers.set(p.key, p);
    }
    this.http = (url, opts = {}) => safeFetch(url, { timeoutMs: 8000, maxBytes: 512 * 1024, ...opts });
    this.pushCache = new Map(); // guildId -> subs[]
    this.polling = false;
  }

  static get PUSH_EVENTS() {
    return PUSH_EVENTS;
  }

  config(guildId) {
    return { maxSubscriptions: 25, minIntervalMinutes: 5, ...(this.app.guildConfig.value(guildId, "integrations") || {}) };
  }

  available(key) {
    const p = this.providers.get(key);
    return !!p && (typeof p.available !== "function" || p.available());
  }

  _row(r) {
    if (!r) return null;
    const parse = (v, d) => {
      try {
        return JSON.parse(v || "");
      } catch {
        return d;
      }
    };
    return { ...r, options: parse(r.options, {}), state: parse(r.state, {}) };
  }

  get(guildId, id) {
    return this._row(this.app.db.prepare("SELECT * FROM integration_subs WHERE guild_id = ? AND id = ?").get(guildId, id));
  }

  list(guildId) {
    return this.app.db.prepare("SELECT * FROM integration_subs WHERE guild_id = ? ORDER BY id").all(guildId).map((r) => this._row(r));
  }

  add(guild, member, { provider, source, channel = null, role = null, intervalMinutes = null, template = null, options = {} }) {
    const p = this.providers.get(provider);
    if (!p) return { ok: false, reason: "unknownProvider" };
    if (!this.available(provider)) return { ok: false, reason: "unavailable" };
    const cfg = this.config(guild.id);
    if (this.list(guild.id).length >= cfg.maxSubscriptions) return { ok: false, reason: "max" };
    const norm = p.normalize(source, options);
    if (!norm.ok) return norm;
    if (p.kind !== "push") {
      if (!channel?.send) return { ok: false, reason: "channel" };
      const perms = channel.permissionsFor?.(guild.members.me);
      if (perms && !perms.has(PermissionFlagsBits.SendMessages)) return { ok: false, reason: "noSend" };
    }
    const minutes = Math.max(cfg.minIntervalMinutes, intervalMinutes || 10);
    const info = this.app.db
      .prepare(
        `INSERT INTO integration_subs (guild_id, provider, source, options, channel_id, mention_role_id, template, interval_ms, state, next_check_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`
      )
      .run(guild.id, provider, norm.source, JSON.stringify(norm.options || options || {}), channel?.id || null, role?.id || null, template ? String(template).slice(0, 500) : null, minutes * 60_000, Date.now(), member.id, Date.now());
    this.pushCache.delete(guild.id);
    return { ok: true, id: Number(info.lastInsertRowid) };
  }

  remove(guildId, id) {
    const ok = this.app.db.prepare("DELETE FROM integration_subs WHERE guild_id = ? AND id = ?").run(guildId, id).changes === 1;
    this.pushCache.delete(guildId);
    return ok;
  }

  toggle(guildId, id) {
    const sub = this.get(guildId, id);
    if (!sub) return null;
    this.app.db.prepare("UPDATE integration_subs SET enabled = ?, fail_count = 0, next_check_at = ? WHERE id = ?").run(sub.enabled ? 0 : 1, Date.now(), id);
    this.pushCache.delete(guildId);
    return !sub.enabled;
  }

  // ---------------- الفحص الدوري ----------------

  async poll(now = Date.now()) {
    if (this.polling) return 0;
    this.polling = true;
    try {
      const due = this.app.db
        .prepare("SELECT * FROM integration_subs WHERE enabled = 1 AND provider != 'webhook' AND next_check_at <= ? ORDER BY next_check_at LIMIT ?")
        .all(now, BATCH).map((r) => this._row(r));
      for (const sub of due) {
        if (!this.app.features.isEnabled(sub.guild_id, "integrations")) {
          this._reschedule(sub, now, null);
          continue;
        }
        await this.check(sub, now).catch((err) => this._fail(sub, err, now));
      }
      return due.length;
    } finally {
      this.polling = false;
    }
  }

  _reschedule(sub, now, state) {
    this.app.db
      .prepare("UPDATE integration_subs SET state = COALESCE(?, state), fail_count = 0, last_error = NULL, last_checked_at = ?, next_check_at = ? WHERE id = ?")
      .run(state ? JSON.stringify(state) : null, now, now + sub.interval_ms, sub.id);
  }

  async _fail(sub, err, now) {
    const fails = sub.fail_count + 1;
    const backoff = Math.min(sub.interval_ms * 2 ** Math.min(fails, 6), 6 * 3_600_000);
    const disable = fails >= MAX_FAILS;
    this.app.db
      .prepare("UPDATE integration_subs SET fail_count = ?, last_error = ?, last_checked_at = ?, next_check_at = ?, enabled = ? WHERE id = ?")
      .run(fails, truncate(String(err?.message || err), 300), now, now + backoff, disable ? 0 : sub.enabled, sub.id);
    this.app.logger.debug(`تكامل #${sub.id} (${sub.provider}) فشل: ${err?.message}`);
    if (disable) {
      const t = this.app.i18n.forGuild(sub.guild_id);
      await this.app.notifications.notify({ guildId: sub.guild_id, targets: ["admin"], payload: { content: `⚠️ ${t("intg.autoDisabled", { id: sub.id, provider: sub.provider, error: truncate(String(err?.message || ""), 200) })}` } }).catch(() => {});
    }
  }

  /** فحص اشتراك واحد: يرجع ما نُشر. */
  async check(sub, now = Date.now()) {
    const provider = this.providers.get(sub.provider);
    if (!provider || !this.available(sub.provider)) throw new Error("provider unavailable");
    const result = await provider.fetch(sub, this.http);
    const posts = [];
    let state;
    if (provider.kind === "feed") {
      const seen = new Set(sub.state.seen || []);
      const items = result.items || [];
      const fresh = sub.state.seeded ? items.filter((i) => !seen.has(i.id)).reverse().slice(-MAX_POSTS_PER_POLL) : [];
      for (const item of fresh) posts.push(this.formatItem(sub, provider, item));
      const ids = [...items.map((i) => i.id), ...(sub.state.seen || [])];
      state = { seeded: true, seen: [...new Set(ids)].slice(0, SEEN_KEEP), title: result.title || sub.state.title || null };
    } else {
      const prev = sub.state.last || null;
      const next = result.state;
      const change = IntegrationService.transition(sub.provider, prev, next);
      if (sub.state.seeded && change) posts.push(this.formatStatus(sub, provider, change, next));
      state = { seeded: true, last: next };
    }
    for (const payload of posts) await this._post(sub, payload);
    this._reschedule(sub, now, state);
    return { posted: posts.length, state };
  }

  /** ما الذي يستحق النشر عند تغيّر الحالة؟ */
  static transition(provider, prev, next) {
    if (!next) return null;
    if (provider === "roblox") return prev?.updated && next.updated && prev.updated !== next.updated ? "updated" : null;
    if (!prev) return null;
    if (!prev.online && next.online) return "online";
    if (prev.online && !next.online) return "offline";
    return null;
  }

  _render(sub, vars, fallback) {
    const text = sub.template || fallback;
    return truncate(text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m)), 1800);
  }

  formatItem(sub, provider, item) {
    const t = this.app.i18n.forGuild(sub.guild_id);
    const content = this._render(sub, { title: item.title, url: item.url || "", author: item.author || "", provider: provider.label, source: sub.source }, `${provider.emoji} ${t("intg.newItem")}`);
    return {
      content,
      embeds: [this.app.theme.embed(sub.guild_id, {
        title: truncate(item.title || item.id, 256),
        url: item.url || undefined,
        description: item.summary ? truncate(item.summary, 300) : undefined,
        image: item.image || undefined,
        footer: `${provider.label}${item.author ? ` • ${item.author}` : ""}`,
        color: "info"
      })]
    };
  }

  formatStatus(sub, provider, change, s) {
    const t = this.app.i18n.forGuild(sub.guild_id);
    const vars = { status: change, players: s.players ?? "", max: s.max ?? "", name: s.name || sub.source, title: s.title || "", game: s.game || "", viewers: s.viewers ?? "", provider: provider.label, source: sub.source };
    const line = t(`intg.change.${change}`, { name: vars.name });
    const url = sub.provider === "twitch" ? `https://twitch.tv/${sub.source}` : sub.provider === "roblox" ? `https://www.roblox.com/games/${sub.source}` : undefined;
    const fields = [];
    if (s.players !== undefined && change !== "offline") fields.push({ name: "👥", value: `${s.players}${s.max ? `/${s.max}` : ""}`, inline: true });
    if (s.game) fields.push({ name: "🎮", value: truncate(s.game, 100), inline: true });
    if (s.viewers !== undefined && change === "online" && sub.provider === "twitch") fields.push({ name: "👀", value: String(s.viewers), inline: true });
    return {
      content: this._render(sub, vars, `${provider.emoji} ${line}`),
      embeds: [this.app.theme.embed(sub.guild_id, { title: truncate(s.title || vars.name, 256), url, fields, color: change === "offline" ? "neutral" : "success", footer: provider.label })]
    };
  }

  async _post(sub, payload) {
    const channel = await this.app.client.channels.fetch(sub.channel_id).catch(() => null);
    if (!channel?.send) throw new Error("channel missing");
    const mention = sub.mention_role_id ? `<@&${sub.mention_role_id}> ` : "";
    await channel.send({ ...payload, content: `${mention}${payload.content || ""}`.slice(0, 2000), allowedMentions: { parse: [], roles: sub.mention_role_id ? [sub.mention_role_id] : [] } });
  }

  /** معاينة بلا تغيير للحالة. */
  async test(sub) {
    const provider = this.providers.get(sub.provider);
    if (!provider || provider.kind === "push") return this.pushTest(sub);
    const result = await provider.fetch(sub, this.http);
    if (provider.kind === "feed") {
      const item = (result.items || [])[0];
      return { ok: true, count: (result.items || []).length, payload: item ? this.formatItem(sub, provider, item) : null };
    }
    return { ok: true, state: result.state, payload: this.formatStatus(sub, provider, result.state.online ? "online" : "offline", result.state) };
  }

  // ---------------- Webhook صادر ----------------

  _pushSubs(guildId) {
    if (!this.pushCache.has(guildId)) {
      this.pushCache.set(guildId, this.app.db.prepare("SELECT * FROM integration_subs WHERE guild_id = ? AND provider = 'webhook' AND enabled = 1").all(guildId).map((r) => this._row(r)));
    }
    return this.pushCache.get(guildId);
  }

  static sign(secret, body) {
    return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  }

  /** يحوّل حمولة الحدث لبيانات قابلة للتسلسل (معرّفات وقيم بسيطة فقط، بلا كائنات ديسكورد). */
  static serialize(payload) {
    const out = {};
    for (const [k, v] of Object.entries(payload || {})) {
      if (v == null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v;
      else if (v.id && (v.user || v.username || v.name || v.guild)) out[`${k}Id`] = v.id;
      else if (typeof v === "object" && !Array.isArray(v)) {
        const flat = {};
        for (const [k2, v2] of Object.entries(v)) if (v2 == null || ["string", "number", "boolean"].includes(typeof v2)) flat[k2] = v2;
        out[k] = flat;
      }
    }
    return out;
  }

  async onEvent(event, payload) {
    const guildId = payload?.guildId || payload?.guild?.id;
    if (!guildId || !this.app.features.isEnabled(guildId, "integrations")) return;
    const subs = this._pushSubs(guildId).filter((s) => (s.options.events || []).includes(event));
    for (const sub of subs) {
      const body = JSON.stringify({ event, guildId, at: new Date().toISOString(), data: IntegrationService.serialize(payload) });
      await this._deliver(sub, body).catch((err) => this._fail(sub, err, Date.now()).then(() => this.pushCache.delete(guildId)));
    }
  }

  async _deliver(sub, body) {
    const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body) };
    if (sub.options.secret) headers["x-signature-256"] = IntegrationService.sign(sub.options.secret, body);
    const res = await this.http(sub.source, { method: "POST", body, headers, maxRedirects: 0 });
    if (!res.ok) throw new Error(`HTTP ${res.status || res.reason}`);
    this.app.db.prepare("UPDATE integration_subs SET fail_count = 0, last_error = NULL, last_checked_at = ? WHERE id = ?").run(Date.now(), sub.id);
  }

  async pushTest(sub) {
    const body = JSON.stringify({ event: "test", guildId: sub.guild_id, at: new Date().toISOString(), data: {} });
    await this._deliver(sub, body);
    return { ok: true, delivered: true };
  }
}

module.exports = IntegrationService;
