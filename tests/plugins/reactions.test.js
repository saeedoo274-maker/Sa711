const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("أتمتة التفاعلات (توسعة رد التفاعل)", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const secret = H.fakeChannel(guild, "400000000000000006", { app });
  const logCh = H.fakeChannel(guild, "400000000000000007", { app });
  const overwrites = new Map();
  secret.permissionOverwrites = { edit: async (id, p) => overwrites.set(id, p) };
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const news = H.fakeRole("891000000000000001", { position: 5 });
  const guest = H.fakeRole("891000000000000002", { position: 4 });
  const muted = H.fakeRole("891000000000000003", { position: 3 });
  for (const r of [news, guest, muted]) {
    r.permissions = { has: () => false };
    guild.roles.cache.set(r.id, r);
  }
  const alice = H.fakeMember(guild, "700000000000000007", { roleIds: [guest.id] });
  const bob = H.fakeMember(guild, "700000000000000008", { roleIds: [muted.id] });

  const rr = async (sub, options = {}) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(admin, general, { command: "رد_تفاعل", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const removed = [];
  const reactOn = (message, emoji) => ({ emoji: { name: emoji, id: null }, message, users: { remove: async (id) => removed.push(id) } });
  const target = H.fakeMessage(admin, general, "اختر اشتراكك");
  const other = H.fakeMessage(admin, general, "رسالة أخرى");

  await t.test("قاعدة قديمة (تبديل الرتبة) تعمل كما هي", async () => {
    await rr("create", { name: "news", emoji: "📰", role: news });
    await app.reactionReplyService.handle(reactOn(other, "📰"), alice.user, guild);
    assert.equal(alice.roles.cache.has(news.id), true);
    await app.reactionReplyService.handle(reactOn(other, "📰"), alice.user, guild);
    assert.equal(alice.roles.cache.has(news.id), false, "التبديل يسحب في المرة الثانية");
    const off = await app.reactionReplyService.handle(reactOn(other, "📰"), alice.user, guild, { removed: true });
    assert.equal(off, false, "إزالة التفاعل لا تفعل شيئًا في وضع التبديل");
  });

  await t.test("وضع المزامنة + ربط برسالة محددة + سحب رتبة + قناة + سجل", async () => {
    let i = await rr("actions", { name: "news", "role-mode": "sync", "remove-reaction": true });
    assert.match(H.textOf(i.replies), /المزامنة/);
    i = await rr("actions", { name: "news", "channel-action": "view" });
    assert.match(H.textOf(i.replies), /القناة/);
    await rr("actions", {
      name: "news", "role-mode": "sync", "remove-role": guest, channel: secret, "channel-action": "view",
      "log-channel": logCh, message: `https://discord.com/channels/${guild.id}/${general.id}/${target.id}`
    });
    const rule = app.reactionReplies.getByName(guild.id, "news");
    assert.equal(rule.message_id, target.id);

    assert.equal(await app.reactionReplyService.handle(reactOn(other, "📰"), alice.user, guild), false, "رسالة أخرى لا تطابق");
    await app.reactionReplyService.handle(reactOn(target, "📰"), alice.user, guild);
    assert.equal(alice.roles.cache.has(news.id), true);
    assert.equal(alice.roles.cache.has(guest.id), false);
    assert.equal(overwrites.get(alice.id).ViewChannel, true);
    assert.match(H.textOf([logCh.sent.at(-1).payload]), /➕/);

    await app.reactionReplyService.handle(reactOn(target, "📰"), alice.user, guild, { removed: true });
    assert.equal(alice.roles.cache.has(news.id), false, "المزامنة تسحب عند إزالة التفاعل");
    assert.equal(overwrites.get(alice.id).ViewChannel, null);
  });

  await t.test("الشروط: رتبة محظورة، عمر الحساب، التبريد — مع إزالة التفاعل", async () => {
    await rr("requirements", { name: "news", "blocked-role": muted, cooldown: "1m" });
    removed.length = 0;
    assert.equal(await app.reactionReplyService.handle(reactOn(target, "📰"), bob.user, guild), false);
    assert.deepEqual(removed, [bob.id]);
    assert.equal(bob.roles.cache.has(news.id), false);

    await app.reactionReplyService.handle(reactOn(target, "📰"), alice.user, guild);
    assert.equal(alice.roles.cache.has(news.id), true);
    await app.reactionReplyService.handle(reactOn(target, "📰"), alice.user, guild, { removed: true });
    assert.equal(await app.reactionReplyService.handle(reactOn(target, "📰"), alice.user, guild), false, "تبريد");

    await rr("requirements", { name: "news", cooldown: "0", "min-account-days": 1000 });
    assert.equal(await app.reactionReplyService.handle(reactOn(target, "📰"), alice.user, guild), false, "حساب عمره 400 يوم");
    let i = await rr("requirements", { name: "news", "min-level": 3 });
    assert.match(H.textOf(i.replies), /levels|معطل|غير مفعّل/);
    i = await rr("requirements", { name: "news", cooldown: "xyz" });
    assert.match(H.textOf(i.replies), /مدة|المدة|صالح/);
  });

  await t.test("رد نصي مع زر رابط وإزالة التفاعل", async () => {
    await rr("create", { name: "rules", emoji: "📜", reply: "اقرأ القوانين يا {USER}" });
    const i = await rr("actions", { name: "rules", "button-label": "القوانين", "button-url": "http://bad" });
    assert.match(H.textOf(i.replies), /https/);
    await rr("actions", { name: "rules", "button-label": "القوانين", "button-url": "https://example.com/rules", "remove-reaction": true });
    removed.length = 0;
    const before = general.sent.length;
    await app.reactionReplyService.handle(reactOn(other, "📜"), alice.user, guild);
    const sent = general.sent.at(-1);
    assert.equal(general.sent.length, before + 1);
    assert.match(sent.payload.content, new RegExp(alice.id));
    assert.equal(sent.payload.components[0].toJSON().components[0].url, "https://example.com/rules");
    assert.deepEqual(removed, [alice.id]);
  });

  await t.test("المعلومات والقائمة", async () => {
    const i = await rr("info", { name: "news" });
    const text = H.textOf(i.replies);
    assert.match(text, /sync/);
    assert.match(text, new RegExp(target.id));
  });
});
