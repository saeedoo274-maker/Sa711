const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");
const { validateUrl, isPrivateAddress, safeFetch } = require("../../src/core/utils/safeFetch");

test("الأوامر المخصصة الموسّعة والجلب الآمن", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const other = H.fakeChannel(guild, "400000000000000005", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const vip = H.fakeRole("890000000000000089");
  const alice = H.fakeMember(guild, "700000000000000007");
  const bob = H.fakeMember(guild, "700000000000000008", { roleIds: [vip.id] });
  const prefix = app.guildConfig.value(guild.id, "prefix");

  // حارس الإغراق الموجود يحد عدد الأوامر لكل عضو في الدقيقة — نصفّره بين الأوامر المتتالية
  const resetGuard = () => {
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    app.abuseGuard.cooldowns.clear();
  };
  const cc = async (sub, options = {}, member = admin) => {
    app.commands.cooldowns.clear();
    resetGuard();
    const i = H.fakeSlash(member, general, { command: "امر_مخصص", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const say = async (member, channel, text) => {
    app.commands.cooldowns.clear();
    resetGuard();
    const before = channel.sent.length;
    const msg = H.fakeMessage(member, channel, text);
    await app.commands.handleMessage(msg);
    return { msg, sent: channel.sent.slice(before) };
  };

  await t.test("الجلب الآمن يرفض العناوين الداخلية والبروتوكولات غير الآمنة", async () => {
    assert.equal(isPrivateAddress("169.254.169.254"), true);
    assert.equal(isPrivateAddress("::ffff:10.0.0.1"), true);
    assert.equal(isPrivateAddress("1.1.1.1"), false);
    assert.equal(validateUrl("http://example.com").reason, "protocol");
    assert.equal(validateUrl("https://user:pw@example.com").reason, "credentials");
    assert.equal(validateUrl("https://[::1]/").reason, "privateAddress");
    assert.equal(validateUrl("https://localhost/").reason, "privateAddress");
    assert.equal((await safeFetch("https://127.0.0.1/")).reason, "privateAddress");
  });

  await t.test("أمر قديم بسيط يعمل كما هو (توافق)", async () => {
    await cc("create", { name: "hello", content: "أهلًا {USER}" });
    const { sent } = await say(alice, general, `${prefix}hello`);
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.content, new RegExp(alice.id));
  });

  await t.test("الوسائط والحد الأدنى ورسالة الاستخدام", async () => {
    await cc("create", { name: "echo", content: "قلت: {ARG1} / الكل: {ARGS}" });
    await cc("rules", { name: "echo", "min-args": 1, usage: "<نص>" });
    let r = await say(alice, general, `${prefix}echo`);
    assert.equal(r.sent.length, 0);
    assert.match(H.textOf(r.msg.replies), /<نص>/);
    r = await say(alice, general, `${prefix}echo مرحبا يا عالم`);
    assert.equal(r.sent[0].payload.content, "قلت: مرحبا / الكل: مرحبا يا عالم");
  });

  await t.test("الأسماء البديلة: لا تتعارض مع الأوامر الأساسية وتُحذف مع الأمر", async () => {
    let i = await cc("alias", { name: "echo", action: "add", alias: "help" });
    assert.match(H.textOf(i.replies), /مستخدم/);
    await cc("alias", { name: "echo", action: "add", alias: "قل" });
    const r = await say(alice, general, `${prefix}قل هلا`);
    assert.match(r.sent[0].payload.content, /قلت: هلا/);
    i = await cc("create", { name: "قل", content: "x" });
    assert.match(H.textOf(i.replies), /نفس الاسم/);
  });

  await t.test("ردود متعددة: كلها بالترتيب، وعشوائي من القائمة", async () => {
    await cc("create", { name: "multi", content: "أساسي" });
    await cc("response", { name: "multi", action: "add", text: "واحد" });
    await cc("response", { name: "multi", action: "add", text: "اثنان" });
    await cc("response", { name: "multi", action: "mode", mode: "all" });
    let r = await say(alice, general, `${prefix}multi`);
    assert.deepEqual(r.sent.map((m) => m.payload.content), ["واحد", "اثنان"]);
    await cc("response", { name: "multi", action: "mode", mode: "random" });
    for (let n = 0; n < 5; n++) {
      r = await say(alice, general, `${prefix}multi`);
      assert.ok(["واحد", "اثنان"].includes(r.sent[0].payload.content));
    }
    await cc("response", { name: "multi", action: "remove", index: 5 });
    await cc("response", { name: "multi", action: "clear" });
    r = await say(alice, general, `${prefix}multi`);
    assert.equal(r.sent[0].payload.content, "أساسي");
  });

  await t.test("الرتب المطلوبة والقنوات المسموحة والتبريد", async () => {
    await cc("create", { name: "vip", content: "مرحبًا بالمميزين" });
    await cc("rules", { name: "vip", role: vip, channel: general, cooldown: "1m" });
    let r = await say(alice, general, `${prefix}vip`);
    assert.equal(r.sent.length, 0);
    assert.match(H.textOf(r.msg.replies), new RegExp(vip.id));
    r = await say(bob, other, `${prefix}vip`);
    assert.equal(r.sent.length, 0, "قناة غير مسموحة — صمت");
    r = await say(bob, general, `${prefix}vip`);
    assert.equal(r.sent.length, 1);
    r = await say(bob, general, `${prefix}vip`);
    assert.equal(r.sent.length, 0);
    assert.match(H.textOf(r.msg.replies), /انتظر/);
    const i = await cc("rules", { name: "vip", cooldown: "abc" });
    assert.match(H.textOf(i.replies), /مدة|المدة|صالح/);
  });

  await t.test("الأزرار والقائمة: رد مخفي، والإصدار القديم ينتهي بعد التعديل", async () => {
    await cc("create", { name: "menu", content: "اختر" });
    let i = await cc("button", { name: "menu", action: "link", label: "موقع", url: "http://insecure.example" });
    assert.match(H.textOf(i.replies), /https/);
    await cc("button", { name: "menu", action: "link", label: "موقع", url: "https://example.com" });
    await cc("button", { name: "menu", action: "reply", label: "سر", response: "السر هو {USER}" });
    await cc("select", { name: "menu", action: "add", label: "أ", response: "اخترت أ" });
    const r = await say(alice, general, `${prefix}menu`);
    const rows = r.sent[0].payload.components.map((c) => c.toJSON());
    assert.equal(rows[0].components.length, 2);
    const replyId = rows[0].components[1].custom_id;
    const selId = rows[1].components[0].custom_id;

    let click = H.fakeComponent(bob, general, replyId);
    await app.interactions.route(click);
    assert.match(H.textOf(click.replies), new RegExp(`السر هو <@${bob.id}>`));

    click = H.fakeComponent(bob, general, selId, { values: ["0"], kind: "select" });
    await app.interactions.route(click);
    assert.match(H.textOf(click.replies), /اخترت أ/);

    click = H.fakeComponent(bob, general, selId, { values: ["9"], kind: "select" });
    await app.interactions.route(click);
    assert.match(H.textOf(click.replies), /انته|صلاحية|expired/i);

    await new Promise((res) => setTimeout(res, 2));
    await cc("button", { name: "menu", action: "clear" });
    click = H.fakeComponent(bob, general, replyId);
    await app.interactions.route(click);
    assert.doesNotMatch(H.textOf(click.replies), /السر/);
  });

  await t.test("رابط API الداخلي مرفوض عند الحفظ، والرد في الخاص", async () => {
    await cc("create", { name: "api", content: "{API:x}" });
    const i = await cc("rules", { name: "api", "api-url": "https://169.254.169.254/latest" });
    assert.match(H.textOf(i.replies), /الداخلية/);
    await cc("create", { name: "private", content: "رسالة خاصة" });
    await cc("rules", { name: "private", dm: true });
    const r = await say(alice, general, `${prefix}private`);
    assert.equal(r.sent.length, 0);
    assert.equal(r.msg.replies.length, 0, "لا تحذير فشل المراسلة");
  });

  await t.test("تعطيل الأمر يوقفه، والمعلومات تعرض الإعدادات", async () => {
    await cc("rules", { name: "hello", enabled: false });
    const r = await say(alice, general, `${prefix}hello`);
    assert.equal(r.sent.length, 0);
    const i = await cc("info", { name: "echo" });
    assert.match(H.textOf(i.replies), /قل/);
  });

  await t.test("التصدير ثم الاستيراد في سيرفر آخر مع التحقق", async () => {
    const data = app.customCommandService.exportAll(guild.id);
    assert.ok(data.commands.length >= 6);
    const echo = data.commands.find((c) => c.name === "echo");
    assert.deepEqual(echo.aliases, ["قل"]);
    const g2 = "200000000000000099";
    app.guilds.ensure(g2);
    data.commands.push({ name: "help", content: "محجوز" }, { name: "bad name", content: "x" }, { name: "evil", content: "x", apiUrl: "https://10.0.0.1/" });
    const report = app.customCommandService.importAll(g2, data, { isReserved: (n) => !!app.registry.get(n), validateUrl: (u) => validateUrl(String(u)).ok });
    assert.equal(report.ok, true);
    assert.ok(report.skipped.includes("help") && report.skipped.includes("bad name"));
    assert.equal(app.customCommands.getByName(g2, "evil").api_url, null);
    assert.equal(app.customCommands.getByName(g2, "echo").min_args, 1);
    assert.equal(app.customCommands.aliasesOf(app.customCommands.getByName(g2, "echo").id)[0], "قل");
    const again = app.customCommandService.importAll(g2, data, { isReserved: (n) => !!app.registry.get(n), validateUrl: () => true });
    assert.equal(again.created, 0);
    assert.equal(app.customCommandService.importAll(g2, { foo: 1 }).ok, false);
    const del = await cc("delete", { name: "echo" });
    assert.match(H.textOf(del.replies), /حذف/);
    assert.equal(app.customCommands.aliasOwner(guild.id, "قل"), null);
  });
});
