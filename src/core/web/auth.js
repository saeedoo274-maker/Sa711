const crypto = require("node:crypto");
const { sha256, safeEqual } = require("./http");
const { safeFetch } = require("../utils/safeFetch");

const SESSION_TTL = 7 * 86_400_000;
const STATE_TTL = 10 * 60_000;
const SCOPES = ["read", "write:config", "write:features", "read:moderation"];
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;

/**
 * الجلسات: الكوكي يحمل "معرّف.توقيع" (HMAC بـ SESSION_SECRET)، وقاعدة البيانات
 * تحفظ تجزئة المعرّف فقط — تسريب القاعدة لا يكشف جلسات صالحة.
 */
class SessionStore {
  constructor(app) {
    this.app = app;
    this.secret = process.env.SESSION_SECRET || null;
  }

  get enabled() {
    return !!this.secret && this.secret.length >= 32;
  }

  _sign(id) {
    return crypto.createHmac("sha256", this.secret).update(id).digest("base64url");
  }

  create({ user, guilds }) {
    const id = crypto.randomBytes(32).toString("base64url");
    const csrf = crypto.randomBytes(24).toString("base64url");
    const now = Date.now();
    this.app.db
      .prepare("INSERT INTO web_sessions (id_hash, user_id, username, avatar, guilds, csrf, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(sha256(id), user.id, user.username || null, user.avatar || null, JSON.stringify(guilds || []), csrf, now, now + SESSION_TTL, now);
    return { cookieValue: `${id}.${this._sign(id)}`, csrf };
  }

  read(cookieValue) {
    if (!this.enabled || !cookieValue) return null;
    const [id, sig] = String(cookieValue).split(".");
    if (!id || !sig || !safeEqual(sig, this._sign(id))) return null;
    const row = this.app.db.prepare("SELECT * FROM web_sessions WHERE id_hash = ?").get(sha256(id));
    if (!row || row.expires_at < Date.now()) return null;
    if (!row.last_seen || Date.now() - row.last_seen > 60_000) this.app.db.prepare("UPDATE web_sessions SET last_seen = ? WHERE id_hash = ?").run(Date.now(), row.id_hash);
    let guilds = [];
    try {
      guilds = JSON.parse(row.guilds);
    } catch {
      guilds = [];
    }
    return { ...row, guilds };
  }

  destroy(cookieValue) {
    const [id] = String(cookieValue || "").split(".");
    if (id) this.app.db.prepare("DELETE FROM web_sessions WHERE id_hash = ?").run(sha256(id));
  }

  purgeExpired() {
    return this.app.db.prepare("DELETE FROM web_sessions WHERE expires_at < ?").run(Date.now()).changes;
  }
}

/** مفاتيح API: تُعرض مرة واحدة عند الإنشاء، وتُخزَّن تجزئتها فقط. */
class ApiKeys {
  constructor(app) {
    this.app = app;
  }

  static get SCOPES() {
    return SCOPES;
  }

  create(guildId, { name, scopes = ["read"], userId }) {
    const clean = [...new Set(scopes)].filter((s) => SCOPES.includes(s));
    if (!clean.length) return { ok: false, reason: "badScopes" };
    if (this.app.db.prepare("SELECT COUNT(*) AS c FROM api_keys WHERE guild_id = ? AND revoked = 0").get(guildId).c >= 10) return { ok: false, reason: "max" };
    const key = `sk_${crypto.randomBytes(24).toString("base64url")}`;
    const info = this.app.db
      .prepare("INSERT INTO api_keys (guild_id, name, key_hash, prefix, scopes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(guildId, String(name || "key").slice(0, 32), sha256(key), key.slice(0, 10), JSON.stringify(clean), userId, Date.now());
    return { ok: true, id: Number(info.lastInsertRowid), key, scopes: clean };
  }

  verify(raw) {
    if (!raw || !/^sk_[\w-]{20,}$/.test(raw)) return null;
    const row = this.app.db.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0").get(sha256(raw));
    if (!row) return null;
    if (!row.last_used_at || Date.now() - row.last_used_at > 60_000) this.app.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(Date.now(), row.id);
    return { ...row, scopes: JSON.parse(row.scopes) };
  }

  list(guildId) {
    return this.app.db.prepare("SELECT id, name, prefix, scopes, created_by, created_at, last_used_at FROM api_keys WHERE guild_id = ? AND revoked = 0 ORDER BY id").all(guildId);
  }

  revoke(guildId, id) {
    return this.app.db.prepare("UPDATE api_keys SET revoked = 1 WHERE guild_id = ? AND id = ? AND revoked = 0").run(guildId, id).changes === 1;
  }
}

/**
 * Discord OAuth2 (authorization code). state عشوائي قصير العمر يمنع CSRF على الرجوع.
 * الطلبات عبر safeFetch. لا يُخزَّن access_token بعد جلب البيانات.
 */
class DiscordOAuth {
  constructor(app) {
    this.app = app;
    this.states = new Map();
    this.fetch = (url, opts) => safeFetch(url, { timeoutMs: 8000, maxBytes: 512 * 1024, json: true, ...opts });
  }

  get configured() {
    return !!(process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.DASHBOARD_URL);
  }

  get redirectUri() {
    return `${String(process.env.DASHBOARD_URL).replace(/\/$/, "")}/auth/callback`;
  }

  authorizeUrl() {
    const now = Date.now();
    for (const [k, v] of this.states) if (now - v > STATE_TTL) this.states.delete(k);
    if (this.states.size > 10_000) this.states.clear();
    const state = crypto.randomBytes(16).toString("base64url");
    this.states.set(state, now);
    const q = new URLSearchParams({ client_id: process.env.CLIENT_ID, response_type: "code", scope: "identify guilds", redirect_uri: this.redirectUri, state, prompt: "none" });
    return { url: `https://discord.com/oauth2/authorize?${q}`, state };
  }

  consumeState(state) {
    const at = this.states.get(state);
    this.states.delete(state);
    return !!at && Date.now() - at <= STATE_TTL;
  }

  async exchange(code) {
    const body = new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: this.redirectUri }).toString();
    const tok = await this.fetch("https://discord.com/api/v10/oauth2/token", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) } });
    if (!tok.ok || !tok.json?.access_token) return null;
    const auth = { authorization: `Bearer ${tok.json.access_token}` };
    const [user, guilds] = await Promise.all([
      this.fetch("https://discord.com/api/v10/users/@me", { headers: auth }),
      this.fetch("https://discord.com/api/v10/users/@me/guilds", { headers: auth })
    ]);
    if (!user.ok || !guilds.ok) return null;
    // نحفظ فقط السيرفرات التي يملك فيها صلاحية الإدارة
    const managed = (Array.isArray(guilds.json) ? guilds.json : [])
      .filter((g) => g.owner || (BigInt(g.permissions || 0) & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n)
      .slice(0, 200)
      .map((g) => ({ id: g.id, name: String(g.name).slice(0, 100), icon: g.icon || null }));
    return { user: { id: user.json.id, username: user.json.global_name || user.json.username, avatar: user.json.avatar || null }, guilds: managed };
  }
}

module.exports = { SessionStore, ApiKeys, DiscordOAuth, SCOPES };
