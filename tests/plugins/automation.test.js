const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("منشئ الأتمتة", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const welcome = H.fakeChannel(guild, "400000000000000015", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const member = H.fakeRole("897000000000000001", { position: 3 });
  member.permissions = { has: () => false };
  const mod = H.fakeRole("897000000000000002", { position: 4 });
  mod.permissions = { has: (p) => p === require("discord.js").PermissionFlagsBits.BanMembers };
  guild.roles.cache.set(member.id, member);
  guild.roles.cache.set(mod.id, mod);
  const alice = H.fakeMember(guild, "700000000000000007");

  const run = async (sub, options = {}, who = admin) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(who, general, { command: "اعداد", group: "automation", sub, options });
    await app.commands.handleInteraction(i);
    return H.textOf(i.replies);
  };
  const last = () => app.automation.list(guild.id).at(-1);

  await t.test("دخول عضو: رسالة ترحيب + رتبة + انتظار ثم خاص", async () => {
    await run("create", { name: "welcome", trigger: "member_join" });
    const id = last().id;
    await run("action", { id, type: "message", value: "أهلًا {USER}", channel: welcome });
    await run("action", { id, type: "add_role", role: member });
    assert.match(await run("action", { id, type: "add_role", role: mod }), /صلاحيات إدارية/);
    await run("action", { id, type: "wait", value: "5" });
    await run("action", { id, type: "dm", value: "هل قرأت القوانين؟" });
    await app.plugins.dispatch("guildMemberAdd", [alice]);
    assert.match(welcome.sent.at(-1).payload.content, new RegExp(alice.id));
    assert.equal(alice.roles.cache.has(member.id), true);
    const pending = app.db.prepare("SELECT * FROM scheduled_jobs WHERE type = 'automation:continue' AND status = 'pending'").all();
    assert.equal(pending.length, 1);
    await app.scheduler.tick(Date.now() + 6 * 60_000);
    assert.equal(app.db.prepare("SELECT status FROM scheduled_jobs WHERE id = ?").get(pending[0].id).status, "done");
    assert.equal(app.automation.get(guild.id, id).runs, 1);
  });

  await t.test("كلمة في رسالة: شروط الرتبة والقناة، تفاعل، تبريد لكل عضو، وتجاهل البوتات", async () => {
    await run("create", { name: "hello", trigger: "message_keyword", value: "مرحبا" });
    const id = last().id;
    await run("condition", { id, type: "has_role", role: member });
    await run("condition", { id, type: "in_channel", channel: general });
    await run("action", { id, type: "react", value: "👋" });
    await run("action", { id, type: "message", value: "وعليكم السلام {USER}" });
    const before = general.sent.length;
    const bob = H.fakeMember(guild, "700000000000000008");
    await app.plugins.dispatch("messageCreate", [H.fakeMessage(bob, general, "مرحبا")]);
    assert.equal(general.sent.length, before, "بلا رتبة لا تعمل");
    const reacts = [];
    const msg = H.fakeMessage(alice, general, "يا جماعة مرحبا!");
    msg.react = async (e) => reacts.push(e);
    await app.plugins.dispatch("messageCreate", [msg]);
    assert.equal(general.sent.length, before + 1);
    assert.deepEqual(reacts, ["👋"]);
    await app.plugins.dispatch("messageCreate", [H.fakeMessage(alice, general, "مرحبا")]);
    assert.equal(general.sent.length, before + 1, "تبريد 30 ثانية لكل عضو");
    const botUser = H.fakeMember(guild, "700000000000000099", { bot: true, roleIds: [member.id] });
    await app.plugins.dispatch("messageCreate", [H.fakeMessage(botUser, general, "مرحبا")]);
    assert.equal(general.sent.length, before + 1);
    assert.match(await run("action", { id: last().id, type: "react", value: "x" }), /./);
  });

  await t.test("الجدولة اليومية وحد التشغيل في الدقيقة", async () => {
    assert.match(await run("create", { name: "daily", trigger: "schedule_daily", value: "25:00", channel: general }), /HH:MM/);
    assert.match(await run("create", { name: "daily", trigger: "schedule_daily", value: "09:00" }), /القناة/);
    await run("create", { name: "daily", trigger: "schedule_daily", value: "09:00", channel: general });
    const id = last().id;
    await run("action", { id, type: "message", value: "صباح الخير" });
    const job = app.scheduler.getByKey(`automation:${id}`);
    assert.ok(job);
    const before = general.sent.length;
    await app.scheduler.tick(job.run_at + 1000);
    assert.equal(general.sent.at(-1).payload.content, "صباح الخير");
    assert.equal(general.sent.length, before + 1);
    await run("toggle", { id });
    assert.equal(app.scheduler.getByKey(`automation:${id}`)?.status === "pending", false, "الإيقاف يلغي الجدولة");

    app.guildConfig.set(guild.id, "automation.runsPerMinute", 2);
    app.automation.budget.clear();
    await run("create", { name: "spam", trigger: "level_up" });
    const sid = last().id;
    await run("action", { id: sid, type: "add_xp", value: "1" });
    for (let n = 0; n < 5; n++) await app.automation.fire("level_up", { guild, member: alice });
    assert.equal(app.automation.get(guild.id, sid).runs, 2);
  });

  await t.test("الإدارة: عرض، حذف خطوة، حذف، وصلاحيات", async () => {
    const id = app.automation.list(guild.id)[0].id;
    assert.match(await run("info", { id }), /أهلًا/);
    await run("remove-step", { id, kind: "action", index: 1 });
    assert.equal(app.automation.get(guild.id, id).actions.length, 3);
    assert.match(await run("list"), /welcome/);
    assert.match(await run("list", {}, alice), /صلاحي/);
    await run("delete", { id });
    assert.equal(app.automation.get(guild.id, id), null);
  });
});
