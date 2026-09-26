const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-123456";
process.env.CLIENT_ID = "111111111111111111";
process.env.CLIENT_SECRET = "test-client-secret";
process.env.DASHBOARD_URL = "http://localhost:3000";
const H = require("../helpers/harness");

test("لوحة التحكم و REST API v1", async (t) => {
  const app = await H.createApp();
  const guild = H.fakeGuild();
  guild.name = "<script>alert(1)</script> Guild";
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app, name: "general" });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const alice = H.fakeMember(guild, "700000000000000007");
  const other = H.fakeGuild("200000000000000099");
  app.client.guilds.cache.set(other.id, other);

  const server = http.createServer((req, res) => app.web.handle(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    server.close();
    H.cleanup(app);
  });
  const call = (path, { method = "GET", headers = {}, body = null } = {}) =>
    fetch(`${base}${path}`, { method, headers, body, redirect: "manual" });

  const created = app.web.keys.create(guild.id, { name: "ro", scopes: ["read"], userId: admin.id });
  const rw = app.web.keys.create(guild.id, { name: "rw", scopes: ["read", "write:config", "write:features", "read:moderation"], userId: admin.id });
  const auth = (k) => ({ authorization: `Bearer ${k}` });

  await t.test("API: الصحة، الإصدارات، والمصادقة", async () => {
    let r = await call("/api/v1/health");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-api-version"), "1");
    assert.equal((await call("/api/v2/health")).status, 404);
    assert.equal((await call(`/api/v1/guilds/${guild.id}`)).status, 401);
    assert.equal((await call(`/api/v1/guilds/${guild.id}`, { headers: auth("sk_invalidinvalidinvalidinvalid") })).status, 401);
    r = await call(`/api/v1/guilds/${guild.id}`, { headers: auth(created.key) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).id, guild.id);
    assert.equal((await call(`/api/v1/guilds/${other.id}`, { headers: auth(created.key) })).status, 403, "المفتاح مقيّد بسيرفره");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
  });

  await t.test("API: الصلاحيات والتحقق من تعديلات الإعدادات", async () => {
    const patch = (key, changes) => call(`/api/v1/guilds/${guild.id}/config`, { method: "PATCH", headers: { ...auth(key), "content-type": "application/json" }, body: JSON.stringify({ changes }) });
    assert.equal((await patch(created.key, { language: "en" })).status, 403, "مفتاح القراءة لا يعدّل");
    let r = await patch(rw.key, { "security.antiRaid": true });
    assert.equal(r.status, 422);
    assert.match(JSON.stringify(await r.json()), /not allowed/);
    r = await patch(rw.key, { "welcome.channelId": "123456789012345678" });
    assert.equal(r.status, 422, "قناة من خارج السيرفر");
    r = await patch(rw.key, { language: "en", "welcome.channelId": general.id, "tickets.cooldownMs": 60000 });
    assert.equal(r.status, 200);
    assert.equal(app.guildConfig.value(guild.id, "language"), "en");
    assert.equal(app.guildConfig.value(guild.id, "welcome.channelId"), general.id);
    r = await call(`/api/v1/guilds/${guild.id}/config`, { method: "PATCH", headers: { ...auth(rw.key), "content-type": "application/json" }, body: "{bad" });
    assert.equal(r.status, 400);
    r = await call(`/api/v1/guilds/${guild.id}/config`, { method: "PATCH", headers: { ...auth(rw.key), "content-type": "application/json" }, body: JSON.stringify({ changes: { x: "a".repeat(200_000) } }) });
    assert.equal(r.status, 413);
  });

  await t.test("API: إخفاء الأسرار، الأنظمة، الأعضاء، القضايا", async () => {
    app.guildConfig.set(guild.id, "custom.webhookUrl", "https://discord.com/api/webhooks/secret");
    let r = await call(`/api/v1/guilds/${guild.id}/config`, { headers: auth(created.key) });
    const cfg = (await r.json()).config;
    assert.equal(cfg.custom.webhookUrl, "[redacted]");
    r = await call(`/api/v1/guilds/${guild.id}/features/search`, { method: "PUT", headers: { ...auth(rw.key), "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    assert.equal((await r.json()).enabled, false);
    app.features.setForGuild(guild.id, "search", null);
    app.cases.create({ guildId: guild.id, type: "warn", targetId: alice.id, moderatorId: admin.id, reason: "x" });
    assert.equal((await call(`/api/v1/guilds/${guild.id}/cases`, { headers: auth(created.key) })).status, 403, "القضايا تحتاج read:moderation");
    r = await call(`/api/v1/guilds/${guild.id}/cases?user=${alice.id}`, { headers: auth(rw.key) });
    assert.equal((await r.json()).cases.length, 1);
    r = await call(`/api/v1/guilds/${guild.id}/members/${alice.id}`, { headers: auth(created.key) });
    assert.equal((await r.json()).activeWarnings, 1);
    assert.equal((await call(`/api/v1/guilds/${guild.id}/cases?user=abc`, { headers: auth(rw.key) })).status, 400);
  });

  await t.test("API: حد المعدل لكل مفتاح", async () => {
    const k = app.web.keys.create(guild.id, { name: "rl", scopes: ["read"], userId: admin.id });
    app.web.keyLimiter.limit = 3;
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await call(`/api/v1/guilds/${guild.id}`, { headers: auth(k.key) })).status);
    assert.deepEqual(codes, [200, 200, 200, 429]);
    app.web.keyLimiter.limit = 60;
  });

  const sessionFor = (member) => app.web.sessions.create({ user: { id: member.id, username: member.user.username }, guilds: [{ id: guild.id, name: guild.name }] });

  await t.test("اللوحة: الدخول، التفويض الحي، CSRF، وحفظ الأنظمة", async () => {
    let r = await call("/dashboard");
    assert.match(await r.text(), /تسجيل الدخول/);
    const s = sessionFor(admin);
    const cookieHeader = { cookie: `sid=${encodeURIComponent(s.cookieValue)}` };
    r = await call("/dashboard", { headers: cookieHeader });
    const list = await r.text();
    assert.match(list, /&lt;script&gt;/, "اسم السيرفر مُهرّب");
    assert.doesNotMatch(list, /<script>alert/);
    r = await call(`/dashboard/${guild.id}`, { headers: cookieHeader });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-security-policy"), /nonce-/);
    r = await call(`/dashboard/${guild.id}/features`, { method: "POST", headers: { ...cookieHeader, "content-type": "application/x-www-form-urlencoded" }, body: "f_search=on" });
    assert.equal(r.status, 403, "بلا CSRF");
    const form = new URLSearchParams({ csrf: s.csrf });
    for (const f of app.features.forGuild(guild.id)) if (f.enabled && f.name !== "games") form.set(`f_${f.name}`, "on");
    r = await call(`/dashboard/${guild.id}/features`, { method: "POST", headers: { ...cookieHeader, "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
    assert.equal(r.status, 200);
    assert.equal(app.features.isEnabled(guild.id, "games"), false);
    r = await call(`/dashboard/${guild.id}/settings`, { method: "POST", headers: { ...cookieHeader, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf: s.csrf, "logs.members": "999999999999999999" }).toString() });
    assert.equal(r.status, 422);
    r = await call(`/dashboard/${guild.id}?tab=settings`, { headers: cookieHeader });
    assert.match(await r.text(), /#general/);
  });

  await t.test("اللوحة: عضو بلا صلاحية، كوكي معدّل، وسيرفر ليس في الجلسة", async () => {
    const s = sessionFor(alice);
    let r = await call(`/dashboard/${guild.id}`, { headers: { cookie: `sid=${encodeURIComponent(s.cookieValue)}` } });
    assert.equal(r.status, 403);
    const good = sessionFor(admin);
    r = await call("/dashboard", { headers: { cookie: `sid=${encodeURIComponent(good.cookieValue.replace(/.$/, "x"))}` } });
    assert.match(await r.text(), /تسجيل الدخول/);
    r = await call(`/dashboard/${other.id}`, { headers: { cookie: `sid=${encodeURIComponent(good.cookieValue)}` } });
    assert.equal(r.status, 403);
    r = await call(`/api/v1/guilds/${guild.id}/config`, { method: "PATCH", headers: { cookie: `sid=${encodeURIComponent(good.cookieValue)}`, "content-type": "application/json" }, body: JSON.stringify({ changes: { language: "ar" } }) });
    assert.equal(r.status, 403, "API بالجلسة تحتاج X-CSRF-Token");
    r = await call(`/api/v1/guilds/${guild.id}/config`, { method: "PATCH", headers: { cookie: `sid=${encodeURIComponent(good.cookieValue)}`, "x-csrf-token": good.csrf, "content-type": "application/json" }, body: JSON.stringify({ changes: { language: "ar" } }) });
    assert.equal(r.status, 200);
  });

  await t.test("OAuth: state مطلوب وصالح لمرة واحدة، والخروج يتطلب CSRF", async () => {
    let r = await call("/auth/login");
    assert.equal(r.status, 302);
    const loc = new URL(r.headers.get("location"));
    assert.equal(loc.hostname, "discord.com");
    const state = loc.searchParams.get("state");
    assert.equal((await call("/auth/callback?code=x&state=forged")).status, 400);
    app.web.oauth.exchange = async () => ({ user: { id: admin.id, username: "admin" }, guilds: [{ id: guild.id, name: "g" }] });
    r = await call(`/auth/callback?code=abc&state=${state}`);
    assert.equal(r.status, 302);
    const setCookie = r.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.equal((await call(`/auth/callback?code=abc&state=${state}`)).status, 400, "state لا يُعاد استخدامه");
    const sid = decodeURIComponent(setCookie.match(/sid=([^;]+)/)[1]);
    r = await call("/auth/logout", { method: "POST", headers: { cookie: `sid=${encodeURIComponent(sid)}`, "content-type": "application/x-www-form-urlencoded" }, body: "csrf=wrong" });
    assert.ok(app.web.sessions.read(sid), "بلا CSRF صحيح لا تُحذف الجلسة");
  });
});
