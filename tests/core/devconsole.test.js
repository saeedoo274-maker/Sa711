const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("لوحة المطور ومركز الاختبار", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const dev = H.fakeMember(guild, "900000000000000009");
  const owner = H.fakeMember(guild, "300000000000000003", { admin: true });

  const run = async (member, sub, options = {}) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(member, general, { command: "مطور", sub, options });
    await app.commands.handleInteraction(i);
    return H.textOf(i.replies);
  };

  await t.test("مالك السيرفر ليس مطورًا", async () => {
    assert.match(await run(owner, "test"), /للمطور|المطور|developer/i);
  });

  await t.test("مركز الاختبار يعمل ويغطي الفحوص الأساسية", async () => {
    const text = await run(dev, "test");
    assert.match(text, /Test Center/);
    for (const name of ["database.integrity", "database.migrations", "commands.registry", "plugins.health", "i18n.coverage", "scheduler"]) {
      assert.match(text, new RegExp(name.replace(".", "\\.")));
    }
    const report = app.testCenter.lastReport;
    const fails = report.results.filter((r) => r.status === "fail" && !["discord.gateway", "scheduler"].includes(r.name));
    assert.deepEqual(fails, [], "لا فشل في بيئة الاختبار سوى ما يتطلب اتصالًا حقيقيًا");
  });

  await t.test("الهجرات: حالة، سلامة، تراجع يتطلب تأكيدًا", async () => {
    assert.match(await run(dev, "migrations"), /Migrations — (\d+)\/\1/);
    assert.match(await run(dev, "migrations", { action: "integrity" }), /ok/);
    assert.match(await run(dev, "migrations", { action: "rollback", name: "plugin/search/001_x.sql" }), /confirm/);
  });

  await t.test("الإضافات والأعلام العامة", async () => {
    assert.match(await run(dev, "plugins"), /tickets-plus/);
    await run(dev, "flags", { name: "search", state: "off" });
    assert.equal(app.features.globallyEnabled("search"), false);
    await run(dev, "flags", { name: "search", state: "default" });
    assert.equal(app.features.globallyEnabled("search"), true);
    assert.match(await run(dev, "flags", { name: "لا_يوجد", state: "off" }), /غير معروفة/);
  });

  await t.test("المهام: عرض وإلغاء", async () => {
    const job = app.scheduler.schedule({ type: "ticket:sla", runAt: Date.now() + 3_600_000, payload: { id: 1 } });
    assert.match(await run(dev, "jobs"), new RegExp(`s:${job.id}`));
    assert.match(await run(dev, "jobs", { cancel: `s:${job.id}` }), /تم إلغاء/);
    assert.match(await run(dev, "jobs", { cancel: "x:1" }), /لم يُلغَ/);
  });

  await t.test("صيانة أمر محدد تمنعه لغير المطور", async () => {
    await run(dev, "maint", { scope: "command", target: "بحث", enabled: true, message: "تحديث" });
    app.commands.cooldowns.clear();
    const i = H.fakeSlash(owner, general, { command: "بحث", options: { query: "x" } });
    await app.commands.handleInteraction(i);
    assert.match(H.textOf(i.replies), /تحديث/);
    await run(dev, "maint", { scope: "command", target: "بحث", enabled: false });
    assert.match(await run(dev, "maint", { scope: "module", enabled: true }), /حدد اسم/);
  });
});
