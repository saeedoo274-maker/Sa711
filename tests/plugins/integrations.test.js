const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const H = require("../helpers/harness");
const IntegrationService = require("../../src/plugins/integrations/IntegrationService");

test("التكاملات", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const feedCh = H.fakeChannel(guild, "400000000000000013", { app });
  const adminCh = H.fakeChannel(guild, "400000000000000014", { app });
  app.guildConfig.set(guild.id, "notifications.adminChannelId", adminCh.id);
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const alice = H.fakeMember(guild, "700000000000000007");
  const role = H.fakeRole("896000000000000001");

  const responses = new Map();
  const calls = [];
  app.integrations.http = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = responses.get(url);
    if (!r) return { ok: false, reason: "network" };
    if (typeof r === "function") return r(opts);
    return { ok: true, status: 200, body: r.body, json: r.json };
  };
  const rss = (items) => ({ body: `<rss><channel><title>Blog</title>${items.map((i) => `<item><title>${i}</title><link>https://blog.example.com/${i}</link><guid>${i}</guid></item>`).join("")}</channel></rss>` });

  const cmd = async (sub, options = {}, member = admin) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(member, general, { command: "ادارة", group: "integration", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };

  await t.test("التحقق: روابط داخلية مرفوضة، صيغ المزوّدات، وTwitch بلا مفاتيح", async () => {
    assert.match(H.textOf((await cmd("add", { provider: "rss", source: "https://127.0.0.1/feed" })).replies), /https عامًا/);
    assert.match(H.textOf((await cmd("add", { provider: "rss", source: "http://example.com/feed" })).replies), /https عامًا/);
    assert.match(H.textOf((await cmd("add", { provider: "youtube", source: "abc" })).replies), /UC/);
    assert.match(H.textOf((await cmd("add", { provider: "github", source: "not a repo" })).replies), /owner\/repo/);
    delete process.env.TWITCH_CLIENT_ID;
    assert.match(H.textOf((await cmd("add", { provider: "twitch", source: "someone" })).replies), /TWITCH_CLIENT_ID/);
    assert.match(H.textOf((await cmd("add", { provider: "rss", source: "https://blog.example.com/feed" }, alice)).replies), /صلاحي/);
  });

  await t.test("خلاصة RSS: أول فحص لا ينشر، ثم يُنشر الجديد فقط مع المنشن", async () => {
    responses.set("https://blog.example.com/feed", rss(["a2", "a1"]));
    await cmd("add", { provider: "rss", source: "https://blog.example.com/feed", channel: feedCh, role, template: "📰 {title} — {url}" });
    const sub = app.integrations.list(guild.id)[0];
    await app.integrations.poll();
    assert.equal(feedCh.sent.length, 0, "البذر بلا نشر");
    responses.set("https://blog.example.com/feed", rss(["a4", "a3", "a2", "a1"]));
    await app.integrations.poll(Date.now() + 11 * 60_000);
    assert.equal(feedCh.sent.length, 2);
    assert.match(feedCh.sent[0].payload.content, /a3 — https:\/\/blog\.example\.com\/a3/, "الأقدم أولًا");
    assert.match(feedCh.sent[0].payload.content, new RegExp(`<@&${role.id}>`));
    assert.deepEqual(feedCh.sent[0].payload.allowedMentions.roles, [role.id]);
    await app.integrations.poll(Date.now() + 22 * 60_000);
    assert.equal(feedCh.sent.length, 2, "لا تكرار");
    assert.ok(app.integrations.get(guild.id, sub.id).state.seen.includes("a4"));
  });

  await t.test("حالة Minecraft: ينشر عند التحول فقط", async () => {
    let online = false;
    responses.set("https://api.mcsrvstat.us/3/play.example.com", () => ({ ok: true, status: 200, json: { online, players: { online: online ? 12 : 0, max: 100 } } }));
    await cmd("add", { provider: "minecraft", source: "play.example.com", channel: feedCh });
    const before = feedCh.sent.length;
    const base = Date.now() + 60 * 60_000;
    await app.integrations.poll(base);
    online = true;
    await app.integrations.poll(base + 11 * 60_000);
    assert.equal(feedCh.sent.length, before + 1);
    assert.match(H.textOf([feedCh.sent.at(-1).payload]), /متصل الآن/);
    await app.integrations.poll(base + 22 * 60_000);
    assert.equal(feedCh.sent.length, before + 1, "لا نشر بدون تغيّر");
  });

  await t.test("الفشل: تراجع أُسّي ثم تعطيل تلقائي مع إشعار الإدارة", async () => {
    await cmd("add", { provider: "steam", source: "730", channel: feedCh });
    const sub = app.integrations.list(guild.id).find((s) => s.provider === "steam");
    let now = Date.now() + 2 * 3_600_000;
    for (let n = 0; n < 10; n++) {
      await app.integrations.check(sub.id && app.integrations.get(guild.id, sub.id), now).catch((err) => app.integrations._fail(app.integrations.get(guild.id, sub.id), err, now));
      now += 7 * 3_600_000;
    }
    const after = app.integrations.get(guild.id, sub.id);
    assert.equal(after.enabled, 0);
    assert.equal(after.fail_count, 10);
    assert.match(H.textOf(adminCh.sent.map((m) => m.payload)), /أُوقف التكامل/);
    await cmd("toggle", { id: sub.id });
    assert.equal(app.integrations.get(guild.id, sub.id).enabled, 1);
  });

  await t.test("Webhook صادر: أحداث مختارة فقط، توقيع HMAC، وبيانات بلا كائنات ديسكورد", async () => {
    const received = [];
    responses.set("https://hooks.example.com/bot", (opts) => {
      received.push(opts);
      return { ok: true, status: 204, body: "" };
    });
    await cmd("add", { provider: "webhook", source: "https://hooks.example.com/bot", events: "ticket:created, nope", secret: "s3cret" });
    app.bus.emitSafe("ticket:created", { guild, ticket: { id: 5, number: 7, owner_id: alice.id }, member: alice });
    app.bus.emitSafe("ticket:closed", { guild, ticket: { id: 5 } });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(received.length, 1);
    const body = received[0].body;
    const parsed = JSON.parse(body);
    assert.equal(parsed.event, "ticket:created");
    assert.equal(parsed.data.ticket.number, 7);
    assert.equal(parsed.data.memberId, alice.id);
    assert.equal(received[0].headers["x-signature-256"], `sha256=${crypto.createHmac("sha256", "s3cret").update(body).digest("hex")}`);
    assert.equal(received[0].maxRedirects, 0);
  });

  await t.test("الاختبار اليدوي والقائمة والحذف", async () => {
    const sub = app.integrations.list(guild.id)[0];
    const i = await cmd("test", { id: sub.id });
    assert.match(H.textOf(i.replies), /معاينة/);
    assert.match(H.textOf((await cmd("list")).replies), /blog\.example\.com/);
    await cmd("remove", { id: sub.id });
    assert.equal(app.integrations.get(guild.id, sub.id), null);
    assert.equal(IntegrationService.transition("roblox", { updated: "a" }, { updated: "b" }), "updated");
  });
});
