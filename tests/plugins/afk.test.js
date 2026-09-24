const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("نظام الغياب AFK", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const channel = H.fakeChannel(guild, "400000000000000004", { app });
  const away = H.fakeMember(guild, "700000000000000007");
  const friend = H.fakeMember(guild, "700000000000000008");
  const mod = H.fakeMember(guild, "700000000000000009", { permissions: [ require("discord.js").PermissionFlagsBits.ModerateMembers ] });

  const run = async (member, content, extra) => {
    app.commands.cooldowns.clear();
    const msg = H.fakeMessage(member, channel, content, extra);
    await app.commands.handleMessage(msg);
    await app.plugins.dispatch("messageCreate", [msg]);
    return msg;
  };

  await t.test("!afk 1h سبب — يضبط الحالة والاسم والمدة ولا يُزال برسالة الأمر نفسها", async () => {
    const msg = await run(away, "!afk 1h اجتماع");
    assert.match(H.textOf(msg.replies), /اجتماع/);
    const row = app.afkRepo.get(guild.id, away.id);
    assert.equal(row.reason, "اجتماع");
    assert.ok(row.expires_at > Date.now());
    assert.ok(away.nickname.startsWith("[AFK]"));
    assert.ok(app.scheduler.getByKey(`afk:${guild.id}:${away.id}`));
    assert.ok(app.afk.isAfk(guild.id, away.id));
  });

  await t.test("منشن الغائب: تنبيه مرة واحدة لكل قناة ضمن التبريد، والعدّ يزيد دائمًا", async () => {
    const m1 = await run(friend, "هلا <@700000000000000007>", { mentions: [away] });
    assert.match(H.textOf(m1.replies), /غائب/);
    const m2 = await run(friend, "مرة ثانية <@700000000000000007>", { mentions: [away] });
    assert.equal(m2.replies.length, 0, "التبريد يمنع التكرار");
    assert.equal(app.afkRepo.get(guild.id, away.id).mentions, 2);
  });

  await t.test("كتابة الغائب تزيل الحالة وتعرض المنشنات وتعيد الاسم", async () => {
    app.db.prepare("UPDATE afk_status SET since = ? WHERE user_id = ?").run(Date.now() - 60_000, away.id);
    const back = await run(away, "رجعت");
    const text = H.textOf(back.replies);
    assert.match(text, /أهلًا بعودتك/);
    assert.match(text, /`2`/);
    assert.equal(app.afk.isAfk(guild.id, away.id), false);
    assert.equal(away.nickname, null);
    assert.equal(app.scheduler.getByKey(`afk:${guild.id}:${away.id}`).status, "cancelled");
  });

  await t.test("انتهاء المدة عبر المجدول يزيل الحالة", async () => {
    await app.afk.setAfk(friend, { reason: "x", durationMs: 60_000 });
    app.db.prepare("UPDATE scheduled_jobs SET run_at = ? WHERE unique_key = ?").run(Date.now() - 1, `afk:${guild.id}:${friend.id}`);
    await app.scheduler.tick();
    assert.equal(app.afk.isAfk(guild.id, friend.id), false);
  });

  await t.test("المشرف يزيل غياب عضو؛ العضو العادي لا", async () => {
    await app.afk.setAfk(away, {});
    const denied = H.fakeSlash(friend, channel, { command: "afk", sub: "clear", options: { user: away.user } });
    await app.commands.handleInteraction(denied);
    assert.match(H.textOf(denied.replies), /الصلاحية/);
    app.commands.cooldowns.clear();
    const ok = H.fakeSlash(mod, channel, { command: "afk", sub: "clear", options: { user: away.user } });
    await app.commands.handleInteraction(ok);
    assert.equal(app.afk.isAfk(guild.id, away.id), false);
  });

  await t.test("الفهرس يُبنى من قاعدة البيانات عند الإقلاع", async () => {
    await app.afk.setAfk(away, {});
    app.afk.index.clear();
    app.afk.load();
    assert.ok(app.afk.isAfk(guild.id, away.id));
  });
});
