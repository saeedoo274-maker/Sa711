const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("نسخ السيرفر الاحتياطي والاستعادة غير الهدّامة", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app, name: "general" });
  const owner = H.fakeMember(guild, "300000000000000003", { admin: true });
  const admin = H.fakeMember(guild, "300000000000000004", { admin: true });
  guild.members.me.permissions.bitfield = 0x8n | 0x10n;
  const vip = H.fakeRole("894000000000000001", { name: "VIP", position: 5 });
  vip.permissions = { bitfield: 0x8n | 0x20n };
  vip.color = 0xff0000;
  guild.roles.cache.set(vip.id, vip);
  const news = H.fakeChannel(guild, "400000000000000020", { app, name: "news" });
  news.type = 0;
  news.permissionOverwrites = { cache: new Map([[vip.id, { id: vip.id, type: 0, allow: { bitfield: 1024n }, deny: { bitfield: 0n } }]]) };
  app.guildConfig.setMany(guild.id, { "welcome.channelId": news.id, "levels.xpChannels": [news.id] });

  let seq = 0;
  guild.roles.create = async (opts) => {
    const role = H.fakeRole(`895000000000000${String(++seq).padStart(3, "0")}`, { name: opts.name, position: 2 });
    role.permissions = { bitfield: opts.permissions.bitfield };
    guild.roles.cache.set(role.id, role);
    return role;
  };
  const createdChannels = [];
  guild.channels.create = async (opts) => {
    const ch = H.fakeChannel(guild, `496000000000000${String(++seq).padStart(3, "0")}`, { app, name: opts.name });
    ch.type = opts.type;
    ch.parentId = opts.parent || null;
    ch.createdWith = opts;
    createdChannels.push(ch);
    return ch;
  };

  const run = async (member, options) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(member, general, { command: "اعداد", sub: "backup", options });
    await app.commands.handleInteraction(i);
    return i;
  };

  let backupId;
  await t.test("إنشاء وعرض: اللقطة تحوي الرتب والقنوات والإعدادات", async () => {
    const i = await run(admin, { action: "create", name: "before" });
    assert.match(H.textOf(i.replies), /#\d+/);
    backupId = app.guildBackups.list(guild.id)[0].id;
    const data = app.guildBackups.get(guild.id, backupId).data;
    assert.ok(data.roles.some((r) => r.name === "VIP"));
    assert.ok(data.channels.some((c) => c.name === "news" && c.overwrites[0].role === "VIP"));
    assert.equal(data.config.welcome.channelId, news.id);
    assert.match(H.textOf((await run(admin, { action: "list" })).replies), /before/);
  });

  await t.test("الاستعادة والتصدير والحذف للمالك فقط", async () => {
    for (const action of ["restore", "export", "delete", "import"]) {
      assert.match(H.textOf((await run(admin, { action, id: backupId, confirm: true })).replies), /صلاحي/);
    }
  });

  await t.test("المقارنة تكشف المحذوف", async () => {
    guild.roles.cache.delete(vip.id);
    guild.channels.cache.delete(news.id);
    const text = H.textOf((await run(owner, { action: "compare", id: backupId })).replies);
    assert.match(text, /VIP/);
    assert.match(text, /news/);
  });

  await t.test("الاستعادة: تتطلب تأكيدًا، تُنشئ الناقص فقط، لا تمنح صلاحيات أعلى من البوت، وتعيد ربط المعرّفات", async () => {
    assert.match(H.textOf((await run(owner, { action: "restore", id: backupId, parts: "config,roles,channels" })).replies), /confirm/);
    app.guildConfig.set(guild.id, "guildBackup.restoreDelayMs", 0);
    const i = await run(owner, { action: "restore", id: backupId, parts: "config,roles,channels", confirm: true });
    assert.match(H.textOf(i.replies), /لن يُحذف/);
    await app.queue.pump("backup:restore");
    const job = app.queue.list({ queue: "backup:restore" })[0];
    const report = typeof job.result === "string" ? JSON.parse(job.result) : job.result;
    assert.equal(report.rolesCreated, 1);
    assert.equal(report.channelsCreated, 1);
    assert.equal(report.configRestored, true);
    const newVip = [...guild.roles.cache.values()].find((r) => r.name === "VIP");
    assert.equal(newVip.permissions.bitfield, 0x8n, "0x20 لا يملكها البوت فلا تُمنح");
    const newNews = createdChannels.find((c) => c.name === "news");
    assert.equal(newNews.createdWith.permissionOverwrites[0].id, newVip.id);
    assert.equal(app.guildConfig.value(guild.id, "welcome.channelId"), newNews.id, "إعادة ربط معرّف القناة في الإعدادات");
    assert.deepEqual(app.guildConfig.value(guild.id, "levels.xpChannels"), [newNews.id]);
    assert.ok(guild.channels.cache.has(general.id), "القنوات الموجودة لم تُمس");
  });

  await t.test("التصدير ثم الاستيراد مع التحقق من الصيغة، والتدوير، والجدولة", async () => {
    const exp = await run(owner, { action: "export", id: backupId });
    const data = JSON.parse(exp.replies.at(-1).files[0].attachment.toString("utf8"));
    assert.equal(data.format, "guild-backup");
    assert.equal(app.guildBackups.import(guild, data, owner.id).ok, true);
    assert.equal(app.guildBackups.import(guild, { format: "x" }, owner.id).reason, "badFormat");
    assert.equal(app.guildBackups.import(guild, { ...data, roles: [{ name: "", permissions: "abc" }] }, owner.id).reason, "badFormat");
    app.guildConfig.set(guild.id, "guildBackup.keep", 2);
    for (let n = 0; n < 3; n++) app.guildBackups.create(guild, { name: `n${n}` });
    assert.equal(app.guildBackups.list(guild.id).length, 2);
    await run(admin, { action: "schedule", frequency: "daily" });
    const job = app.scheduler.getByKey(`guild-backup:${guild.id}`);
    assert.ok(job);
    const before = app.guildBackups.list(guild.id)[0].id;
    await app.scheduler.tick(job.run_at + 1000);
    assert.ok(app.guildBackups.list(guild.id)[0].id > before, "النسخة المجدولة أُنشئت");
    await run(admin, { action: "schedule", frequency: "off" });
    assert.equal(app.guildConfig.value(guild.id, "guildBackup.schedule"), null);
  });
});
