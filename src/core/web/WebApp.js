const crypto = require("node:crypto");
const { json, html, redirect, readBody, parseCookies, cookie, safeEqual, RateLimiter, clientIp } = require("./http");
const { SessionStore, ApiKeys, DiscordOAuth } = require("./auth");
const apiV1 = require("./api/v1");
const views = require("./dashboard/views");
const I18n = require("../i18n/I18n");
const { Level } = require("../permissions/PermissionService");

const SNOWFLAKE = /^\d{17,20}$/;
const ACCESS_CACHE_MS = 60_000;

/**
 * تطبيق الويب: لوحة التحكم + REST API v1 على نفس خادم HTTP الموجود.
 *
 * الأمان:
 *  - الجلسات موقّعة HMAC (SESSION_SECRET ≥ 32 حرفًا وإلا تتعطل اللوحة)، والقاعدة تحفظ تجزئتها فقط
 *  - كل طلب POST في اللوحة يحمل رمز CSRF مربوطًا بالجلسة، وطلبات الـ API بالجلسة تحتاج X-CSRF-Token
 *  - التفويض يُعاد فحصه حيًا: عضو في السيرفر بمستوى أدمن (لا الاكتفاء ببيانات OAuth المخزنة)
 *  - مفاتيح API مقيّدة بسيرفر واحد وبصلاحيات (scopes)، ومخزّنة كتجزئة
 *  - حدود معدل لكل IP ولكل مفتاح، وحد لحجم الجسم، وترويسات أمان وCSP مع nonce
 */
class WebApp {
  constructor(app) {
    this.app = app;
    this.sessions = new SessionStore(app);
    this.keys = new ApiKeys(app);
    this.oauth = new DiscordOAuth(app);
    this.ipLimiter = new RateLimiter({ limit: 120, windowMs: 60_000 });
    this.keyLimiter = new RateLimiter({ limit: 60, windowMs: 60_000 });
    this.access = new Map(); // `${userId}:${guildId}` -> { ok, at }
    this.secure = String(process.env.DASHBOARD_URL || "").startsWith("https://");
    this.title = app.config?.bot?.name || "Dashboard";
  }

  handles(path) {
    return path === "/dashboard" || path.startsWith("/dashboard/") || path.startsWith("/auth/") || path.startsWith("/api/");
  }

  async handle(req, res) {
    const url = new URL(req.url || "/", "http://local");
    const path = url.pathname;
    const method = req.method || "GET";
    const limit = this.ipLimiter.take(`ip:${clientIp(req)}`);
    if (!limit.ok) return json(res, 429, { error: "rate_limited" }, { "Retry-After": Math.ceil(limit.resetMs / 1000) });
    try {
      if (path.startsWith("/api/")) return await this._api(req, res, method, path, url.searchParams);
      if (path.startsWith("/auth/")) return await this._auth(req, res, method, path, url.searchParams);
      return await this._dashboard(req, res, method, path, url.searchParams);
    } catch (error) {
      this.app.errors?.capture(error, { system: "web" });
      return json(res, 500, { error: "internal_error" });
    }
  }

  _session(req) {
    return this.sessions.read(parseCookies(req).sid);
  }

  /** هل يستطيع صاحب الجلسة إدارة هذا السيرفر الآن؟ (فحص حي مع كاش قصير) */
  async canManage(session, guildId) {
    if (!session || !session.guilds.some((g) => g.id === guildId)) return false;
    const guild = this.app.client.guilds?.cache?.get(guildId);
    if (!guild) return false;
    const key = `${session.user_id}:${guildId}`;
    const hit = this.access.get(key);
    if (hit && Date.now() - hit.at < ACCESS_CACHE_MS) return hit.ok;
    const member = await guild.members.fetch(session.user_id).catch(() => null);
    const ok = !!member && this.app.permissions.resolveLevel(member) >= Level.ADMIN;
    if (this.access.size > 10_000) this.access.clear();
    this.access.set(key, { ok, at: Date.now() });
    return ok;
  }

  // ---------------- REST API ----------------

  async _api(req, res, method, path, query) {
    res.setHeader("X-API-Version", "1");
    const parts = path.split("/").filter(Boolean); // ["api","v1",...]
    if (parts[1] !== "v1") return json(res, 404, { error: "unsupported_version", supported: ["v1"] });
    const rest = parts.slice(2);
    if (rest[0] === "health") return apiV1.handle(this.app, { req, res, method, parts: rest, query, canAccess: async () => true });

    const header = String(req.headers.authorization || "");
    let canAccess;
    if (header.startsWith("Bearer ")) {
      const key = this.keys.verify(header.slice(7).trim());
      if (!key) return json(res, 401, { error: "invalid_key" });
      const rl = this.keyLimiter.take(`key:${key.id}`);
      res.setHeader("X-RateLimit-Remaining", rl.remaining);
      if (!rl.ok) return json(res, 429, { error: "rate_limited" }, { "Retry-After": Math.ceil(rl.resetMs / 1000) });
      canAccess = async (guildId, scope) => key.guild_id === guildId && (key.scopes.includes(scope) || (scope === "read" && key.scopes.some((s) => s.startsWith("write:"))));
    } else {
      const session = this._session(req);
      if (!session) return json(res, 401, { error: "unauthorized" });
      if (method !== "GET" && !safeEqual(req.headers["x-csrf-token"], session.csrf)) return json(res, 403, { error: "csrf" });
      canAccess = (guildId) => this.canManage(session, guildId);
    }
    return apiV1.handle(this.app, { req, res, method, parts: rest, query, canAccess });
  }

  // ---------------- الدخول ----------------

  async _auth(req, res, method, path, query) {
    if (!this.sessions.enabled || !this.oauth.configured) return json(res, 503, { error: "dashboard_not_configured" });
    if (path === "/auth/login" && method === "GET") return redirect(res, this.oauth.authorizeUrl().url);
    if (path === "/auth/callback" && method === "GET") {
      const code = query.get("code");
      const state = query.get("state");
      if (!code || !state || !this.oauth.consumeState(state)) return this._error(res, 400, "طلب دخول غير صالح أو منتهي.");
      const data = await this.oauth.exchange(code);
      if (!data) return this._error(res, 401, "تعذّر التحقق من الحساب.");
      const { cookieValue } = this.sessions.create(data);
      this.app.logger.info(`دخول لوحة التحكم: ${data.user.id}`);
      return redirect(res, "/dashboard", { "Set-Cookie": cookie("sid", cookieValue, { maxAge: 7 * 86400, secure: this.secure }) });
    }
    if (path === "/auth/logout" && method === "POST") {
      const session = this._session(req);
      const body = await readBody(req);
      if (session && safeEqual(body.data?.csrf, session.csrf)) this.sessions.destroy(parseCookies(req).sid);
      return redirect(res, "/dashboard", { "Set-Cookie": cookie("sid", "", { maxAge: 0, secure: this.secure }) });
    }
    return json(res, 404, { error: "not_found" });
  }

  // ---------------- اللوحة ----------------

  _error(res, code, text) {
    const nonce = crypto.randomBytes(16).toString("base64");
    return html(res, code, views.errorPage({ nonce, title: this.title, code, text }), nonce);
  }

  async _dashboard(req, res, method, path, query) {
    const nonce = crypto.randomBytes(16).toString("base64");
    const session = this._session(req);
    if (!session) return html(res, 200, views.loginPage({ nonce, configured: this.sessions.enabled && this.oauth.configured, title: this.title }), nonce);
    const parts = path.split("/").filter(Boolean); // ["dashboard", guildId?, action?]
    if (parts.length === 1) {
      const guilds = session.guilds.map((g) => ({ ...g, present: !!this.app.client.guilds?.cache?.has(g.id) }));
      return html(res, 200, views.guildList({ nonce, session, csrf: session.csrf, guilds, title: this.title }), nonce);
    }
    const guildId = parts[1];
    if (!SNOWFLAKE.test(guildId) || !(await this.canManage(session, guildId))) return this._error(res, 403, "لا تملك صلاحية إدارة هذا السيرفر.");
    const guild = this.app.client.guilds.cache.get(guildId);

    let message = null;
    if (method === "POST") {
      const body = await readBody(req);
      if (body.error || !safeEqual(body.data?.csrf, session.csrf)) return this._error(res, 403, "انتهت صلاحية النموذج، أعد المحاولة.");
      message = parts[2] === "features" ? this._saveFeatures(guildId, body.data) : parts[2] === "settings" ? this._saveSettings(guild, body.data) : { ok: false, text: "?" };
      this.app.logger.info(`لوحة التحكم: ${session.user_id} عدّل ${parts[2]} في ${guildId}`);
    }
    const tab = method === "POST" ? parts[2] : ["overview", "features", "settings", "leaderboard", "cases"].includes(query.get("tab")) ? query.get("tab") : "overview";
    const data = this._tabData(guild, tab);
    return html(res, message && !message.ok ? 422 : 200, views.guildPage({ nonce, session, csrf: session.csrf, title: this.title, guild, tab, data, message }), nonce);
  }

  _saveFeatures(guildId, form) {
    const updates = {};
    for (const f of this.app.features.list()) {
      const want = form[`f_${f.name}`] === "on";
      if (want !== this.app.features.isEnabled(guildId, f.name)) updates[`features.${f.name}`] = want;
    }
    if (Object.keys(updates).length) this.app.guildConfig.setMany(guildId, updates);
    return { ok: true, text: `تم الحفظ (${Object.keys(updates).length} تغيير).` };
  }

  _saveSettings(guild, form) {
    const updates = {};
    const errors = [];
    for (const path of ["language", "welcome.channelId", "staff.baseRoleId", "tickets.categoryId", "logs.messages", "logs.members", "logs.moderation"]) {
      if (!(path in form)) continue;
      const raw = form[path] === "" ? null : form[path];
      if (raw === null && path === "language") continue;
      const v = apiV1.validateChange(guild, path, raw);
      if (v.ok) updates[path] = v.value;
      else if (raw !== null) errors.push(v.error);
      else updates[path] = null;
    }
    if (errors.length) return { ok: false, text: errors.join(" • ") };
    this.app.guildConfig.setMany(guild.id, updates);
    return { ok: true, text: "تم حفظ الإعدادات." };
  }

  _tabData(guild, tab) {
    const gid = guild.id;
    if (tab === "overview") {
      return {
        stats: this.app.analytics && this.app.features.isEnabled(gid, "analytics") ? this.app.analytics.server(gid, "30d") : null,
        openTickets: this.app.db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND status = 'open'").get(gid).c,
        cases30: this.app.db.prepare("SELECT COUNT(*) AS c FROM cases WHERE guild_id = ? AND created_at >= ?").get(gid, Date.now() - 30 * 86_400_000).c
      };
    }
    if (tab === "features") return { features: this.app.features.forGuild(gid) };
    if (tab === "settings") {
      const channels = [...guild.channels.cache.values()];
      return {
        config: this.app.guildConfig.get(gid),
        languages: Object.keys(I18n.SUPPORTED),
        textChannels: channels.filter((c) => [0, 5].includes(c.type)).map((c) => ({ id: c.id, name: `#${c.name}` })),
        categories: channels.filter((c) => c.type === 4).map((c) => ({ id: c.id, name: c.name })),
        roles: [...guild.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed).map((r) => ({ id: r.id, name: `@${r.name}` }))
      };
    }
    if (tab === "leaderboard") {
      const rows = this.app.leaderboards ? this.app.leaderboards.rows("xp", gid, { page: 1 }).slice(0, 10) : [];
      return { rows: rows.map((r) => ({ name: guild.members.cache.get(r.user_id)?.displayName || r.user_id, score: r.score })) };
    }
    if (tab === "cases") return { cases: this.app.cases.recent(gid, 20) };
    return {};
  }
}

module.exports = WebApp;
