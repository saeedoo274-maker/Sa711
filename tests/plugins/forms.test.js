const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");
const { csvCell } = require("../../src/modules/applications/commands/application");

test("منشئ النماذج (توسعة التقديمات)", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const review = H.fakeChannel(guild, "400000000000000011", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const alice = H.fakeMember(guild, "700000000000000007");
  const bob = H.fakeMember(guild, "700000000000000008");

  const run = async (sub, options = {}, member = admin) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(member, general, { command: "تقديم", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };

  await run("create", { name: "event", label: "تسجيل فعالية", review });
  let type = app.applications.getTypeByName(guild.id, "event");
  app.applications.setQuestions(type.id, [{ label: "الاسم", long: false }, { label: "العمر", numeric: true }]);
  const submit = async (member, answers) => {
    type = app.applications.getTypeByName(guild.id, "event");
    const check = app.applicationService.eligibility(guild.id, type, member.id);
    if (!check.ok) return check;
    const rec = await app.applicationService.submit({ guild, user: member.user, type, answers });
    return { ok: true, rec };
  };

  await t.test("بلا قيود: السلوك القديم كما هو", async () => {
    const res = await submit(alice, { الاسم: "علي", العمر: "20" });
    assert.equal(res.ok, true);
    assert.equal((await submit(alice, { الاسم: "x" })).reason, "pending", "طلب معلّق يمنع التكرار كما كان");
  });

  await t.test("نافذة الفتح والإغلاق", async () => {
    let i = await run("schedule", { name: "event", opens: "2h" });
    assert.match(H.textOf(i.replies), /يفتح/);
    assert.equal((await submit(bob, {})).reason, "notOpen");
    i = await run("schedule", { name: "event", opens: "2020-01-01 10:00", closes: "2020-01-02 10:00" });
    assert.equal((await submit(bob, {})).reason, "closed");
    i = await run("schedule", { name: "event", opens: "2026-01-02 10:00", closes: "2026-01-01 10:00" });
    assert.match(H.textOf(i.replies), /بعد الفتح/);
    i = await run("schedule", { name: "event", opens: "غلط" });
    assert.match(H.textOf(i.replies), /مدة|المدة|صالح/);
    await run("schedule", { name: "event", clear: true });
    assert.equal(app.applications.getTypeByName(guild.id, "event").opens_at, null);
  });

  await t.test("الحد الإجمالي وحد العضو", async () => {
    await run("schedule", { name: "event", max: 2 });
    assert.equal((await submit(bob, { الاسم: "بوب" })).ok, true);
    const carl = H.fakeMember(guild, "700000000000000009");
    assert.equal((await submit(carl, {})).reason, "full");
    await run("schedule", { name: "event", max: 0, "per-user": 1 });
    const rec = app.applications.pendingForUser(guild.id, type.id, bob.id);
    app.applications.decide(rec.id, "rejected", admin.id, null);
    assert.equal((await submit(bob, {})).reason, "userLimit");
  });

  await t.test("الإحصاءات والتصدير (مع حماية CSV)", async () => {
    let i = await run("stats", { name: "event" });
    assert.match(H.textOf(i.replies), /مرفوض/);
    await submit(H.fakeMember(guild, "700000000000000010"), { الاسم: "=HYPERLINK(\"http://x\")", العمر: "30" });
    i = await run("export", { name: "event" });
    const csv = i.replies.at(-1).files[0].attachment.toString("utf8");
    assert.match(csv, /"الاسم"/);
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/);
    i = await run("export", { name: "event", format: "json" });
    const json = JSON.parse(i.replies.at(-1).files[0].attachment.toString("utf8"));
    assert.equal(json.rows.length, 3);
    assert.equal(csvCell("-1+1"), "\"'-1+1\"");
    i = await run("export", { name: "event" }, alice);
    assert.match(H.textOf(i.replies), /صلاحي/);
  });
});
