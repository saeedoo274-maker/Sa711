const { json, readBody } = require("../http");
const I18n = require("../../i18n/I18n");

const SNOWFLAKE = /^\d{17,20}$/;
const REDACT = /secret|token|password|apikey|api_key|webhook/i;

/**
 * مسارات الإعدادات المسموح تعديلها عبر الـ API، مع نوع كل قيمة.
 * أي مسار غير مذكور يُرفض — لا كتابة عشوائية في إعدادات السيرفر.
 */
const CONFIG_RULES = [
  [/^language$/, { type: "enum", values: () => Object.keys(I18n.SUPPORTED) }],
  [/^prefix$/, { type: "string", min: 1, max: 5, pattern: /^\S+$/ }],
  [/^(welcome|welcome\.goodbye|levels\.levelUp|appeals|suggestions)\.channelId$/, { type: "channel" }],
  [/^logs\.[a-zA-Z]+$/, { type: "channel", nullable: true }],
  [/^staff\.baseRoleId$/, { type: "role", nullable: true }],
  [/^tickets\.categoryId$/, { type: "category", nullable: true }],
  [/^tickets\.cooldownMs$/, { type: "int", min: 0, max: 7 * 86_400_000 }],
  [/^levels\.(messageXpMin|messageXpMax|voiceXpPerMinute|dailyCap)$/, { type: "int", min: 0, max: 100_000 }],
  [/^levels\.cooldownMs$/, { type: "int", min: 0, max: 3_600_000 }],
  [/^economy\.enabled$/, { type: "bool" }],
  [/^welcome\.message$/, { type: "string", min: 0, max: 2000 }]
];

function redact(obj) {
  if (Array.isArray(obj)) return obj.map(redact);
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = REDACT.test(k) && v ? "[redacted]" : redact(v);
  return out;
}

/** يتحقق من تغيير واحد. يُرجع { ok, value } أو { ok:false, error }. */
function validateChange(guild, path, value) {
  const rule = CONFIG_RULES.find(([re]) => re.test(path))?.[1];
  if (!rule) return { ok: false, error: `path not allowed: ${path}` };
  if (value === null && rule.nullable) return { ok: true, value: null };
  switch (rule.type) {
    case "enum":
      return rule.values().includes(value) ? { ok: true, value } : { ok: false, error: `${path}: invalid value` };
    case "string":
      if (typeof value !== "string" || value.length < rule.min || value.length > rule.max || (rule.pattern && !rule.pattern.test(value))) return { ok: false, error: `${path}: invalid string` };
      return { ok: true, value };
    case "int":
      return Number.isInteger(value) && value >= rule.min && value <= rule.max ? { ok: true, value } : { ok: false, error: `${path}: expected integer ${rule.min}-${rule.max}` };
    case "bool":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: `${path}: expected boolean` };
    case "channel":
    case "category": {
      if (typeof value !== "string" || !SNOWFLAKE.test(value)) return { ok: false, error: `${path}: expected channel id` };
      const ch = guild.channels.cache.get(value);
      const okType = rule.type === "category" ? ch?.type === 4 : ch && [0, 5].includes(ch.type);
      return okType ? { ok: true, value } : { ok: false, error: `${path}: channel not found in guild` };
    }
    case "role":
      if (typeof value !== "string" || !SNOWFLAKE.test(value) || !guild.roles.cache.has(value)) return { ok: false, error: `${path}: role not found in guild` };
      return { ok: true, value };
    default:
      return { ok: false, error: "unsupported" };
  }
}

/**
 * يعالج /api/v1/*. auth = { type:"key"|"session", ... } جاهز من WebApp.
 * canAccess(guildId, scope) يُمرَّر من WebApp ويحسم التفويض.
 */
async function handle(app, { req, res, method, parts, query, canAccess }) {
  // parts بعد /api/v1
  if (parts[0] === "health" && method === "GET") return json(res, 200, { ok: true, version: 1 });
  if (parts[0] !== "guilds" || !SNOWFLAKE.test(parts[1] || "")) return json(res, 404, { error: "not_found" });
  const guildId = parts[1];
  const guild = app.client.guilds?.cache?.get(guildId);
  if (!guild) return json(res, 404, { error: "guild_not_found" });
  const route = parts.slice(2).join("/");
  const need = async (scope) => {
    const ok = await canAccess(guildId, scope);
    if (!ok) json(res, 403, { error: "forbidden", scope });
    return ok;
  };

  if (method === "GET" && route === "") {
    if (!(await need("read"))) return;
    return json(res, 200, {
      id: guild.id, name: guild.name, memberCount: guild.memberCount,
      features: app.features.forGuild(guildId).map((f) => ({ name: f.name, enabled: f.enabled }))
    });
  }

  if (route === "config") {
    if (method === "GET") {
      if (!(await need("read"))) return;
      return json(res, 200, { config: redact(app.guildConfig.get(guildId)) });
    }
    if (method === "PATCH") {
      if (!(await need("write:config"))) return;
      const body = await readBody(req);
      if (body.error) return json(res, body.error === "tooLarge" ? 413 : 400, { error: body.error });
      const changes = body.data?.changes;
      if (!changes || typeof changes !== "object" || Array.isArray(changes)) return json(res, 400, { error: "expected { changes: { path: value } }" });
      const entries = Object.entries(changes);
      if (!entries.length || entries.length > 25) return json(res, 400, { error: "1-25 changes per request" });
      const updates = {};
      const errors = [];
      for (const [path, value] of entries) {
        const v = validateChange(guild, path, value);
        if (v.ok) updates[path] = v.value;
        else errors.push(v.error);
      }
      if (errors.length) return json(res, 422, { error: "validation_failed", details: errors });
      app.guildConfig.setMany(guildId, updates);
      app.bus.emitSafe("config:changed", { guildId, guild, source: "api", keys: Object.keys(updates) });
      return json(res, 200, { ok: true, updated: Object.keys(updates) });
    }
  }

  if (route === "features" && method === "GET") {
    if (!(await need("read"))) return;
    return json(res, 200, { features: app.features.forGuild(guildId) });
  }
  if (parts[2] === "features" && parts[3] && method === "PUT") {
    if (!(await need("write:features"))) return;
    if (!app.features.isKnown(parts[3])) return json(res, 404, { error: "unknown_feature" });
    const body = await readBody(req);
    if (body.error) return json(res, 400, { error: body.error });
    if (typeof body.data?.enabled !== "boolean") return json(res, 400, { error: "expected { enabled: boolean }" });
    return json(res, 200, { name: parts[3], enabled: app.features.setForGuild(guildId, parts[3], body.data.enabled) });
  }

  if (route === "stats" && method === "GET") {
    if (!(await need("read"))) return;
    const period = ["today", "7d", "30d", "90d"].includes(query.get("period")) ? query.get("period") : "7d";
    const stats = app.analytics && app.features.isEnabled(guildId, "analytics") ? app.analytics.server(guildId, period) : null;
    return json(res, 200, { period, stats, openTickets: app.db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND status = 'open'").get(guildId).c });
  }

  if (parts[2] === "leaderboard" && method === "GET") {
    if (!(await need("read"))) return;
    const type = parts[3] || "xp";
    if (!app.leaderboards || !app.leaderboards.constructor.TYPES[type]) return json(res, 404, { error: "unknown_type" });
    const page = Math.min(100, Math.max(1, parseInt(query.get("page"), 10) || 1));
    const rows = app.leaderboards.rows(type, guildId, { period: query.get("period") || "all", page }).slice(0, 10);
    return json(res, 200, { type, page, rows: rows.map((r) => ({ userId: r.user_id, score: r.score })) });
  }

  if (route === "cases" && method === "GET") {
    if (!(await need("read:moderation"))) return;
    const userId = query.get("user");
    if (userId && !SNOWFLAKE.test(userId)) return json(res, 400, { error: "invalid user" });
    const limit = Math.min(50, Math.max(1, parseInt(query.get("limit"), 10) || 20));
    const rows = userId ? app.cases.listByTarget(guildId, userId, { limit }) : app.cases.recent(guildId, limit);
    return json(res, 200, { cases: rows.map((c) => ({ number: c.case_number, type: c.type, targetId: c.target_id, moderatorId: c.moderator_id, reason: c.reason, active: !!c.active, createdAt: c.created_at })) });
  }

  if (route === "tickets" && method === "GET") {
    if (!(await need("read:moderation"))) return;
    const status = query.get("status") === "closed" ? "closed" : "open";
    const rows = app.db.prepare("SELECT id, number, owner_id, claimed_by, status, created_at, closed_at FROM tickets WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT 50").all(guildId, status);
    return json(res, 200, { tickets: rows });
  }

  if (parts[2] === "members" && SNOWFLAKE.test(parts[3] || "") && method === "GET") {
    if (!(await need("read"))) return;
    const userId = parts[3];
    const level = app.levels ? app.levels.repo.get(guildId, userId) : null;
    const account = app.economy.get(guildId, userId);
    return json(res, 200, {
      userId,
      level: level ? { xp: level.xp, level: level.level } : null,
      economy: account ? { wallet: account.wallet, bank: account.bank } : null,
      activeWarnings: app.cases.countByTarget(guildId, userId, "warn"),
      reputation: app.socialPlus ? app.socialPlus.reputation(guildId, userId) : null
    });
  }

  return json(res, 404, { error: "not_found" });
}

module.exports = { handle, validateChange, redact, CONFIG_RULES };
