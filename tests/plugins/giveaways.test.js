const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("السحوبات المتقدمة وتتبع الدعوات", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const channel = H.fakeChannel(guild, "400000000000000004", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const vip = H.fakeRole("870000000000000087");
  const booster = H.fakeRole("870000000000000088");
  const alice = H.fakeMember(guild, "700000000000000007", { roleIds: [vip.id] });
  const bob = H.fakeMember(guild, "700000000000000008", { roleIds: [booster.id, vip.id] });

  const gw = async (sub, options = {}, member = admin) => {
    app.commands.cooldowns.clear();
    const i = H.fakeSlash(member, channel, { command: "سحب", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const enter = async (member, giveaway) => {
    const msg = channel.sent.find((m) => m.id === giveaway.message_id);
    const i = H.fakeComponent(member, channel, `giveaway:enter:${giveaway.id}`, { message: msg });
    await app.interactions.route(i);
    return i;
  };
  const latest = () => app.db.prepare("SELECT * FROM giveaways ORDER BY id DESC LIMIT 1").get();

  await t.test("شرط المستوى يرفض عند تعطيل نظام المستويات", async () => {
    app.features.setForGuild(guild.id, "levels", false);
    const i = await gw("start", { prize: "نيترو", duration: "1h", "min-level": 5 });
    assert.match(H.textOf(i.replies), /المستويات/);
    assert.equal(latest(), undefined);
  });

  await t.test("شرط المستوى والرسائل عند الدخول، والفرص الإضافية المتعددة", async () => {
    app.features.setForGuild(guild.id, "levels", true);
    app.features.setForGuild(guild.id, "history", true);
    await gw("start", { prize: "نيترو", duration: "1h", winners: 1, "min-level": 2, "min-messages": 3, description: "سحب تجريبي" });
    let g = latest();
    assert.equal(g.min_level, 2);
    assert.equal(g.activity_days, 30);
    assert.match(H.textOf([channel.sent.at(-1).payload]), /سحب تجريبي/);

    let i = await enter(alice, g);
    assert.match(H.textOf(i.replies), /للمستوى 2/);
    app.levels.setXp(guild.id, alice.id, 100000, admin.id);
    i = await enter(alice, g);
    assert.match(H.textOf(i.replies), /3 رسالة/);
    for (let n = 0; n < 3; n++) app.history.onMessage(H.fakeMessage(alice, channel, `m${n}`));
    await enter(alice, g);
    assert.equal(app.giveaways.hasEntered(g.id, alice.id), true);

    await gw("bonus", { id: g.id, role: vip, entries: 3 });
    await gw("bonus", { id: g.id, role: booster, entries: 5 });
    g = app.giveaways.getById(g.id);
    assert.equal(app.giveawayService.entryWeight(g, bob), 5, "أعلى رتبة فرص تفوز");
    assert.equal(app.giveawayService.entryWeight(g, alice), 3);
    await gw("bonus", { id: g.id, role: booster, entries: 1 });
    assert.equal(app.giveawayService.entryWeight(app.giveaways.getById(g.id), bob), 3, "entries=1 يزيل الرتبة");
  });

  await t.test("الإنهاء يسجّل وقت الانتهاء ويرسل للفائز رسالة خاصة", async () => {
    const g = latest();
    app.giveawaysPlusRepo.setExtras(g.id, { dm_winners: 1 });
    const res = await app.giveawayService.end(g.id);
    assert.deepEqual(res.winners, [alice.id]);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(app.giveaways.getById(g.id).ended_at);
    assert.match(H.textOf(app.__sent.filter((m) => m.to === alice.id).map((m) => m.payload)), /نيترو/);
  });

  await t.test("السجل وسجل فوز العضو ولوحة المتصدرين", async () => {
    let i = await gw("history");
    assert.match(H.textOf(i.replies), /نيترو/);
    i = await gw("history", { user: alice.user });
    assert.match(H.textOf(i.replies), /\(1\)/);
    const rows = app.leaderboards.rows("giveaways", guild.id, {});
    assert.equal(rows[0].user_id, alice.id);
  });

  await t.test("سحب مجدول: لا يُنشر قبل موعده، ثم يُفعّل عبر المجدول مرة واحدة", async () => {
    const before = channel.sent.length;
    await gw("start", { prize: "جائزة لاحقة", duration: "1h", "starts-in": "10m" });
    const g = latest();
    assert.equal(g.status, "scheduled");
    assert.equal(channel.sent.length, before);
    let i = await gw("list");
    assert.match(H.textOf(i.replies), /جائزة لاحقة/);
    await app.giveawayService.tick();
    assert.equal(app.giveaways.getById(g.id).status, "scheduled", "المؤقت الأصلي لا يلمس المجدولة");
    await app.scheduler.tick(Date.now() + 11 * 60_000);
    const fresh = app.giveaways.getById(g.id);
    assert.equal(fresh.status, "active");
    assert.ok(fresh.message_id);
    assert.ok(fresh.ends_at > Date.now() + 50 * 60_000);
    await app.giveawaysPlus.start(g.id);
    assert.equal(channel.sent.length, before + 1, "لا نشر مكرر");
    i = await gw("info", { id: g.id });
    assert.match(H.textOf(i.replies), /active/);
  });

  await t.test("إلغاء سحب مجدول يلغي مهمته", async () => {
    await gw("start", { prize: "ستُلغى", duration: "1h", "starts-in": "1h" });
    const g = latest();
    await gw("cancel", { id: g.id });
    assert.equal(app.giveaways.getById(g.id).status, "cancelled");
    await app.scheduler.tick(Date.now() + 2 * 3600_000);
    assert.equal(app.giveaways.getById(g.id).status, "cancelled");
  });

  await t.test("القوالب: حفظ واستخدام وحذف مع التحقق من الاسم", async () => {
    const source = app.db.prepare("SELECT * FROM giveaways WHERE prize = 'نيترو'").get();
    let i = await gw("template", { action: "save", name: "اسم فيه مسافة", id: source.id });
    assert.match(H.textOf(i.replies), /غير صالح/);
    await gw("template", { action: "save", name: "Weekly", id: source.id });
    i = await gw("template", { action: "list" });
    assert.match(H.textOf(i.replies), /weekly/);
    await gw("template", { action: "use", name: "weekly" });
    const g = latest();
    assert.equal(g.prize, "نيترو");
    assert.equal(g.min_level, 2);
    assert.equal(g.status, "active");
    await gw("template", { action: "delete", name: "weekly" });
    assert.equal(app.giveawaysPlusRepo.template(guild.id, "weekly"), null);
  });

  await t.test("صلاحيات: عضو عادي لا يستخدم أمر السحب", async () => {
    const i = await gw("list", {}, alice);
    assert.match(H.textOf(i.replies), /صلاحي/);
  });

  await t.test("تتبع الدعوات: معرفة الداعي، الوهمي، المغادرة، وشرط الدعوات", async () => {
    app.features.setForGuild(guild.id, "invites", true);
    const invites = new Map([["abc", { code: "abc", uses: 1, inviterId: bob.id }], ["one", { code: "one", uses: 0, inviterId: alice.id }]]);
    guild.invites = { fetch: async () => new Map([...invites].map(([k, v]) => [k, { ...v }])) };
    await app.invites.load(guild);

    invites.get("abc").uses = 2;
    const newbie = H.fakeMember(guild, "700000000000000020");
    newbie.user.createdTimestamp = Date.now() - 400 * 86_400_000;
    await app.invites.onMemberAdd(newbie);
    assert.equal(app.invitesRepo.inviterOf(guild.id, newbie.id).inviter_id, bob.id);

    // رابط أحادي الاستخدام يختفي بعد استعماله
    invites.delete("one");
    const fresh = H.fakeMember(guild, "700000000000000021");
    fresh.user.createdTimestamp = Date.now() - 86_400_000;
    await app.invites.onMemberAdd(fresh);
    assert.equal(app.invitesRepo.inviterOf(guild.id, fresh.id).inviter_id, alice.id);
    assert.equal(app.invitesRepo.inviterOf(guild.id, fresh.id).fake, 1, "حساب عمره يوم = وهمي");
    assert.equal(app.invites.count(guild.id, alice.id), 0);

    assert.equal(app.invites.count(guild.id, bob.id), 1);
    app.invites.onMemberRemove(newbie);
    assert.equal(app.invites.count(guild.id, bob.id), 0);
    assert.equal(app.invitesRepo.stats(guild.id, bob.id).left, 1);

    await gw("start", { prize: "للداعين", duration: "1h", "min-invites": 1 });
    const g = latest();
    let i = await enter(bob, g);
    assert.match(H.textOf(i.replies), /1 دعوة/);
    invites.get("abc").uses = 3;
    await app.invites.onMemberAdd(H.fakeMember(guild, "700000000000000022"));
    await enter(bob, g);
    assert.equal(app.giveaways.hasEntered(g.id, bob.id), true);

    app.commands.cooldowns.clear();
    const m = H.fakeSlash(bob, channel, { command: "عضو", sub: "invites" });
    await app.commands.handleInteraction(m);
    assert.match(H.textOf(m.replies), /📨/);
  });
});
