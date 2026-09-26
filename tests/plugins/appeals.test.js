const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("الاستئنافات", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const review = H.fakeChannel(guild, "400000000000000010", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const mod = H.fakeMember(guild, "600000000000000061", { admin: true, rolePosition: 10 });
  const alice = H.fakeMember(guild, "700000000000000007");
  mod.client = app.client;
  const timeouts = [];
  alice.timeout = async (ms) => timeouts.push(ms);
  const unbans = [];
  guild.bans = { remove: async (id) => unbans.push(id) };
  guild.members.ban = async () => {};

  const slash = async (command, sub, options = {}, member = admin) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(member, general, { command, sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const route = async (member, customId, opts = {}, dm = false) => {
    const i = H.fakeComponent(member, general, customId, opts);
    if (dm) {
      i.guild = null;
      i.member = null;
    }
    await app.interactions.route(i);
    return i;
  };
  const reason = "أعتذر عن الخطأ ولن يتكرر، كان سوء فهم.";

  await t.test("بدون قناة مراجعة: الاستئناف غير متاح ولا زر في الرسالة الخاصة", async () => {
    assert.deepEqual(app.appeals.dmComponents(guild, "warn"), []);
    const c = app.cases.create({ guildId: guild.id, type: "warn", targetId: alice.id, moderatorId: admin.id, reason: "x" });
    assert.equal(app.appeals.eligibility(guild.id, alice.id, c).reason, "disabled");
  });

  await t.test("الإعداد عبر /اعداد appeals", async () => {
    await slash("اعداد", "appeals", { channel: review, "cooldown-days": 1, max: 2 });
    assert.equal(app.appeals.config(guild.id).channelId, review.id);
    const row = app.appeals.dmComponents(guild, "ban")[0].toJSON();
    assert.equal(row.components[0].custom_id, `appeal:open:${guild.id}:ban`);
  });

  await t.test("زر الخاص يفتح نافذة، والإرسال ينشر للمراجعة، ولا يتكرر المعلّق", async () => {
    const warn = app.cases.create({ guildId: guild.id, type: "warn", targetId: alice.id, moderatorId: admin.id, reason: "سب" });
    let i = await route(alice, `appeal:open:${guild.id}:warn`, {}, true);
    assert.equal(i.modal.data.custom_id, `appeal:submit:${guild.id}:${warn.case_number}`);

    i = await route(alice, `appeal:submit:${guild.id}:${warn.case_number}`, { kind: "modal", fields: { reason: "قصير" } }, true);
    assert.match(H.textOf(i.replies), /أطول/);
    i = await route(alice, `appeal:submit:${guild.id}:${warn.case_number}`, { kind: "modal", fields: { reason } }, true);
    assert.match(H.textOf(i.replies), /تم إرسال/);
    assert.equal(review.sent.length, 1);
    i = await route(alice, `appeal:submit:${guild.id}:${warn.case_number}`, { kind: "modal", fields: { reason } }, true);
    assert.match(H.textOf(i.replies), /قيد المراجعة/);
    assert.equal(app.appealsRepo.forCase(guild.id, warn.case_number).length, 1);
  });

  await t.test("المراجعة: صاحب الاستئناف لا يراجع، عضو عادي لا يراجع، القبول ذرّي ويغلق التحذير", async () => {
    const appeal = app.appealsRepo.pending(guild.id)[0];
    let i = await route(alice, `appeal:accept:${appeal.id}`);
    assert.match(H.textOf(i.replies), /لا تملك|مراجعة/);
    i = await route(mod, `appeal:accept:${appeal.id}`);
    assert.equal(app.appealsRepo.get(appeal.id).status, "accepted");
    assert.equal(app.cases.getByNumber(guild.id, appeal.case_number).active, 0);
    assert.deepEqual(i.replies.at(-1).update.components, []);
    i = await route(admin, `appeal:reject:${appeal.id}`);
    assert.match(H.textOf(i.replies), /بالفعل/);
  });

  await t.test("رفض ثم تبريد، ثم الحد الأقصى لكل قضية", async () => {
    const warn = app.cases.create({ guildId: guild.id, type: "warn", targetId: alice.id, moderatorId: admin.id, reason: "إزعاج" });
    await app.appeals.submit(guild.id, alice.user, warn.case_number, reason);
    const first = app.appealsRepo.pending(guild.id)[0];
    await route(mod, `appeal:reject:${first.id}`);
    assert.equal(app.appealsRepo.get(first.id).status, "rejected");
    let res = await app.appeals.submit(guild.id, alice.user, warn.case_number, reason);
    assert.equal(res.reason, "cooldown");
    app.db.prepare("UPDATE appeals SET reviewed_at = ? WHERE id = ?").run(Date.now() - 2 * 86_400_000, first.id);
    res = await app.appeals.submit(guild.id, alice.user, warn.case_number, reason);
    assert.equal(res.ok, true);
    await route(mod, `appeal:reject:${res.appeal.id}`);
    app.db.prepare("UPDATE appeals SET reviewed_at = ? WHERE guild_id = ?").run(Date.now() - 5 * 86_400_000, guild.id);
    res = await app.appeals.submit(guild.id, alice.user, warn.case_number, reason);
    assert.equal(res.reason, "max");
  });

  await t.test("قبول استئناف الحظر يفك الحظر عبر نظام الإشراف ويُنشئ قضية فك حظر", async () => {
    const ban = app.cases.create({ guildId: guild.id, type: "ban", targetId: "700000000000000055", moderatorId: admin.id, reason: "مخالفة" });
    const res = await app.appeals.submit(guild.id, H.fakeUser("700000000000000055"), ban.case_number, reason);
    await route(mod, `appeal:accept:${res.appeal.id}`);
    assert.deepEqual(unbans, ["700000000000000055"]);
    assert.equal(app.cases.getByNumber(guild.id, ban.case_number).active, 0);
    assert.equal(app.cases.listByTarget(guild.id, "700000000000000055", { type: "unban" }).length, 1);
  });

  await t.test("/عضو appeal داخل السيرفر يفتح النافذة، وخطها الزمني في القضية", async () => {
    const to = app.cases.create({ guildId: guild.id, type: "timeout", targetId: alice.id, moderatorId: admin.id, reason: "سبام", durationMs: 3_600_000 });
    let i = await slash("عضو", "appeal", { case: to.case_number }, alice);
    assert.equal(i.modal.data.custom_id, `appeal:submit:${guild.id}:${to.case_number}`);
    i = await slash("عضو", "appeal", { case: to.case_number }, mod);
    assert.match(H.textOf(i.replies), /لا توجد عقوبة/);
    const res = await app.appeals.submit(guild.id, alice.user, to.case_number, reason);
    await route(mod, `appeal:accept:${res.appeal.id}`);
    assert.deepEqual(timeouts, [null]);
    const tl = app.casework.timeline(guild.id, app.cases.getByNumber(guild.id, to.case_number));
    assert.ok(tl.some((e) => e.kind === "appeal"));
  });
});
