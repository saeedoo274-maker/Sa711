const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");
const H = require("../helpers/harness");
const panel = require("../../src/modules/panel/interactions");
const { SYSTEMS } = require("../../src/modules/panel/systems");

/** يستخرج الحاوية وصفوفها من حمولة Components v2. */
function container(payload) {
  const p = payload?.update || payload;
  const json = p.components[0].toJSON();
  return { json, rows: json.components.filter((c) => c.type === 1), flags: p.flags };
}

function customIds(payload) {
  return container(payload).rows.flatMap((r) => r.components.map((c) => c.custom_id).filter(Boolean));
}

test("لوحة التحكم المركزية: قسم الأنظمة (Components v2)", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const logs = H.fakeChannel(guild, "400000000000000016", { app });
  const owner = H.fakeMember(guild, "300000000000000003", { admin: true });
  const admin = H.fakeMember(guild, "300000000000000005", { admin: true });
  const mod = H.fakeMember(guild, "300000000000000006", { permissions: [PermissionFlagsBits.KickMembers] });
  const alice = H.fakeMember(guild, "700000000000000007");
  const role = H.fakeRole("898000000000000001", { position: 5 });
  guild.roles.cache.set(role.id, role);

  const click = async (member, customId, opts = {}) => {
    const i = H.fakeComponent(member, general, customId, opts);
    await app.interactions.route(i);
    return i;
  };
  const last = (i) => i.replies.at(-1);

  await t.test("الرئيسية: زر الأنظمة يظهر للمشرف فما فوق فقط", async () => {
    assert.ok(customIds(panel.home(app, admin)).includes("panel:sys"));
    assert.ok(customIds(panel.home(app, mod)).includes("panel:sys"));
    assert.ok(!customIds(panel.home(app, alice)).includes("panel:sys"));
    assert.ok(panel.home(app, admin).flags, "اللوحة v2");
  });

  await t.test("المركز: قائمتان حسب الصلاحية، والعضو العادي مرفوض", async () => {
    const i = await click(admin, "panel:sys");
    const ids = customIds(last(i));
    assert.ok(ids.includes("panel:sysopen:cfg") && ids.includes("panel:sysopen:sys"));
    assert.match(H.textOf(i.replies), /الترحيب والوداع/);
    assert.match(H.textOf(i.replies), /رجوع|الرئيسية/);

    const m = await click(mod, "panel:sys");
    const text = H.textOf(m.replies);
    assert.match(text, /السحوبات/, "المشرف يرى أنظمته");
    assert.doesNotMatch(text, /"value":"lvl"/, "ولا يرى أنظمة الأدمن");

    assert.match(H.textOf((await click(alice, "panel:sys")).replies), /صلاحي/);
    assert.match(H.textOf((await click(mod, "panel:sysv:lvl")).replies), /صلاحي/, "الفحص عند كل ضغطة لا عند الإظهار");
  });

  await t.test("كل شاشة نظام تحترم حدود ديسكورد (5 صفوف، 5 عناصر، customId ≤ 100)", async () => {
    for (const sys of SYSTEMS) {
      const i = await click(owner, `panel:sysv:${sys.key}`);
      const payload = last(i);
      assert.ok(payload?.update, `${sys.key} يحدّث نفس الرسالة`);
      const { rows, flags } = container(payload);
      assert.ok(flags, `${sys.key} v2`);
      assert.ok(rows.length <= 5, `${sys.key}: ${rows.length} صفوف`);
      for (const r of rows) {
        assert.ok(r.components.length <= 5, `${sys.key}: صف فيه ${r.components.length}`);
        for (const c of r.components) if (c.custom_id) assert.ok(c.custom_id.length <= 100, c.custom_id);
      }
      assert.ok(customIds(payload).includes("panel:home"), `${sys.key}: تنقّل للرئيسية`);
      // كل عنصر معرّف في الوصف له زر فعلي (لم يُقصّ بسبب حد الصفوف)
      for (let n = 0; n < (sys.channels || []).length; n++) assert.ok(customIds(payload).includes(`panel:sysc:${sys.key}:${n}`), `${sys.key} قناة ${n}`);
      for (let n = 0; n < (sys.roles || []).length; n++) assert.ok(customIds(payload).includes(`panel:sysr:${sys.key}:${n}`), `${sys.key} رتبة ${n}`);
      for (let n = 0; n < (sys.lists || []).length; n++) assert.ok(customIds(payload).includes(`panel:sysl:${sys.key}:${n}`), `${sys.key} قائمة ${n}`);
      for (let n = 0; n < (sys.choices || []).length; n++) assert.ok(customIds(payload).includes(`panel:sysch:${sys.key}:${n}`), `${sys.key} خيار ${n}`);
      if (sys.texts?.length) assert.ok(customIds(payload).includes(`panel:sysx:${sys.key}`), `${sys.key} نصوص`);
      for (const a of sys.actions || []) {
        if (a.select || a.hidden) continue;
        assert.ok(customIds(payload).includes(a.goto || `panel:sysa:${sys.key}:${a.id}`), `${sys.key} إجراء ${a.id}`);
      }
    }
  });

  await t.test("المستويات: تشغيل، قناة، خيار، أرقام مع التحقق", async () => {
    const before = app.features.isEnabled(guild.id, "levels");
    await click(admin, "panel:syst:lvl");
    assert.equal(app.features.isEnabled(guild.id, "levels"), !before);

    await click(admin, "panel:syscs:lvl:0", { values: [general.id], kind: "select" });
    assert.equal(app.guildConfig.value(guild.id, "levels.levelUp.channelId"), general.id);
    await click(admin, "panel:syscx:lvl:0");
    assert.equal(app.guildConfig.value(guild.id, "levels.levelUp.channelId"), null);

    const stack = app.guildConfig.value(guild.id, "levels.stackRewards");
    await click(admin, "panel:sysb:lvl", { values: ["2"], kind: "select" });
    assert.equal(app.guildConfig.value(guild.id, "levels.stackRewards"), !stack);

    const modal = await click(admin, "panel:sysn:lvl:0");
    assert.ok(last(modal).modal, "نافذة الأرقام");

    await click(admin, "panel:sysns:lvl:0", { kind: "modal", fields: { n0: "10", n1: "40", n2: "30", n3: "", n4: "0" } });
    assert.equal(app.guildConfig.value(guild.id, "levels.messageXpMin"), 10);
    assert.equal(app.guildConfig.value(guild.id, "levels.messageXpMax"), 40);
    assert.equal(app.guildConfig.value(guild.id, "levels.cooldownMs"), 30_000, "الثواني تُخزَّن بالملي ثانية");

    let r = await click(admin, "panel:sysns:lvl:0", { kind: "modal", fields: { n0: "abc" } });
    assert.match(H.textOf(r.replies), /قيم غير صالحة/);
    r = await click(admin, "panel:sysns:lvl:0", { kind: "modal", fields: { n0: "90", n1: "50" } });
    assert.match(H.textOf(r.replies), /لم يُحفظ/);
    assert.equal(app.guildConfig.value(guild.id, "levels.messageXpMin"), 10, "التحقق المتقاطع يمنع الحفظ");
  });

  await t.test("الإعدادات العامة: اللغة، الأعلام، السجلات، والثيم", async () => {
    await click(admin, "panel:sysa:lang:set", { values: ["en"], kind: "select" });
    assert.equal(app.guildConfig.value(guild.id, "language"), "en");
    await click(admin, "panel:sysa:lang:set", { values: ["xx"], kind: "select" });
    assert.equal(app.guildConfig.value(guild.id, "language"), "en", "لغة غير مدعومة تُتجاهل");
    app.guildConfig.set(guild.id, "language", "ar");

    const games = app.features.isEnabled(guild.id, "games");
    await click(admin, "panel:sysa:feat:flip:0", { values: ["games", "panel"], kind: "select" });
    assert.equal(app.features.isEnabled(guild.id, "games"), !games);
    assert.equal(app.features.isEnabled(guild.id, "panel"), true, "اللوحة نفسها لا تُطفأ من اللوحة");

    await click(admin, "panel:sysa:logs:cat:members", { values: [logs.id], kind: "select" });
    assert.equal(app.guildConfig.value(guild.id, "logs.members"), logs.id);
    await click(admin, "panel:sysa:logs:cat:nope", { values: [logs.id], kind: "select" });
    assert.equal(app.guildConfig.value(guild.id, "logs.nope"), undefined, "فئة غير معروفة لا تُكتب");

    const confirm = await click(admin, "panel:sysa:logs:alloff");
    assert.match(H.textOf(confirm.replies), /متأكد/, "الإيقاف الشامل يحتاج تأكيدًا");

    let r = await click(admin, "panel:sysa:theme:edit", { kind: "modal", fields: { primary: "zz", footer: "", logo: "", banner: "" } });
    assert.match(H.textOf(r.replies), /غير صالحة/);
    await click(admin, "panel:sysa:theme:edit", { kind: "modal", fields: { primary: "#112233", footer: "سيرفرنا", logo: "", banner: "" } });
    assert.equal(app.theme.get(guild.id).colors.primary, "#112233");
    assert.equal(app.theme.get(guild.id).footer, "سيرفرنا");
    await click(admin, "panel:sysa:theme:reset:yes");
    assert.equal(app.theme.get(guild.id).footer, undefined);
  });

  await t.test("التحقق: رتبة قابلة للإدارة ثم النشر في قناة", async () => {
    const r = await click(admin, "panel:sysa:ver:pub:go", { values: [general.id], kind: "select" });
    assert.match(H.textOf(r.replies), /رتبة المتحقق أولًا/);
    const high = H.fakeRole("898000000000000002", { position: 500 });
    guild.roles.cache.set(high.id, high);
    assert.match(H.textOf((await click(admin, "panel:sysrs:ver:0", { values: [high.id], kind: "select" })).replies), /لا أستطيع/);
    await click(admin, "panel:sysrs:ver:0", { values: [role.id], kind: "select" });
    assert.equal(app.guildConfig.value(guild.id, "verification.roleId"), role.id);
    const before = general.sent.length;
    await click(admin, "panel:sysa:ver:pub:go", { values: [general.id], kind: "select" });
    assert.equal(general.sent.length, before + 1);
    assert.equal(app.guildConfig.value(guild.id, "verification.channelId"), general.id);
    const modal = await click(admin, "panel:sysa:ver:edit");
    assert.ok(last(modal).modal, "نفس نافذة /اعداد verify");
  });

  await t.test("الترحيب: نفس نوافذ الأمر، والمعاينة مخفية", async () => {
    const m = await click(admin, "panel:sysa:wel:welcome");
    assert.equal(last(m).modal.toJSON().custom_id, "cfg:wel:welcome", "الحفظ عبر معالج cfg الموجود");
    const p = await click(admin, "panel:sysa:wel:test");
    assert.equal(last(p).flags, 64);
  });

  await t.test("النسخ الاحتياطي لمالك السيرفر فقط", async () => {
    assert.match(H.textOf((await click(admin, "panel:sysa:bak:now")).replies), /صلاحي/);
    const n = app.guildBackups.list(guild.id).length;
    await click(owner, "panel:sysa:bak:now");
    assert.equal(app.guildBackups.list(guild.id).length, n + 1);
    await click(owner, "panel:sysa:bak:sched", { values: ["daily"], kind: "select" });
    assert.equal(app.guildConfig.value(guild.id, "guildBackup.schedule"), "daily");
    await click(owner, "panel:sysa:bak:sched", { values: ["off"], kind: "select" });
    assert.equal(app.guildConfig.value(guild.id, "guildBackup.schedule"), null);
  });

  await t.test("الأوامر المدموجة حُذفت، وأعلام أنظمتها باقية", async () => {
    for (const name of ["لوحة_تذاكر", "لوحة_الادارة", "خدمات", "رتب_ذاتية", "رتبة_تلقائية", "اعدادات_تذاكر", "تقرير_دوري"]) {
      assert.equal(app.registry.get(name), null, name);
    }
    const subs = (cmd) => (app.registry.get(cmd).slash.toJSON().options || []).map((o) => o.name);
    for (const gone of ["language", "features", "theme", "logs", "welcome", "goodbye", "welcome-button", "verify", "notifications", "appeals"]) {
      assert.ok(!subs("اعداد").includes(gone), `/اعداد ${gone}`);
    }
    assert.ok(subs("اعداد").includes("setup") && subs("اعداد").includes("backup"));
    assert.ok(!subs("بنك").includes("panel") && !subs("اختبار").includes("panel") && !subs("اقتراح").includes("settings"));
    for (const flag of ["roles", "services", "reports"]) assert.ok(app.features.isKnown(flag), flag);
  });

  await t.test("نشر اللوحات: تذاكر بنافذة، لوحة الإدارة، والخدمات", async () => {
    app.guildConfig.set(guild.id, "tickets.enabled", false);
    assert.match(H.textOf((await click(admin, "panel:sysa:pub:ch:tkt", { values: [general.id], kind: "select" })).replies), /فعّل نظام التذاكر/);
    app.guildConfig.set(guild.id, "tickets.enabled", true);
    const modal = await click(admin, "panel:sysa:pub:ch:tkt", { values: [general.id], kind: "select" });
    assert.equal(last(modal).modal.toJSON().custom_id, `panel:sysa:pub:mod:tkt.${general.id}`);
    const r = await click(admin, `panel:sysa:pub:mod:tkt.${general.id}`, { kind: "modal", fields: { title: "الدعم", description: "", button: "افتح | 🎫", color: "red", images: "" } });
    assert.match(H.textOf(r.replies), /#RRGGBB/, "لون غير صالح يُرفض قبل النشر");
    const before = general.sent.length;
    await click(admin, `panel:sysa:pub:mod:tkt.${general.id}`, { kind: "modal", fields: { title: "الدعم", description: "", button: "افتح | 🎫", color: "#112233", images: "" } });
    assert.equal(general.sent.length, before + 1);
    assert.match(JSON.stringify(general.sent.at(-1).payload.components[0].toJSON()), /ticket:open:/);
    assert.equal(app.tickets.listPanels(guild.id).length, 1);

    await click(admin, "panel:sysa:pub:ch:adm", { values: [logs.id], kind: "select" });
    assert.equal(app.guildConfig.value(guild.id, "staff.panelChannelId"), logs.id, "موقع لوحة الإدارة محفوظ لتحديثها");
    await click(admin, "panel:sysa:pub:ch:svc", { values: [logs.id], kind: "select" });
    assert.match(H.textOf([logs.sent.at(-1).payload]), /مركز الخدمات/);
    assert.match(H.textOf((await click(mod, "panel:sysa:pub:ch:svc", { values: [logs.id], kind: "select" })).replies), /صلاحي/);
  });

  await t.test("الرتب الذاتية: الرتب ← الشكل ← القناة ← النافذة، مع رفض رتبة غير قابلة للمنح", async () => {
    const top = H.fakeRole("898000000000000009", { position: 999 });
    guild.roles.cache.set(top.id, top);
    assert.match(H.textOf((await click(owner, "panel:sysa:pub:srroles", { values: [top.id], kind: "select" })).replies), /رتبة البوت أقل/);
    assert.match(H.textOf((await click(admin, "panel:sysa:pub:srroles", { values: [role.id], kind: "select" })).replies), /أعلى من رتبتك/, "لا توزيع رتبة أعلى من رتبة المنفّذ");
    await click(owner, "panel:sysa:pub:srroles", { values: [role.id], kind: "select" });
    await click(owner, "panel:sysa:pub:srstyle", { values: ["buttons"], kind: "select" });
    const m = await click(owner, "panel:sysa:pub:ch:sr", { values: [general.id], kind: "select" });
    assert.ok(last(m).modal);
    await click(owner, `panel:sysa:pub:mod:sr.${general.id}`, { kind: "modal", fields: { title: "اهتماماتك", max: "" } });
    assert.match(JSON.stringify(general.sent.at(-1).payload.components[0].toJSON()), new RegExp(`selfrole:btn:[0-9a-f]+:${role.id}`));
  });

  await t.test("الشاشات الفرعية تُبنى صالحة (قوائم، أحداث السجل، التقارير، نشر اللوحات)", async () => {
    app.guildConfig.set(guild.id, "levels.ignoredRoles", [role.id]);
    for (const id of ["panel:sysl:ar:0", "panel:sysl:lvl:1", "panel:sysl:sug:2", "panel:sysa:logs:ev", "panel:sysa:logs:cat", "panel:reports", "panel:sysa:pub:ch:quiz", "panel:sysa:wel:btndel"]) {
      const i = await click(owner, id);
      const payload = last(i);
      assert.ok(payload?.update, id);
      const { rows } = container(payload);
      assert.ok(rows.length && rows.length <= 5, `${id}: ${rows.length}`);
      for (const r of rows) assert.ok(r.components.length <= 5, id);
    }
    const lvl = container(last(await click(owner, "panel:sysl:lvl:1"))).rows[0].components[0];
    assert.deepEqual(lvl.default_values, [{ id: role.id, type: "role" }], "المحدد حاليًا يظهر مختارًا");
  });

  await t.test("القوائم والخيارات والنصوص العامة", async () => {
    await click(owner, "panel:sysls:ar:0", { values: [role.id], kind: "select" });
    assert.deepEqual(app.guildConfig.value(guild.id, "autoRoles.memberRoleIds"), [role.id]);
    assert.equal(app.guildConfig.value(guild.id, "autoRoles.enabled"), true, "إضافة رتبة تفعّل الرتب التلقائية");
    await click(admin, "panel:syslx:ar:0");
    assert.deepEqual(app.guildConfig.value(guild.id, "autoRoles.memberRoleIds"), []);

    await click(admin, "panel:sysch:apl:0", { values: ["ban", "warn"], kind: "select" });
    assert.deepEqual(app.appeals.config(guild.id).types, ["ban", "warn"]);
    app.guildConfig.set(guild.id, "levels.levelUp.channelId", null);
    assert.match(H.textOf((await click(admin, "panel:sysch:lvl:0", { values: ["channel"], kind: "select" })).replies), /قناة إعلان المستوى/);

    await click(admin, "panel:sysxs:afk", { kind: "modal", fields: { t0: "[غائب]" } });
    assert.equal(app.guildConfig.value(guild.id, "afk.nickPrefix"), "[غائب] ");
    await click(admin, "panel:sysxs:afk", { kind: "modal", fields: { t0: "" } });
    assert.equal(app.guildConfig.value(guild.id, "afk.nickPrefix"), "[غائب] ", "الحقل الفارغ لا يمسح");

    await click(admin, "panel:sysa:wel:btnadd", { kind: "modal", fields: { label: "القوانين", url: "http://x.com" } });
    assert.equal((app.welcome.config(guild.id).buttons || []).length, 0, "رابط غير آمن مرفوض");
    await click(admin, "panel:sysa:wel:btnadd", { kind: "modal", fields: { label: "القوانين", url: "https://example.com/rules" } });
    assert.equal(app.welcome.config(guild.id).buttons.length, 1);
    await click(admin, "panel:sysa:wel:btndel:go", { values: ["القوانين"], kind: "select" });
    assert.equal(app.welcome.config(guild.id).buttons.length, 0);
  });

  await t.test("التقارير الدورية والتذاكر من اللوحة", async () => {
    await click(admin, "panel:reportschedulesave", { kind: "modal", fields: { frequency: "daily", hour: "30", weekday: "1" } });
    assert.equal(app.reports.getSchedule(guild.id), null, "ساعة خارج المدى لا تُحفظ");
    await click(admin, "panel:reportschedulesave", { kind: "modal", fields: { frequency: "daily", hour: "8", weekday: "1" } });
    assert.equal(app.reports.getSchedule(guild.id).hour, 8);
    await click(admin, "panel:reportsections", { values: ["tickets", "staff"], kind: "select" });
    assert.deepEqual(app.reports.getSchedule(guild.id).sections, ["tickets", "staff"]);
    assert.match(H.textOf((await click(mod, "panel:reportsections", { values: ["tickets"], kind: "select" })).replies), /صلاحي/);

    const rating = app.guildConfig.value(guild.id, "tickets.ratingEnabled");
    await click(admin, "panel:toggle:tickets.ratingEnabled");
    assert.equal(app.guildConfig.value(guild.id, "tickets.ratingEnabled"), !rating, "زر التقييم يعمل (كان يفشل بلا values)");
    await click(admin, "panel:toggle:security.antiRaid");
    assert.equal(app.guildConfig.value(guild.id, "security.antiRaid"), undefined, "مفتاح خارج القائمة البيضاء لا يُكتب");
    app.guildConfig.set(guild.id, "tickets.transcriptChannelId", null);
    const r = await click(admin, "panel:ticketsettingsave:autoclose", { kind: "modal", fields: { idle: "5000", grace: "0", action: "delete" } });
    assert.match(H.textOf(r.replies), /قناة أرشيف/);
    await click(admin, "panel:ticketsettingsave:autoclose", { kind: "modal", fields: { idle: "5000", grace: "0", action: "lock" } });
    assert.equal(app.guildConfig.value(guild.id, "tickets.autoCloseIdleHours"), 720, "القيم تُقصّ لمدى الأمر القديم");
    assert.equal(app.guildConfig.value(guild.id, "tickets.autoCloseGraceHours"), 1);
  });

  await t.test("محرّر الإمبيد من اللوحة، والإغلاق", async () => {
    const record = app.embeds.create({ id: "embtest01", guildId: guild.id, name: "rules", createdBy: admin.id });
    const b = await click(admin, "panel:builder");
    assert.ok(customIds(last(b)).includes("panel:ebopen"));
    const open = await click(admin, "panel:ebopen", { values: [record.id], kind: "select" });
    assert.equal(last(open).flags, 64);
    assert.match(H.textOf(open.replies), /محرّر الإمبيد/);
    assert.match(H.textOf((await click(admin, "panel:ebvars")).replies), /المتغيرات/);
    assert.match(H.textOf((await click(admin, "panel:ebtpls")).replies), /القوالب/);
    assert.match(H.textOf((await click(alice, "panel:ebvars")).replies), /صلاحي/);
    const closed = await click(alice, "panel:close");
    assert.equal(container(last(closed)).rows.length, 0, "الإغلاق يزيل الأزرار");
  });
});
