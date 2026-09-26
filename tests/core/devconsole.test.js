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

  await t.test("مدير التنظيف: معاينة لا تحذف، التنفيذ يحذف القديم فقط، والسياسات قابلة للتعديل", async () => {
    const old = Date.now() - 200 * 86_400_000;
    app.db.prepare("INSERT INTO error_logs (error_id, message, created_at) VALUES ('OLD1', 'x', ?)").run(old);
    app.db.prepare("INSERT INTO error_logs (error_id, message, created_at) VALUES ('NEW1', 'x', ?)").run(Date.now());
    let text = await run(dev, "cleanup");
    assert.match(text, /preview/);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS c FROM error_logs WHERE error_id IN ('OLD1','NEW1')").get().c, 2);
    assert.match(text, /`transactions`.*off/, "السجلات المالية معطّلة افتراضيًا");
    text = await run(dev, "cleanup", { action: "run", task: "errors" });
    assert.match(text, /done/);
    assert.deepEqual(app.db.prepare("SELECT error_id FROM error_logs WHERE error_id IN ('OLD1','NEW1')").all().map((r) => r.error_id), ["NEW1"]);
    await run(dev, "cleanup", { action: "set", task: "errors", days: 0 });
    assert.equal(app.cleanup.daysFor("errors"), 0);
    await run(dev, "cleanup", { action: "set", task: "errors", days: -1 });
    assert.equal(app.cleanup.daysFor("errors"), 90);
    assert.match(await run(dev, "cleanup", { action: "set", task: "nope", days: 5 }), /غير معروفة/);
  });

  await t.test("مدير التنظيف: بيانات السيرفرات المغادرة (اختياري)", async () => {
    const goneId = "200000000000000077";
    app.db.prepare("INSERT OR REPLACE INTO guild_registry (guild_id, name, joined_at, left_at, status) VALUES (?, 'gone', ?, ?, 'left')").run(goneId, Date.now() - 400 * 86_400_000, Date.now() - 100 * 86_400_000);
    app.guilds.ensure(goneId);
    app.cases.create({ guildId: goneId, type: "warn", targetId: "700000000000000007", moderatorId: dev.id });
    assert.equal(app.cleanup.run({ dryRun: false, only: "leftGuilds" }).total, 0, "معطّل افتراضيًا");
    app.cleanup.setPolicy("leftGuilds", 30);
    const preview = app.cleanup.run({ dryRun: true, only: "leftGuilds" });
    assert.ok(preview.total >= 1);
    app.cleanup.run({ dryRun: false, only: "leftGuilds" });
    assert.equal(app.db.prepare("SELECT COUNT(*) AS c FROM cases WHERE guild_id = ?").get(goneId).c, 0);
    assert.equal(app.db.prepare("SELECT status FROM guild_registry WHERE guild_id = ?").get(goneId).status, "purged");
    assert.ok(app.db.prepare("SELECT COUNT(*) AS c FROM cases WHERE guild_id = ?").get(guild.id).c >= 0);
  });
});
