const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const H = require("../helpers/harness");

test("المنصة الأساسية", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));

  await t.test("الهجرات: كل ملفات الأساس مطبّقة، و027 قابلة للتراجع", () => {
    const status = app.database.migrationStatus();
    const core = status.filter((m) => !m.name.startsWith("plugin/"));
    assert.ok(core.length >= 27);
    assert.ok(core.every((m) => m.appliedAt), "كل هجرة أساسية مطبّقة");
    assert.equal(status.find((m) => m.name === "027_platform.sql").reversible, true);
    assert.equal(status.find((m) => m.name === "001_init.sql").reversible, false);
  });

  await t.test("فحص السلامة يمر على قاعدة جديدة", () => {
    const res = app.database.integrityCheck();
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  await t.test("مراقبة المعاملات تعدّ وتلتقط الفشل", () => {
    const before = app.database.txStats.total;
    app.db.transaction(() => app.platform.setState("t", 1))();
    assert.throws(() => app.db.transaction(() => { throw new Error("boom"); })());
    assert.equal(app.database.txStats.total, before + 2);
    assert.ok(app.database.txStats.failed >= 1);
  });

  await t.test("المجدول: مهمة لمرة واحدة تُنفَّذ مرة واحدة فقط", async () => {
    let runs = 0;
    app.scheduler.define("test:once", () => { runs++; });
    const job = app.scheduler.schedule({ type: "test:once", runAt: Date.now() - 1000, payload: { a: 1 } });
    await app.scheduler.tick();
    await app.scheduler.tick();
    assert.equal(runs, 1);
    assert.equal(app.scheduler.get(job.id).status, "done");
  });

  await t.test("المجدول: التكرار يعيد الجدولة ويحدّث الحمولة", async () => {
    app.scheduler.define("test:repeat", (job) => ({ payload: { n: (job.payload.n || 0) + 1 } }));
    const job = app.scheduler.schedule({ type: "test:repeat", runAt: Date.now() - 1, repeat: { kind: "interval", everyMs: 3_600_000 } });
    await app.scheduler.tick();
    const after = app.scheduler.get(job.id);
    assert.equal(after.status, "pending");
    assert.equal(after.payload.n, 1);
    assert.ok(after.run_at > Date.now() + 3_500_000);
  });

  await t.test("المجدول: الفشل يعيد المحاولة ثم يُعلَّم فاشلًا", async () => {
    app.scheduler.define("test:fail", () => { throw new Error("nope"); });
    const job = app.scheduler.schedule({ type: "test:fail", runAt: Date.now() - 1, maxAttempts: 2 });
    await app.scheduler.tick();
    let row = app.scheduler.get(job.id);
    assert.equal(row.status, "pending");
    assert.equal(row.last_error, "nope");
    app.db.prepare("UPDATE scheduled_jobs SET run_at = ? WHERE id = ?").run(Date.now() - 1, job.id);
    await app.scheduler.tick();
    row = app.scheduler.get(job.id);
    assert.equal(row.status, "failed");
  });

  await t.test("المجدول: نوع غير معرّف لا يُستلم، والمفتاح الفريد لا يكرر", async () => {
    const orphan = app.scheduler.schedule({ type: "test:unknown", runAt: Date.now() - 1 });
    await app.scheduler.tick();
    assert.equal(app.scheduler.get(orphan.id).status, "pending");

    app.scheduler.define("test:key", () => {});
    const a = app.scheduler.schedule({ type: "test:key", runAt: Date.now() + 60_000, uniqueKey: "k1" });
    const b = app.scheduler.schedule({ type: "test:key", runAt: Date.now() + 120_000, uniqueKey: "k1" });
    assert.equal(a.id, b.id);
    assert.ok(b.run_at > a.run_at);
    assert.equal(app.scheduler.cancelByKey("k1"), true);
  });

  await t.test("المجدول: المهام العالقة تُستعاد بعد إعادة التشغيل", () => {
    app.scheduler.define("test:stuck", () => {});
    const job = app.scheduler.schedule({ type: "test:stuck", runAt: Date.now() - 1 });
    app.platform.claimJob(job.id);
    assert.equal(app.scheduler.get(job.id).status, "running");
    app.scheduler.start();
    app.scheduler.stop();
    assert.equal(app.scheduler.get(job.id).status, "pending");
  });

  await t.test("الطابور: تنفيذ مع تقدّم ونتيجة", async () => {
    app.queue.define("test:work", async (job, tools) => {
      for (let i = 1; i <= 3; i++) tools.progress(i, 3);
      return { sum: job.payload.a + job.payload.b };
    });
    const job = app.queue.add("test:work", { a: 2, b: 3 });
    await app.queue.pump("test:work");
    const done = app.queue.get(job.id);
    assert.equal(done.status, "done");
    assert.equal(done.progress, 3);
    assert.deepEqual(done.result, { sum: 5 });
  });

  await t.test("الطابور: الإلغاء أثناء التنفيذ يوقف العامل", async () => {
    let steps = 0;
    app.queue.define("test:cancel", async (job, tools) => {
      for (let i = 0; i < 10; i++) {
        if (tools.isCancelled()) return { stopped: i };
        steps++;
        if (i === 2) app.queue.cancel(job.id);
      }
      return { stopped: null };
    });
    const job = app.queue.add("test:cancel", {});
    await app.queue.pump("test:cancel");
    assert.equal(app.queue.get(job.id).status, "cancelled");
    assert.equal(steps, 3);
  });

  await t.test("الطابور: الفشل يعيد المحاولة بتأخير ثم يفشل نهائيًا", async () => {
    app.queue.define("test:qfail", async () => { throw new Error("bad"); });
    const job = app.queue.add("test:qfail", {}, { maxAttempts: 1 });
    await app.queue.pump("test:qfail");
    assert.equal(app.queue.get(job.id).status, "failed");
    assert.throws(() => app.queue.add("no:such:queue", {}));
  });

  await t.test("الصيانة: عامة/نظام/أمر، والمطور يتجاوز، والحالة محفوظة", () => {
    const ms = app.maintenanceService;
    assert.equal(app.maintenance, false);
    app.maintenance = true; // الواجهة القديمة ما زالت تعمل
    assert.equal(ms.check({ userId: "1" }).blocked, true);
    assert.equal(ms.check({ userId: "900000000000000009" }).blocked, false, "المطور يتجاوز");
    app.maintenance = false;

    ms.set("module", "tickets", { enabled: true, message: "تحديث التذاكر" });
    assert.deepEqual(
      { blocked: ms.check({ module: "tickets", userId: "1" }).blocked, msg: ms.check({ module: "tickets", userId: "1" }).message },
      { blocked: true, msg: "تحديث التذاكر" }
    );
    assert.equal(ms.check({ module: "economy", userId: "1" }).blocked, false);

    ms.set("command", "بنك", { enabled: true, startsAt: Date.now() + 3_600_000 });
    assert.equal(ms.check({ command: "بنك", userId: "1" }).blocked, false, "المجدولة لم تبدأ بعد");
    ms.set("command", "بنك", { enabled: true, endsAt: Date.now() - 1 });
    assert.equal(ms.check({ command: "بنك", userId: "1" }).blocked, false, "المنتهية لا تمنع");
    assert.equal(ms.expire("command", "بنك"), true);

    const persisted = app.platform.getState("maintenance");
    assert.ok(persisted.modules.tickets.enabled);
    assert.ok(ms.log(10).length >= 4);
  });

  await t.test("أعلام الميزات: الافتراضي، السيرفر، والتعطيل العام", () => {
    const g = "200000000000000002";
    app.guilds.ensure(g);
    assert.equal(app.features.isEnabled(g, "tickets"), true, "الأنظمة القديمة مفعّلة افتراضيًا");
    app.features.setForGuild(g, "tickets", false);
    assert.equal(app.features.isEnabled(g, "tickets"), false);
    assert.equal(app.features.isEnabled("200000000000000099", "tickets"), true, "لا تسرّب بين السيرفرات");
    app.features.setForGuild(g, "tickets", null);
    app.features.setGlobal("tickets", false);
    assert.equal(app.features.isEnabled(g, "tickets"), false);
    app.features.setGlobal("tickets", null);
    assert.equal(app.features.isEnabled(g, "tickets"), true);
  });

  await t.test("الثيم: التحقق، السقوط على الافتراضي، وعزل السيرفرات", () => {
    const g = "200000000000000002";
    assert.equal(app.theme.color(g, "primary"), app.config.color("primary"));
    const bad = app.theme.update(g, { colors: { primary: "red" }, logoUrl: "http://x" });
    assert.equal(bad.ok, false);
    assert.equal(bad.errors.length, 2);
    const ok = app.theme.update(g, { colors: { primary: "#112233", error: "#ff0000" }, footer: "فوتر" });
    assert.equal(ok.ok, true);
    assert.equal(app.theme.color(g, "primary"), 0x112233);
    assert.equal(app.theme.color(g, "danger"), 0xff0000);
    assert.equal(app.theme.color("200000000000000099", "primary"), app.config.color("primary"));
    const embed = app.theme.embed(g, { title: "x" }).toJSON();
    assert.equal(embed.footer.text, "فوتر");
    assert.equal(embed.color, 0x112233);
  });

  await t.test("الترجمة: لغة لكل سيرفر مع سقوط مفتاح بمفتاح على العربية", () => {
    const g = "200000000000000002";
    assert.equal(app.i18n.tg(g, "common.cancel"), "إلغاء");
    app.guildConfig.set(g, "language", "en");
    assert.equal(app.i18n.tg(g, "common.cancel"), "Cancel");
    assert.equal(app.i18n.t("common.__missing__", {}, "en"), "common.__missing__");
    app.guildConfig.set(g, "language", "xx");
    assert.equal(app.i18n.tg(g, "common.cancel"), "إلغاء", "لغة غير موجودة تسقط على الافتراضية");
    app.guildConfig.set(g, "language", "ar");
    for (const lang of ["en", "fr", "tr", "es"]) assert.ok(app.i18n.has(lang), `اللغة ${lang} محمّلة`);
  });

  await t.test("الإشعارات: احترام تفضيل الخاص ورفض روابط غير ديسكورد", async () => {
    const g = "200000000000000002";
    const r1 = await app.notifications.notify({ guildId: g, userId: "700000000000000007", category: "reminders", payload: "hi" });
    assert.deepEqual(r1.sent, ["dm"]);
    app.notifications.setPreference(g, "700000000000000007", "reminders", false);
    const r2 = await app.notifications.notify({ guildId: g, userId: "700000000000000007", category: "reminders", payload: "hi" });
    assert.deepEqual(r2.skipped, ["dm:optOut"]);
    const r3 = await app.notifications.notify({ guildId: g, payload: "x", targets: ["webhook"], webhookUrl: "https://evil.example/api" });
    assert.deepEqual(r3.skipped, ["webhook:invalid"]);
  });

  await t.test("التراجع عن هجرة 027 ثم إعادة تطبيقها على قاعدة منفصلة", async () => {
    const other = await H.createApp();
    try {
      // الإضافات تعتمد على جداول الأساس؛ نتراجع عن 027 بالاسم للتحقق من المسار
      const res = other.database.rollback("027_platform.sql");
      assert.equal(res.ok, true);
      assert.equal(other.db.prepare("SELECT name FROM sqlite_master WHERE name = 'scheduled_jobs'").get(), undefined);
      assert.equal(other.database.rollback("001_init.sql").reason, "irreversible");
      other.database.runMigrations(other.plugins.migrationSources());
      assert.ok(other.db.prepare("SELECT name FROM sqlite_master WHERE name = 'scheduled_jobs'").get());
    } finally {
      H.cleanup(other);
    }
  });
});

test("مدير الإضافات: التحقق والترتيب والتبعيات", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugins-"));
  const write = (name, manifest) => {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, "plugin.json"), JSON.stringify(manifest));
  };
  write("alpha", { name: "alpha", version: "1.0.0", dependencies: ["beta"] });
  write("beta", { name: "beta", version: "1.0.0" });
  write("gamma", { name: "gamma", version: "1.0.0", dependencies: ["missing"] });
  write("delta", { name: "wrong", version: "1.0.0" });
  write("eps", { name: "eps", version: "1.0" });
  write("cyc-a", { name: "cyc-a", version: "1.0.0", dependencies: ["cyc-b"] });
  write("cyc-b", { name: "cyc-b", version: "1.0.0", dependencies: ["cyc-a"] });

  const PluginManager = require(path.join(H.ROOT, "src/core/plugins/PluginManager"));
  const logs = [];
  const fakeApp = {
    logger: { error: (m) => logs.push(m), info() {}, warn() {} },
    config: { guildDefaults: {} },
    i18n: { addDirectory() {}, load() {} }
  };
  const pm = new PluginManager(fakeApp, dir);
  const order = pm.discover();
  assert.deepEqual(order, ["beta", "alpha"], "التبعية تُحمَّل أولًا، والمعطوب يُستبعد");
  assert.equal(pm.get("gamma").status, "invalid");
  assert.equal(pm.get("delta").status, "invalid");
  assert.equal(pm.get("eps").status, "invalid");
  assert.equal(pm.get("cyc-a").status, "invalid");
  fs.rmSync(dir, { recursive: true, force: true });
});
