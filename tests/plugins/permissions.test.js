const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("منشئ الصلاحيات", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const botsCh = H.fakeChannel(guild, "400000000000000012", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const helper = H.fakeRole("893000000000000001");
  const muted = H.fakeRole("893000000000000002");
  guild.roles.cache.set(helper.id, helper);
  guild.roles.cache.set(muted.id, muted);
  const alice = H.fakeMember(guild, "700000000000000007", { roleIds: [helper.id] });
  const bob = H.fakeMember(guild, "700000000000000008", { roleIds: [muted.id] });

  const slash = async (member, channel, command, options = {}, sub = null) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(member, channel, { command, sub, options });
    await app.commands.handleInteraction(i);
    return H.textOf(i.replies);
  };
  const perm = (options) => slash(admin, general, "اعداد", options, "permissions");

  await t.test("سماح رتبة يتجاوز شرط المستوى لأمر محدد فقط", async () => {
    assert.match(await slash(alice, general, "بحث", { query: "x" }), /صلاحي/);
    await perm({ action: "allow", target: "find", role: helper });
    assert.equal(app.permissionRules.list(guild.id)[0].target, "بحث", "الاسم البديل يُطبَّع للاسم الأساسي");
    assert.match(await slash(alice, general, "بحث", { query: "x" }), /نتائج البحث/);
    assert.match(await slash(bob, general, "بحث", { query: "x" }), /صلاحي/);
  });

  await t.test("قائمة القنوات المسموحة ومنع القناة", async () => {
    await perm({ action: "allow", target: "بحث", channel: botsCh });
    assert.match(await slash(alice, general, "بحث", { query: "x" }), /غير مسموح في هذه القناة/);
    assert.match(await slash(alice, botsCh, "بحث", { query: "x" }), /نتائج البحث/);
    assert.match(await slash(admin, general, "بحث", { query: "x" }), /نتائج البحث/, "الأدمن لا يُقفل عليه");
  });

  await t.test("منع رتبة على مستوى النظام وعلى أمر فرعي", async () => {
    assert.match(await slash(bob, general, "عضو", {}, "badges"), /🏅/);
    await perm({ action: "deny", target: "system:member", role: muted });
    assert.match(await slash(bob, general, "عضو", {}, "badges"), /صلاحي/);
    await perm({ action: "remove", target: "system:member", role: muted });
    await perm({ action: "deny", target: "عضو:leaderboard", channel: general });
    assert.match(await slash(bob, general, "عضو", {}, "badges"), /🏅/);
    assert.match(await slash(bob, general, "عضو", {}, "leaderboard"), /غير مسموح/);
  });

  await t.test("الحماية: لا منح لأوامر المطور، أهداف مجهولة مرفوضة، والاختبار يشرح القرار", async () => {
    const devCommand = app.registry.all().find((c) => c.permissions?.developerOnly || (c.permissions?.level ?? 0) >= 4);
    assert.ok(devCommand);
    assert.match(await perm({ action: "allow", target: devCommand.name, role: helper }), /المالك أو المطور/);
    assert.match(await perm({ action: "deny", target: "لا_يوجد", role: helper }), /هدف غير معروف/);
    assert.match(await perm({ action: "test", target: "بحث", user: alice.user, channel: botsCh }), /✅.*allow/);
    assert.match(await perm({ action: "test", target: "بحث", user: bob.user, channel: botsCh }), /⛔/);
    assert.match(await perm({ action: "list" }), /بحث/);
    assert.match(await slash(alice, general, "اعداد", { action: "list" }, "permissions"), /صلاحي/);
    await perm({ action: "clear" });
    assert.equal(app.permissionRules.list(guild.id).length, 0);
    assert.match(await slash(alice, botsCh, "بحث", { query: "x" }), /صلاحي/);
  });

  await t.test("تعطيل النظام يعيد السلوك الافتراضي", async () => {
    await perm({ action: "allow", target: "بحث", role: helper });
    app.features.setForGuild(guild.id, "permissions", false);
    assert.match(await slash(alice, general, "بحث", { query: "x" }), /صلاحي/);
  });
});
