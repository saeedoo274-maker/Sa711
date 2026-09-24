const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("نظام التذكيرات", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const channel = H.fakeChannel(guild, "400000000000000004", { app });
  const user = H.fakeMember(guild, "700000000000000007");
  const staff = H.fakeMember(guild, "700000000000000009", { admin: true });

  const slash = async (who, sub, options = {}) => {
    app.commands.cooldowns.clear();
    const i = H.fakeSlash(who, channel, { command: "تذكير", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const makeDue = (id) => app.db.prepare("UPDATE scheduled_jobs SET run_at = ? WHERE unique_key = ?").run(Date.now() - 1, `reminder:${id}`);

  await t.test("بعد مدة إلى الخاص: يُنشأ ويُجدول ويُرسل مرة واحدة", async () => {
    const i = await slash(user, "in", { time: "30m", content: "اشرب ماء" });
    assert.match(H.textOf(i.replies), /#1/);
    const job = app.scheduler.getByKey("reminder:1");
    assert.ok(job && job.status === "pending");
    assert.ok(Math.abs(job.run_at - (Date.now() + 30 * 60_000)) < 5000);
    makeDue(1);
    await app.scheduler.tick();
    await app.scheduler.tick();
    const dms = app.__sent.filter((d) => d.to === user.id && /اشرب ماء/.test(d.payload.content));
    assert.equal(dms.length, 1);
    assert.equal(app.remindersRepo.get(1).active, 0);
    assert.equal(app.scheduler.getByKey("reminder:1").status, "done");
  });

  await t.test("المدة أقل من دقيقة مرفوضة، والتاريخ الماضي مرفوض", async () => {
    assert.match(H.textOf((await slash(user, "in", { time: "10s", content: "x" })).replies), /مدة غير صالحة/);
    assert.match(H.textOf((await slash(user, "at", { when: "2020-01-01 10:00", content: "x" })).replies), /مضى/);
  });

  await t.test("بتاريخ ووقت بمنطقة المستخدم الزمنية", async () => {
    await slash(user, "timezone", { zone: "Asia/Riyadh" });
    assert.equal(app.reminders.timezoneFor(guild.id, user.id), "Asia/Riyadh");
    const bad = await slash(user, "timezone", { zone: "Mars/Olympus" });
    assert.match(H.textOf(bad.replies), /غير صالحة/);
    const year = new Date().getUTCFullYear() + 1;
    await slash(user, "at", { when: `${year}-03-01 09:00`, content: "موعد" });
    const r = app.remindersRepo.listForUser(guild.id, user.id).find((x) => x.content === "موعد");
    assert.equal(new Date(r.run_at).toISOString(), `${year}-03-01T06:00:00.000Z`);
    assert.equal(r.timezone, "Asia/Riyadh");
  });

  await t.test("المتكرر اليومي يبقى نشطًا ويُعاد جدولته بعد الإرسال", async () => {
    await slash(user, "repeat", { kind: "daily", time: "08:00", content: "ورد الصباح", target: "channel" });
    const r = app.remindersRepo.listForUser(guild.id, user.id).find((x) => x.content === "ورد الصباح");
    assert.equal(r.repeat.kind, "daily");
    assert.equal(r.repeat.tz, "Asia/Riyadh");
    makeDue(r.id);
    await app.scheduler.tick();
    const after = app.remindersRepo.get(r.id);
    assert.equal(after.active, 1);
    assert.equal(after.sent_count, 1);
    assert.ok(app.scheduler.getByKey(`reminder:${r.id}`).run_at > Date.now());
    assert.match(channel.sent.at(-1).content, /ورد الصباح/);
    assert.match(channel.sent.at(-1).content, new RegExp(`<@${user.id}>`));
  });

  await t.test("التعديل والحذف (للمالك فقط)", async () => {
    await slash(user, "in", { time: "2h", content: "قديم" });
    const r = app.remindersRepo.listForUser(guild.id, user.id).find((x) => x.content === "قديم");
    const other = H.fakeMember(guild, "700000000000000008");
    assert.match(H.textOf((await slash(other, "delete", { id: r.id })).replies), /لم أجد/);
    await slash(user, "edit", { id: r.id, content: "جديد", time: "3h" });
    const e = app.remindersRepo.get(r.id);
    assert.equal(e.content, "جديد");
    assert.ok(app.scheduler.getByKey(`reminder:${r.id}`).run_at > Date.now() + 2.9 * 3_600_000);
    await slash(user, "delete", { id: r.id });
    assert.equal(app.remindersRepo.get(r.id).active, 0);
    assert.equal(app.scheduler.getByKey(`reminder:${r.id}`).status, "cancelled");
  });

  await t.test("تذكير طاقم بمنشن رتبة، وعضو عادي ممنوع", async () => {
    const role = H.fakeRole("850000000000000085");
    const denied = await slash(user, "staff", { channel, content: "اجتماع الإدارة", time: "1h", role });
    assert.match(H.textOf(denied.replies), /الصلاحية/);
    await slash(staff, "staff", { channel, content: "اجتماع الإدارة", time: "1h", role });
    const r = app.db.prepare("SELECT id FROM reminders WHERE staff = 1").get();
    makeDue(r.id);
    await app.scheduler.tick();
    assert.match(channel.sent.at(-1).content, /<@&850000000000000085>/);
  });

  await t.test("قناة محذوفة: يسقط التذكير على الخاص بدل أن يضيع", async () => {
    const res = await app.reminders.create(user, { content: "بديل", inText: "5m", target: "channel", channel });
    app.db.prepare("UPDATE reminders SET channel_id = '400000000000000999' WHERE id = ?").run(res.reminder.id);
    makeDue(res.reminder.id);
    await app.scheduler.tick();
    assert.ok(app.__sent.some((d) => d.to === user.id && /بديل/.test(d.payload.content)));
  });

  await t.test("الحد الأقصى لكل عضو", async () => {
    app.guildConfig.set(guild.id, "reminders.maxPerUser", app.remindersRepo.countActive(guild.id, user.id));
    assert.match(H.textOf((await slash(user, "in", { time: "5m", content: "زائد" })).replies), /الأقصى/);
  });

  await t.test("الفحص الصحي: لا تذكير نشط بلا مهمة مجدولة", async () => {
    const health = await app.plugins.health();
    const r = health.find((h) => h.name === "reminders");
    assert.equal(r.ok, true, r.details);
  });
});
