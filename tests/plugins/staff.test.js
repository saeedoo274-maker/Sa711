const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");
const { Events } = require("../../src/core/events/EventBus");

test("إدارة الطاقم المتقدمة", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const staffRole = H.fakeRole("860000000000000086");
  const supportRole = H.fakeRole("860000000000000087", { position: 2 });
  guild.roles.cache.set(staffRole.id, staffRole);
  guild.roles.cache.set(supportRole.id, supportRole);
  app.guildConfig.set(guild.id, "staff.baseRoleId", staffRole.id);
  const sara = H.fakeMember(guild, "600000000000000061", { roleIds: [staffRole.id] });
  const omar = H.fakeMember(guild, "600000000000000062", { roleIds: [staffRole.id] });
  const alice = H.fakeMember(guild, "700000000000000007");
  const modRole = H.fakeRole("860000000000000090");
  guild.roles.cache.set(modRole.id, modRole);
  app.guildConfig.set(guild.id, "permissions.moderatorRoleIds", [modRole.id]);

  const run = async (member, sub, options = {}, group = null) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(member, general, { command: "سلم_اداري", sub, group, options });
    await app.commands.handleInteraction(i);
    return H.textOf(i.replies);
  };

  await t.test("إدارة السلم ما زالت للأدمن فقط، والطاقم لا يصلها", async () => {
    assert.match(await run(sara, "add", { role: staffRole, name: "x" }), /صلاحي/);
    assert.match(await run(alice, "shift", {}, null), /صلاحي/);
  });

  await t.test("المناوبات: بدء، منع التكرار، استراحة، إنهاء مع حساب الوقت", async () => {
    assert.match(await run(sara, "start", {}, "shift"), /بدأت/);
    assert.match(await run(sara, "start", {}, "shift"), /مفتوحة بالفعل/);
    assert.match(await run(sara, "break", {}, "shift"), /الاستراحة/);
    const open = app.staffPlusRepo.openShift(guild.id, sara.id);
    assert.equal(open.status, "break");
    app.db.prepare("UPDATE staff_shifts SET started_at = ?, break_started_at = ? WHERE id = ?").run(Date.now() - 3 * 3600_000, Date.now() - 1800_000, open.id);
    assert.match(await run(sara, "list", {}, "shift"), new RegExp(sara.id));
    assert.match(await run(sara, "end", {}, "shift"), /انتهت/);
    const ended = app.staffPlusRepo.shift(open.id);
    assert.equal(ended.status, "ended");
    assert.ok(ended.break_ms >= 1800_000 - 1000);
    assert.match(await run(sara, "end", {}, "shift"), /لا توجد مناوبة/);
    assert.match(await run(alice, "start", {}, "shift"), /صلاحي/);
  });

  await t.test("إنهاء مناوبة إداري آخر للمشرف فقط، والإنهاء التلقائي عبر المجدول", async () => {
    await run(omar, "start", {}, "shift");
    assert.match(await run(sara, "end", { user: omar.user }, "shift"), /صلاحي/);
    const shift = app.staffPlusRepo.openShift(guild.id, omar.id);
    await app.scheduler.tick(Date.now() + 13 * 3600_000);
    assert.equal(app.staffPlusRepo.shift(shift.id).status, "ended");
    assert.equal(app.staffPlusRepo.shift(shift.id).ended_by, "auto");
  });

  await t.test("الأقسام: إنشاء، نقل مع رتبة القسم، إخراج", async () => {
    assert.match(await run(sara, "create", { name: "الدعم" }, "department"), /صلاحي/);
    await run(admin, "create", { name: "الدعم", role: supportRole, lead: sara.user }, "department");
    assert.match(await run(admin, "create", { name: "الدعم" }, "department"), /يوجد قسم/);
    await run(admin, "assign", { user: omar.user, name: "الدعم" }, "department");
    assert.equal(app.staffPlusRepo.memberDepartment(guild.id, omar.id).name, "الدعم");
    assert.equal(omar.roles.cache.has(supportRole.id), true);
    assert.match(await run(admin, "assign", { user: alice.user, name: "الدعم" }, "department"), /ليس من الطاقم/);
    assert.match(await run(sara, "list", {}, "department"), /الدعم/);
    await run(admin, "assign", { user: omar.user }, "department");
    assert.equal(app.staffPlusRepo.memberDepartment(guild.id, omar.id), null);
    assert.equal(omar.roles.cache.has(supportRole.id), false);
  });

  await t.test("التقييمات: مشرف فأعلى، بدون تقييم النفس، مرة يوميًا", async () => {
    assert.match(await run(sara, "evaluate", { user: omar.user, score: 8 }), /صلاحي/);
    await run(admin, "evaluate", { user: omar.user, score: 8, notes: "ممتاز في التذاكر" });
    assert.match(await run(admin, "evaluate", { user: omar.user, score: 9 }), /24 ساعة/);
    assert.equal(app.staffPlusRepo.evaluations(guild.id, omar.id).length, 1);
  });

  await t.test("سجل الترقيات من أحداث السلم، وملف KPI", async () => {
    app.bus.emitSafe(Events.STAFF_PROMOTED, { guild, executor: admin, target: omar, details: "مساعد ← مشرف" });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(app.staffPlusRepo.rankHistory(guild.id, omar.id)[0].direction, "promote");
    const text = await run(admin, "profile", { user: omar.user });
    assert.match(text, /مساعد ← مشرف/);
    assert.match(text, /8\/10/);
    assert.match(text, /KPI/);
    assert.match(await run(sara, "profile", { user: omar.user }), /صلاحي/);
    assert.match(await run(sara, "profile"), /KPI/);
    const k = app.staffPlus.kpis(guild.id, sara.id, 30);
    assert.equal(k.shifts, 1);
    assert.ok(k.workedMs > 2 * 3600_000);
  });
});
