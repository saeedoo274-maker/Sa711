const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("إدارة القضايا والبلاغات", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const upper = H.fakeChannel(guild, "400000000000000008", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const mod = H.fakeMember(guild, "600000000000000061", { admin: true });
  const alice = H.fakeMember(guild, "700000000000000007");

  const run = async (command, options = {}, member = admin, sub = null) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(member, general, { command, sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const mk = (type, reason) => app.cases.create({ guildId: guild.id, type, targetId: alice.id, targetTag: "alice", moderatorId: admin.id, moderatorTag: "admin", reason });
  const c1 = mk("warn", "سب في العام");
  const c2 = mk("timeout", "تكرار السب");

  await t.test("العرض الافتراضي للقضية لم يتغير", async () => {
    const i = await run("قضية", { number: c1.case_number });
    assert.match(H.textOf(i.replies), /سب في العام/);
  });

  await t.test("ملاحظة، دليل (https فقط)، ربط، خط زمني", async () => {
    await run("قضية", { number: c1.case_number, action: "note", text: "راجعت التسجيل" });
    let i = await run("قضية", { number: c1.case_number, action: "evidence", text: "http://insecure.example/x.png javascript:alert(1)" });
    assert.match(H.textOf(i.replies), /https/);
    await run("قضية", { number: c1.case_number, action: "evidence", text: "https://cdn.example.com/proof.png" });
    await run("قضية", { number: c1.case_number, action: "link", related: c2.case_number });
    i = await run("قضية", { number: c1.case_number, action: "link", related: c2.case_number });
    assert.match(H.textOf(i.replies), /مرتبطتان بالفعل/);
    i = await run("قضية", { number: c1.case_number, action: "link", related: 999 });
    assert.match(H.textOf(i.replies), /غير موجودة/);
    i = await run("قضية", { number: c1.case_number, action: "timeline" });
    const text = H.textOf(i.replies);
    assert.match(text, /راجعت التسجيل/);
    assert.match(text, /proof\.png/);
    assert.match(text, new RegExp(`#${c2.case_number}`));
    assert.deepEqual(app.caseworkRepo.links(guild.id, c2.case_number), [c1.case_number]);
  });

  await t.test("الإغلاق وإعادة الفتح ذريّان، والتصدير JSON", async () => {
    await run("قضية", { number: c1.case_number, action: "close" });
    assert.equal(app.cases.getByNumber(guild.id, c1.case_number).active, 0);
    let i = await run("قضية", { number: c1.case_number, action: "close" });
    assert.match(H.textOf(i.replies), /مغلقة بالفعل/);
    await run("قضية", { number: c1.case_number, action: "reopen" });
    assert.equal(app.cases.getByNumber(guild.id, c1.case_number).active, 1);
    i = await run("قضية", { number: c1.case_number, action: "export" });
    const file = i.replies.at(-1).files[0];
    const data = JSON.parse(file.attachment.toString("utf8"));
    assert.equal(data.case.case_number, c1.case_number);
    assert.ok(data.timeline.some((e) => e.kind === "status"));
  });

  await t.test("عضو عادي لا يعدّل القضايا", async () => {
    const staff = H.fakeMember(guild, "600000000000000070");
    app.guildConfig.set(guild.id, "staff.baseRoleId", "860000000000000086");
    staff.roles.cache.set("860000000000000086", H.fakeRole("860000000000000086"));
    const i = await run("قضية", { number: c1.case_number, action: "note", text: "x" }, alice);
    assert.match(H.textOf(i.replies), /صلاحي/);
  });

  await t.test("البحث في القضايا بفلاتر آمنة (لا حقن LIKE)", () => {
    assert.equal(app.caseworkRepo.searchCases(guild.id, { userId: alice.id }).length, 2);
    assert.equal(app.caseworkRepo.searchCases(guild.id, { type: "timeout" }).length, 1);
    assert.equal(app.caseworkRepo.searchCases(guild.id, { text: "العام" }).length, 1);
    assert.equal(app.caseworkRepo.searchCases(guild.id, { text: "%" }).length, 0);
  });

  await t.test("البلاغات: SLA، تكليف، أولوية، ملاحظة، تصعيد، وتعارض المصالح", async () => {
    app.guildConfig.set(guild.id, "lifecycle.reports.upperChannelId", upper.id);
    app.guildConfig.set(guild.id, "reports.upperChannelId", upper.id);
    const record = app.lifecycle.createReport({ guildId: guild.id, reporterId: alice.id, targetId: mod.id, reason: "إساءة" });
    app.bus.emitSafe("report:created", { guild, record });
    await new Promise((r) => setTimeout(r, 5));
    let report = app.caseworkRepo.report(guild.id, record.number);
    assert.ok(report.sla_due_at > Date.now());

    let i = await run("بلاغ", { number: record.number }, mod, "view");
    assert.match(H.textOf(i.replies), /صلاحي/, "المُبلَّغ عنه لا يرى/يدير بلاغه");
    i = await run("بلاغ", { number: record.number, user: mod.user }, admin, "assign");
    assert.match(H.textOf(i.replies), /المُبلَّغ عنه/);
    const helper = H.fakeMember(guild, "600000000000000062", { admin: true });
    await run("بلاغ", { number: record.number, user: helper.user }, admin, "assign");
    await run("بلاغ", { number: record.number, level: "high" }, admin, "priority");
    await run("بلاغ", { number: record.number, text: "بانتظار الأدلة" }, admin, "note");
    report = app.caseworkRepo.report(guild.id, record.number);
    assert.equal(report.assignee_id, helper.id);
    assert.equal(report.priority, "high");

    await app.scheduler.tick(Date.now() + 25 * 3600_000);
    assert.equal(app.caseworkRepo.report(guild.id, record.number).sla_breached, 1);
    await app.casework.reportSla(report.id);
    assert.equal(app.caseworkRepo.notes(guild.id, "report", record.number).filter((n) => n.kind === "sla").length, 1);

    i = await run("بلاغ", { number: record.number, reason: "خطير" }, admin, "escalate");
    assert.match(H.textOf(i.replies), /urgent/);
    i = await run("بلاغ", { number: record.number }, admin, "escalate");
    assert.match(H.textOf(i.replies), /مصعَّد بالفعل/);
    i = await run("بلاغ", { number: record.number }, admin, "view");
    assert.match(H.textOf(i.replies), /بانتظار الأدلة/);
  });
});
