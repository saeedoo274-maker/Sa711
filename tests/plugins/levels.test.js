const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("المستويات والمكافآت", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));

  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const channel = H.fakeChannel(guild, "400000000000000004", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const member = H.fakeMember(guild, "700000000000000007");
  const other = H.fakeMember(guild, "700000000000000008");
  const rewardRole = H.fakeRole("800000000000000008", { position: 5 });
  guild.roles.cache.set(rewardRole.id, rewardRole);

  const say = (who, content) => H.fakeMessage(who, channel, content);
  const slash = (who, sub, options = {}, group = null) => {
    app.commands.cooldowns.clear();
    const i = H.fakeSlash(who, channel, { command: "مستوى", sub, group, options });
    return app.commands.handleInteraction(i).then(() => i);
  };

  await t.test("النظام معطّل افتراضيًا ولا يمنح XP", async () => {
    assert.equal(app.levels.enabled(guild.id), false);
    assert.equal(await app.levels.handleMessage(say(member, "hello world")), null);
    const i = await slash(member, "rank");
    assert.match(H.textOf(i.replies), /levels/);
  });

  await t.test("الأدمن يفعّله من الإعدادات رغم تعطيله (featureExempt)", async () => {
    const i = await slash(admin, "settings", { enabled: true, cooldown: 60, "min-xp": 10, "max-xp": 10 }, "admin");
    assert.equal(app.levels.enabled(guild.id), true);
    assert.match(H.textOf(i.replies), /10-10/);
  });

  await t.test("XP الرسالة: منح، تبريد، تكرار، طول أدنى، بوت", async () => {
    const r1 = await app.levels.handleMessage(say(member, "hello there"));
    assert.equal(r1.granted, 10);
    assert.equal(await app.levels.handleMessage(say(member, "another message")), null, "التبريد يمنع");
    app.db.prepare("UPDATE level_members SET last_xp_at = 0 WHERE user_id = ?").run(member.id);
    assert.equal(await app.levels.handleMessage(say(member, "HELLO THERE")), null, "نفس النص مرفوض");
    assert.equal(await app.levels.handleMessage(say(member, "hi")), null, "أقصر من الحد");
    const bot = H.fakeMember(guild, "100000000000000055", { bot: true });
    assert.equal(await app.levels.handleMessage(say(bot, "i am a bot")), null);
    assert.equal(app.levels.repo.get(guild.id, member.id).xp, 10);
  });

  await t.test("التبريد ذرّي: رسالتان متزامنتان لا تمنحان مرتين", async () => {
    const a = H.fakeMember(guild, "700000000000000099");
    const [x, y] = await Promise.all([app.levels.handleMessage(say(a, "first msg")), app.levels.handleMessage(say(a, "second msg"))]);
    assert.equal([x, y].filter(Boolean).length, 1);
  });

  await t.test("القائمة السوداء والقنوات المتجاهلة والمضاعف", async () => {
    app.levels.repo.toggleBlacklist(guild.id, other.id, {});
    app.levels.invalidate(guild.id);
    assert.equal(await app.levels.handleMessage(say(other, "blocked text")), null);
    app.levels.repo.toggleBlacklist(guild.id, other.id, {});
    app.levels.invalidate(guild.id);

    app.guildConfig.set(guild.id, "levels.ignoredChannels", [channel.id]);
    assert.equal(await app.levels.handleMessage(say(other, "ignored place")), null);
    app.guildConfig.set(guild.id, "levels.ignoredChannels", []);

    app.levels.repo.setMultiplier(guild.id, "channel", channel.id, 2);
    app.levels.invalidate(guild.id);
    const r = await app.levels.handleMessage(say(other, "doubled xp"));
    assert.equal(r.granted, 20);
    app.levels.repo.setMultiplier(guild.id, "channel", channel.id, 1);
    app.levels.invalidate(guild.id);
  });

  await t.test("السقف اليومي يقص المنح", async () => {
    const u = H.fakeMember(guild, "700000000000000077");
    app.guildConfig.set(guild.id, "levels.dailyCap", 15);
    const r1 = await app.levels.handleMessage(say(u, "cap one"));
    app.db.prepare("UPDATE level_members SET last_xp_at = 0 WHERE user_id = ?").run(u.id);
    const r2 = await app.levels.handleMessage(say(u, "cap two"));
    app.db.prepare("UPDATE level_members SET last_xp_at = 0 WHERE user_id = ?").run(u.id);
    const r3 = await app.levels.handleMessage(say(u, "cap three"));
    assert.deepEqual([r1.granted, r2.granted, r3], [10, 5, null]);
    app.guildConfig.set(guild.id, "levels.dailyCap", 0);
  });

  await t.test("الترقية: مكافأة رتبة ومال + إعلان + سجل المكافآت", async () => {
    await slash(admin, "reward-add", { level: 2, role: rewardRole, money: 500 }, "admin");
    const before = app.economy.get(guild.id, member.id)?.bank || 0;
    // الوصول للمستوى 2 يحتاج 100 + 155 = 255 XP
    await slash(admin, "give", { user: member, amount: 300 }, "admin");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(app.levels.repo.get(guild.id, member.id).level, 2);
    assert.ok(member.roles.cache.has(rewardRole.id), "رتبة المكافأة");
    assert.equal(app.economy.get(guild.id, member.id).bank, before + 500, "مال المكافأة عبر الاقتصاد الموجود");
    assert.ok(app.rewardsRepo.history(guild.id, member.id).some((r) => r.source === "level"));
  });

  await t.test("النقل ذرّي ويرفض الرصيد غير الكافي", async () => {
    const res = app.levels.transfer(guild.id, member.id, other.id, 999999, admin.id);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "insufficient");
    const beforeFrom = app.levels.repo.get(guild.id, member.id).xp;
    const beforeTo = app.levels.repo.get(guild.id, other.id).xp;
    await slash(admin, "transfer", { from: member, to: other, amount: 50 }, "admin");
    assert.equal(app.levels.repo.get(guild.id, member.id).xp, beforeFrom - 50);
    assert.equal(app.levels.repo.get(guild.id, other.id).xp, beforeTo + 50);
  });

  await t.test("الترتيب ولوحة المتصدرين والتصفح بالأزرار", async () => {
    for (let i = 0; i < 12; i++) app.levels.addXp(guild.id, `71000000000000000${String(i).padStart(2, "0")}`, 5 + i, { log: false, silent: true });
    const i = await slash(member, "top", { period: "all" });
    const json = JSON.stringify(i.replies[0].components.map((c) => c.toJSON()));
    const next = JSON.parse(json)[0].components.find((c) => c.emoji?.name === "▶").custom_id;
    const click = H.fakeComponent(member, channel, next);
    await app.interactions.route(click);
    assert.match(H.textOf(click.replies), /2\/2/);

    const stranger = H.fakeComponent(other, channel, next);
    await app.interactions.route(stranger);
    assert.match(H.textOf(stranger.replies), /ليست لك/);
    assert.equal(app.levels.repo.rankOf(guild.id, member.id), 1);
  });

  await t.test("بطاقة الرتبة: صورة عند توفر مكتبة الرسم", async () => {
    const i = await slash(member, "rank");
    const payload = i.replies.at(-1);
    const hasCanvas = require("../../src/core/utils/canvas").available();
    assert.equal(!!payload.files?.length, hasCanvas);
    assert.match(H.textOf([payload]), /#1/);
  });

  await t.test("البريفكس: !rank و !top weekly", async () => {
    app.commands.cooldowns.clear();
    const m1 = say(member, "!rank");
    await app.commands.handleMessage(m1);
    assert.ok(m1.replies.length);
    app.commands.cooldowns.clear();
    const m2 = say(member, "!top weekly");
    await app.commands.handleMessage(m2);
    assert.match(H.textOf(m2.replies), /هذا الأسبوع/);
  });

  await t.test("غير الأدمن لا يصل للإدارة", async () => {
    const i = await slash(member, "give", { user: other, amount: 5 }, "admin");
    assert.match(H.textOf(i.replies), /الصلاحية/);
  });

  await t.test("تصفير السيرفر يحتاج تأكيدًا ويرفض الزر المنتهي", async () => {
    const i = await slash(admin, "reset", {}, "admin");
    const row = i.replies[0].components[0].toJSON();
    const yes = row.components[0].custom_id;
    const parts = yes.split(":");
    const old = [...parts];
    old[3] = (parseInt(parts[3], 36) - 3600).toString(36);
    const expired = H.fakeComponent(admin, channel, old.join(":"));
    await app.interactions.route(expired);
    assert.match(H.textOf(expired.replies), /انتهت صلاحية/);
    assert.ok(app.levels.count(guild.id) > 0);

    const click = H.fakeComponent(admin, channel, yes);
    await app.interactions.route(click);
    assert.equal(app.levels.count(guild.id), 0);
  });

  await t.test("XP الصوت: فقط مع عضو آخر وبلا إصمام", () => {
    const vc = { id: "450000000000000045", members: H.collection() };
    const a = H.fakeMember(guild, "720000000000000001");
    const b = H.fakeMember(guild, "720000000000000002");
    guild.voiceStates = { cache: new Map() };
    const state = (m, extra = {}) => ({ id: m.id, member: m, guild, channelId: vc.id, channel: vc, selfDeaf: false, serverDeaf: false, selfMute: false, serverMute: false, ...extra });
    vc.members.set(a.id, a);
    guild.voiceStates.cache.set(a.id, state(a));
    app.levels.onVoiceState({ guild, member: a, channelId: null }, state(a));
    const key = `${guild.id}:${a.id}`;
    app.levels.voiceSessions.get(key).lastAt -= 5 * 60_000;
    assert.equal(app.levels.voiceTick(), 0, "وحيد في الروم");

    vc.members.set(b.id, b);
    app.levels.voiceSessions.get(key).lastAt -= 5 * 60_000;
    assert.equal(app.levels.voiceTick(), 50, "5 دقائق × 10");
    assert.equal(app.levels.repo.get(guild.id, a.id).voice_seconds, 300);

    guild.voiceStates.cache.set(a.id, state(a, { selfDeaf: true }));
    app.levels.voiceSessions.get(key).lastAt -= 5 * 60_000;
    assert.equal(app.levels.voiceTick(), 0, "مُصمّ");
  });

  await t.test("المكافآت: مطالبة يومية لا تتكرر، وشارة لا تُمنح مرتين", async () => {
    app.guildConfig.set(guild.id, "rewards.dailyLogin", { enabled: true, money: 100, xp: 0 });
    const before = app.economy.get(guild.id, other.id)?.bank || 0;
    await app.rewards.onMessage(say(other, "صباح الخير"));
    await app.rewards.onMessage(say(other, "مرة ثانية"));
    app.rewards._dailySeen.clear();
    await app.rewards.onMessage(say(other, "بعد مسح الذاكرة"));
    assert.equal(app.economy.get(guild.id, other.id).bank, before + 100);

    app.rewardsRepo.upsertBadge(guild.id, { key: "early", name: "مبكر", emoji: "🌅" });
    const g1 = await app.rewards.grant(guild.id, other.id, { badge: "early" }, { source: "event" });
    const g2 = await app.rewards.grant(guild.id, other.id, { badge: "early" }, { source: "event" });
    assert.equal(g1.applied.badge, "early");
    assert.deepEqual(g2.skipped, ["badge:alreadyOwned"]);
    assert.equal(app.rewardsRepo.badgeCount(guild.id, other.id), 1);
  });

  await t.test("المكافآت الأسبوعية توزّع على المتصدرين مرة واحدة", async () => {
    app.guildConfig.set(guild.id, "rewards.weeklyActivity", { enabled: true, topN: 2, money: [1000, 500], xp: [0, 0] });
    app.levels.addXp(guild.id, "730000000000000001", 90, { silent: true });
    app.levels.addXp(guild.id, "730000000000000002", 40, { silent: true });
    // الأسبوع "المنتهي" هو أسبوع الأمس؛ لأغراض الاختبار نوزّع على لوحة هذا الأسبوع
    const first = await app.rewards.runWeekly();
    const second = await app.rewards.runWeekly();
    assert.equal(first.length, 2);
    assert.equal(first[0].userId, "730000000000000001");
    assert.equal(second.length, 0, "لا تكرار في نفس الفترة");
  });
});
