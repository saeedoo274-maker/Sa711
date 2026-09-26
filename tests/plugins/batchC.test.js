const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("السجلات، سجل الأعضاء، التحليلات، الترحيب، التحقق، الإعدادات", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const logCh = H.fakeChannel(guild, "400000000000000005", { app });
  const welcomeCh = H.fakeChannel(guild, "400000000000000006", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const staffRole = H.fakeRole("860000000000000086");
  const alice = H.fakeMember(guild, "700000000000000007");

  // الإعدادات صارت من /لوحة ← الأنظمة والإعدادات
  const panel = (customId, opts = {}) => H.panelClick(app, admin, general, customId, opts);
  const pick = (customId, values) => panel(customId, { values, kind: "select" });

  await t.test("الإعدادات: قنوات السجلات عبر /لوحة ← السجلات", async () => {
    for (const category of ["messages", "members", "moderation", "roles", "tickets", "suggestions", "verification"]) {
      await pick(`panel:sysa:logs:cat:${category}`, [logCh.id]);
    }
    assert.equal(app.guildConfig.value(guild.id, "logs.messages"), logCh.id);
  });

  await t.test("سجل حذف الرسالة وتعديلها (التعديل بلا تغيير نص يُتجاهل)", async () => {
    const msg = H.fakeMessage(alice, general, "رسالة ستُحذف");
    await app.logs.messageDelete(msg);
    assert.match(H.textOf([logCh.sent.at(-1).payload]), /رسالة ستُحذف/);
    const before = logCh.sent.length;
    await app.logs.messageUpdate({ ...msg, partial: false }, { ...msg });
    assert.equal(logCh.sent.length, before);
    await app.logs.messageUpdate({ ...msg, partial: false }, { ...msg, content: "بعد التعديل" });
    assert.match(H.textOf([logCh.sent.at(-1).payload]), /بعد التعديل/);
  });

  await t.test("تعطيل نوع سجل واحد لا يؤثر على غيره، و all يعيد الكل", async () => {
    await pick("panel:sysa:logs:ev:0", ["messageDelete"]);
    assert.equal(app.logs.isEnabled(guild.id, "messageDelete"), false);
    const before = logCh.sent.length;
    await app.logs.messageDelete(H.fakeMessage(alice, general, "لن تُسجَّل"));
    assert.equal(logCh.sent.length, before);
    await app.logs.memberJoin(alice);
    assert.equal(logCh.sent.length, before + 1, "سجل الدخول ما زال يعمل");
    await panel("panel:sysa:logs:allon");
    assert.equal(app.logs.isEnabled(guild.id, "messageDelete"), true);
  });

  await t.test("حظر نفّذه البوت لا يُسجَّل مرتين عند وصول حدث ديسكورد", async () => {
    app.bus.emitSafe(require("../../src/core/events/EventBus").Events.MEMBER_BANNED, {
      guild, case: { case_number: 1, target_id: alice.id, moderator_id: admin.id, type: "ban", reason: "x" }
    });
    await new Promise((r) => setTimeout(r, 10));
    const before = logCh.sent.length;
    await app.logs.banAdd({ guild, user: alice.user, reason: "x" });
    assert.equal(logCh.sent.length, before);
    const bob = H.fakeUser("700000000000000044");
    await app.logs.banAdd({ guild, user: bob, reason: "يدوي" });
    assert.equal(logCh.sent.length, before + 1, "الحظر اليدوي من خارج البوت يُسجَّل");
  });

  await t.test("أحداث الأنظمة على الناقل تصل للسجل (تذكرة)", async () => {
    const before = logCh.sent.length;
    app.bus.emitSafe("ticket:created", { guild, ticket: { channel_id: general.id, number: 7, owner_id: alice.id }, member: alice });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(logCh.sent.length, before + 1);
    assert.match(H.textOf([logCh.sent.at(-1).payload]), /#7/);
  });

  await t.test("سجل الأعضاء: التخزين المؤقت ثم التفريغ، الأسماء، الرتب، الدخول", async () => {
    for (let i = 0; i < 5; i++) app.history.onMessage(H.fakeMessage(alice, general, `m${i}`));
    assert.equal(app.historyRepo.activity(guild.id, alice.id, "2000-01-01").messages, 0, "لم يُكتب قبل التفريغ");
    app.history.flush();
    assert.equal(app.historyRepo.activity(guild.id, alice.id, "2000-01-01").messages, 5);

    app.history.onUserUpdate({ ...alice.user, username: "old_alice", partial: false }, { ...alice.user, username: "new_alice" });
    const oldRoles = H.collection();
    const newRoles = H.collection([[staffRole.id, staffRole]]);
    app.history.onMemberUpdate({ partial: false, nickname: null, roles: { cache: oldRoles } }, { id: alice.id, guild, nickname: "أليس", roles: { cache: newRoles } });
    app.history.onJoin(alice);
    const names = app.historyRepo.names(guild.id, alice.id);
    assert.ok(names.some((n) => n.kind === "username" && n.new_value === "new_alice"));
    assert.ok(names.some((n) => n.kind === "nickname" && n.new_value === "أليس"));
    assert.equal(app.historyRepo.roles(guild.id, alice.id)[0].role_id, staffRole.id);
    assert.equal(app.historyRepo.presenceCounts(guild.id, alice.id).joins, 1);
    assert.equal(app.historyRepo.searchByName(guild.id, "old_al")[0].user_id, alice.id, "البحث بالاسم القديم");
  });

  await t.test("/عضو history: ملف موحّد مع قائمة أقسام للمالك فقط", async () => {
    app.commands.cooldowns.clear();
    const i = H.fakeSlash(admin, general, { command: "عضو", sub: "history", options: { user: alice.user } });
    await app.commands.handleInteraction(i);
    const text = H.textOf(i.replies);
    assert.match(text, /نظرة عامة/);
    const menuId = i.replies[0].components[0].toJSON().components[0].custom_id;
    const pick = H.fakeComponent(admin, general, menuId, { kind: "select", values: ["names"] });
    await app.interactions.route(pick);
    assert.match(H.textOf(pick.replies), /new_alice/);
    const denied = H.fakeComponent(alice, general, menuId, { kind: "select", values: ["names"] });
    await app.interactions.route(denied);
    assert.match(H.textOf(denied.replies), /ليست لك/);

    app.commands.cooldowns.clear();
    const member = H.fakeSlash(alice, general, { command: "عضو", sub: "history", options: { user: admin.user } });
    await app.commands.handleInteraction(member);
    assert.match(H.textOf(member.replies), /الصلاحية/);
  });

  await t.test("التحليلات تجمع من الجداول الموجودة مباشرة", async () => {
    const now = Date.now();
    app.db.prepare("INSERT INTO tickets (guild_id, channel_id, owner_id, status, created_at, claimed_by, claimed_at, closed_at, closed_by) VALUES (?, 'c1', ?, 'closed', ?, ?, ?, ?, ?)")
      .run(guild.id, alice.id, now - 3_600_000, admin.id, now - 3_000_000, now - 1_000_000, admin.id);
    app.analytics.cache.clear();
    const data = app.analytics.server(guild.id, "7d");
    assert.equal(data.series.messages.length, 7);
    assert.equal(data.totals.messages, 5);
    assert.equal(data.totals.ticketsOpened, 1);
    assert.equal(data.totals.ticketsClosed, 1);
    assert.equal(data.totals.joins, 1);
    assert.ok(Math.abs(data.tickets.avgResponse - 600_000) < 1000);

    app.commands.cooldowns.clear();
    const i = H.fakeSlash(admin, general, { command: "ادارة", sub: "analytics", options: { type: "server", period: "7d" } });
    await app.commands.handleInteraction(i);
    const payload = i.replies.at(-1);
    assert.match(H.textOf([payload]), /تحليلات السيرفر/);
    assert.equal(!!payload.files?.length, require("../../src/core/utils/canvas").available(), "رسم بياني عند توفر المكتبة");
  });

  await t.test("الترحيب: قناة + متغيرات + خاص + معاينة، والوداع", async () => {
    await pick("panel:syscs:wel:0", [welcomeCh.id]);
    await pick("panel:sysb:wel", ["2"]); // الرسالة الخاصة
    await pick("panel:sysb:wel", ["1"]); // صورة الترحيب
    assert.equal(app.welcome.config(guild.id).dm.enabled, true);
    app.guildConfig.set(guild.id, "welcome.message", "أهلًا {USER} رقم {MEMBER_COUNT} في {SERVER_NAME}");
    const newbie = H.fakeMember(guild, "700000000000000055");
    await app.plugins.dispatch("guildMemberAdd", [newbie]);
    const sent = welcomeCh.sent.at(-1);
    assert.match(sent.content, /أهلًا <@700000000000000055> رقم 10 في Test Server/);
    assert.ok(sent.payload.embeds?.length);
    assert.equal(!!sent.payload.files?.length, require("../../src/core/utils/canvas").available());
    assert.ok(app.__sent.some((d) => d.to === newbie.id), "رسالة خاصة");

    const preview = await panel("panel:sysa:wel:test");
    assert.match(H.textOf(preview.replies), /معاينة/);

    await pick("panel:syscs:wel:2", [welcomeCh.id]);
    await app.plugins.dispatch("guildMemberRemove", [newbie]);
    assert.match(welcomeCh.sent.at(-1).content, /وداعًا/);
  });

  await t.test("الترحيب: نموذج تعديل النصوص يحفظ ويرفض الروابط غير الآمنة", async () => {
    const submit = H.fakeComponent(admin, general, "cfg:wel:welcome", {
      kind: "modal",
      fields: { message: "مرحبا {USER}", title: "عنوان", description: "وصف", image: "http://insecure.example/x.png", thumbnail: "{USER_AVATAR}" }
    });
    await app.interactions.route(submit);
    const w = app.welcome.config(guild.id);
    assert.equal(w.message, "مرحبا {USER}");
    assert.equal(w.embed.image, null, "رابط http مرفوض");
    assert.equal(w.embed.thumbnail, "{USER_AVATAR}");
    const denied = H.fakeComponent(alice, general, "cfg:wel:welcome", { kind: "modal", fields: { message: "x" } });
    await app.interactions.route(denied);
    assert.equal(app.welcome.config(guild.id).message, "مرحبا {USER}");
  });

  await t.test("التحقق: رتبة غير متحقق عند الدخول، والزر يمنح ويزيل ويسجّل", async () => {
    const verified = H.fakeRole("870000000000000087", { position: 3 });
    const unverified = H.fakeRole("870000000000000088", { position: 2 });
    guild.roles.cache.set(verified.id, verified);
    guild.roles.cache.set(unverified.id, unverified);
    await pick("panel:sysrs:ver:0", [verified.id]);
    await pick("panel:sysrs:ver:1", [unverified.id]);
    await pick("panel:sysa:pub:ch:ver", [general.id]);
    assert.match(JSON.stringify(general.sent.at(-1).payload.components[0].toJSON()), /verify:go/);

    const joiner = H.fakeMember(guild, "700000000000000066");
    await app.plugins.dispatch("guildMemberAdd", [joiner]);
    assert.ok(joiner.roles.cache.has(unverified.id));
    const click = H.fakeComponent(joiner, general, "verify:go");
    await app.interactions.route(click);
    assert.ok(joiner.roles.cache.has(verified.id));
    assert.ok(!joiner.roles.cache.has(unverified.id));
    assert.match(H.textOf(click.replies), /تم التحقق/);
    const again = H.fakeComponent(joiner, general, "verify:go");
    await app.interactions.route(again);
    assert.match(H.textOf(again.replies), /مسبقًا/);
    assert.equal(app.verification.stats(guild.id), 1);
  });

  await t.test("الإعدادات: اللغة والأنظمة والثيم", async () => {
    await pick("panel:sysa:feat:flip:0", ["levels"]);
    assert.equal(app.features.isEnabled(guild.id, "levels"), true);
    const theme = (fields) => panel("panel:sysa:theme:edit", { kind: "modal", fields: { primary: "", footer: "", logo: "", banner: "", ...fields } });
    const bad = await theme({ primary: "zzz" });
    assert.match(H.textOf(bad.replies), /غير صالحة/);
    await theme({ primary: "#ABCDEF", footer: "فريق السيرفر" });
    assert.equal(app.theme.color(guild.id, "primary"), 0xabcdef);
    const lang = await pick("panel:sysa:lang:set", ["en"]);
    assert.match(H.textOf(lang.replies), /Bot language/);
    app.guildConfig.set(guild.id, "language", "ar");

    const denied = await H.panelClick(app, alice, general, "panel:sysv:feat");
    assert.match(H.textOf(denied.replies), /الصلاحية/);
  });
});
