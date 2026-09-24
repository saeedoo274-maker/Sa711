const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");
const GameEngine = require("../../src/plugins/games/GameEngine");

test("الألعاب والإنجازات ولوحات المتصدرين", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  app.guildConfig.set(guild.id, "economy.enabled", true);
  const channel = H.fakeChannel(guild, "400000000000000004", { app });
  const alice = H.fakeMember(guild, "700000000000000007");
  const bob = H.fakeMember(guild, "700000000000000008");
  const carol = H.fakeMember(guild, "700000000000000009");

  const wallet = (m) => app.economy.get(guild.id, m.id)?.wallet || 0;
  const setWallet = (m, w) => {
    app.economyService.account(guild.id, m.id);
    app.economy.setBalance({ guildId: guild.id, userId: m.id, wallet: w, bank: 0 });
  };
  const play = async (who, sub, options = {}) => {
    app.commands.cooldowns.clear();
    app.games._cooldowns.clear();
    const i = H.fakeSlash(who, channel, { command: "لعبة", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const click = async (who, customId) => {
    const i = H.fakeComponent(who, channel, customId);
    await app.interactions.route(i);
    return i;
  };
  const buttons = (reply) => (reply.components || []).flatMap((r) => r.toJSON().components).map((c) => c.custom_id);
  const origChance = GameEngine.chance;
  const origInt = GameEngine.int;
  t.after(() => { GameEngine.chance = origChance; GameEngine.int = origInt; });

  await t.test("العملة: الفوز ×2 والخسارة تخصم الرهان بالضبط", async () => {
    setWallet(alice, 1000);
    GameEngine.chance = () => true; // heads
    await play(alice, "coinflip", { bet: "100", side: "heads" });
    assert.equal(wallet(alice), 1100);
    await play(alice, "coinflip", { bet: "100", side: "tails" });
    assert.equal(wallet(alice), 1000);
    const stats = app.gamesRepo.stats(guild.id, alice.id).find((s) => s.game === "coinflip");
    assert.deepEqual([stats.played, stats.won, stats.lost, stats.profit], [2, 1, 1, 0]);
  });

  await t.test("حدود الرهان والرصيد", async () => {
    assert.match(H.textOf((await play(alice, "slots", { bet: "5" })).replies), /بين 10/);
    assert.match(H.textOf((await play(alice, "slots", { bet: "999999" })).replies), /بين 10/);
    setWallet(bob, 50);
    assert.match(H.textOf((await play(bob, "slots", { bet: "100" })).replies), /لا يكفي/);
    assert.equal(wallet(bob), 50);
  });

  await t.test("النرد والسلوتس وحجر ورقة مقص تحسب العائد بدقة", async () => {
    setWallet(alice, 1000);
    GameEngine.int = () => 5;
    await play(alice, "dice", { bet: "100", guess: "5" });
    assert.equal(wallet(alice), 1400, "رقم صحيح ×5");
    const slots = require("../../src/plugins/games/games/slots");
    const [cherry, , , , , diamond] = slots.SYMBOLS;
    assert.equal(slots.payoutFor([diamond, diamond, diamond], 10), 750);
    assert.equal(slots.payoutFor([cherry, cherry, diamond], 10), 15);
    assert.equal(slots.payoutFor([cherry, diamond, slots.SYMBOLS[2]], 10), 0);
    GameEngine.int = () => 0; // البوت يختار حجر
    await play(alice, "rps", { bet: "100", choice: "paper" });
    assert.equal(wallet(alice), 1500);
    await play(alice, "rps", { bet: "100", choice: "rock" });
    assert.equal(wallet(alice), 1500, "تعادل يعيد الرهان");
    GameEngine.int = origInt;
  });

  await t.test("بلاك جاك: الرهان محجوز أثناء اللعب، ولاعب آخر لا يلمس الأزرار، والوقوف يحسم", async () => {
    setWallet(alice, 1000);
    const i = await play(alice, "blackjack", { bet: "200" });
    const session = app.gamesRepo.staleSessions(Date.now(), { includeUnexpired: true }).find((s) => s.game === "blackjack");
    if (!session) return; // بلاك جاك طبيعي حُسم فورًا
    assert.equal(wallet(alice), 800, "محجوز");
    assert.match(H.textOf(await (await play(alice, "slots", { bet: "10" })).replies), /جارية/, "لا لعبتان معًا");
    const [, standId] = buttons(i.replies[0]);
    const denied = await click(bob, standId);
    assert.match(H.textOf(denied.replies), /ليست لك/);
    await click(alice, standId);
    const row = app.gamesRepo.get(session.id);
    assert.equal(row.status, "finished");
    assert.ok([800, 1000, 1200].includes(wallet(alice)));
  });

  await t.test("الألغام: المضاعف يطابق الصيغة، واللغم يخسر، والسحب يدفع", async () => {
    const mines = require("../../src/plugins/games/games/mines");
    assert.equal(mines.multiplier(0, 3), 0.97);
    assert.equal(mines.multiplier(1, 3), Math.floor((20 / 17) * 0.97 * 100) / 100);
    setWallet(alice, 1000);
    const i = await play(alice, "mines", { bet: "100", mines: 3 });
    const s = app.gamesRepo.staleSessions(Date.now(), { includeUnexpired: true }).find((x) => x.game === "mines");
    const safe = [...Array(20).keys()].find((k) => !s.state.mines.includes(k));
    await click(alice, `game:${s.id}:t:${safe}`);
    const cash = await click(alice, `game:${s.id}:cash`);
    assert.match(H.textOf(cash.replies), /ربحت/);
    assert.equal(wallet(alice), 900 + Math.floor(100 * mines.multiplier(1, 3)));
    assert.ok(buttons(i.replies[0]).length === 21);

    const again = await play(alice, "mines", { bet: "100", mines: 3 });
    const s2 = app.gamesRepo.staleSessions(Date.now(), { includeUnexpired: true }).find((x) => x.game === "mines");
    await click(alice, `game:${s2.id}:t:${s2.state.mines[0]}`);
    assert.equal(app.gamesRepo.get(s2.id).status, "finished");
    assert.ok(again);
  });

  await t.test("المبارزة: القبول يحجز رهان الخصم والفائز يأخذ الاثنين؛ الرفض يعيد الرهان", async () => {
    setWallet(alice, 1000);
    setWallet(bob, 1000);
    GameEngine.chance = () => true; // المضيف يفوز
    const i = await play(alice, "duel", { user: bob, bet: "300" });
    const [accept] = buttons(i.replies[0]);
    assert.match(H.textOf((await click(carol, accept)).replies), /ليست لك/);
    await click(bob, accept);
    assert.equal(wallet(alice), 1300);
    assert.equal(wallet(bob), 700);
    assert.equal(wallet(alice) + wallet(bob), 2000, "مجموع المال ثابت");

    const d2 = await play(alice, "duel", { user: bob, bet: "100" });
    assert.equal(wallet(alice), 1200);
    await click(bob, buttons(d2.replies[0])[1]);
    assert.equal(wallet(alice), 1300, "الرفض يعيد الرهان");
  });

  await t.test("السباق: لاعب وحيد يُسترد رهانه، ولاعبان = الفائز يأخذ المجموع", async () => {
    setWallet(alice, 1000);
    setWallet(bob, 1000);
    setWallet(carol, 1000);
    const solo = await play(alice, "race", { bet: "100" });
    const s = app.gamesRepo.staleSessions(Date.now(), { includeUnexpired: true }).find((x) => x.game === "race");
    app.db.prepare("UPDATE scheduled_jobs SET run_at = ? WHERE unique_key = ?").run(Date.now() - 1, `game:${s.id}`);
    await app.scheduler.tick();
    assert.equal(app.gamesRepo.get(s.id).status, "refunded");
    assert.equal(wallet(alice), 1000);
    assert.ok(solo);

    const lobby = await play(alice, "race", { bet: "100" });
    const [join, go] = buttons(lobby.replies[0]);
    await click(bob, join);
    await click(carol, join);
    assert.match(H.textOf((await click(bob, join)).replies), /انضممت/);
    assert.equal(wallet(bob), 900);
    GameEngine.int = (min, max) => (max === 2 ? 1 : min); // bob يفوز
    await click(alice, go);
    GameEngine.int = origInt;
    assert.equal(wallet(bob), 1200);
    assert.equal(wallet(alice) + wallet(bob) + wallet(carol), 3000);
  });

  await t.test("السطو: فرصة النجاح تزيد مع الفريق، والنجاح يدفع ×2.2 للجميع", async () => {
    const heist = require("../../src/plugins/games/games/heist");
    assert.equal(heist.successChance(2), 0.45);
    assert.equal(heist.successChance(10), 0.8);
    setWallet(alice, 1000);
    setWallet(bob, 1000);
    GameEngine.chance = () => true;
    const lobby = await play(alice, "heist", { bet: "100" });
    const [join, go] = buttons(lobby.replies[0]);
    await click(bob, join);
    await click(alice, go);
    assert.equal(wallet(alice), 1120);
    assert.equal(wallet(bob), 1120);
  });

  await t.test("الأسئلة: الوقت المنتهي خسارة، والإجابة الصحيحة ×2", async () => {
    setWallet(alice, 1000);
    const q = await play(alice, "trivia", { bet: "100" });
    const s = app.gamesRepo.staleSessions(Date.now(), { includeUnexpired: true }).find((x) => x.game === "trivia");
    await click(alice, `game:${s.id}:a:${s.state.correct}`);
    assert.equal(wallet(alice), 1100);
    assert.ok(q);
    await play(alice, "trivia", { bet: "100" });
    const s2 = app.gamesRepo.staleSessions(Date.now(), { includeUnexpired: true }).find((x) => x.game === "trivia");
    await app.games.expire(s2.id);
    assert.equal(wallet(alice), 1000);
  });

  await t.test("إعادة التشغيل: كل جلسة جارية يُسترد رهانها لكل لاعبيها", async () => {
    setWallet(alice, 1000);
    setWallet(bob, 1000);
    const lobby = await play(alice, "race", { bet: "250" });
    await click(bob, buttons(lobby.replies[0])[0]);
    assert.equal(wallet(alice) + wallet(bob), 1500);
    const refunded = app.games.refundAllStale();
    assert.ok(refunded >= 1);
    assert.equal(wallet(alice), 1000);
    assert.equal(wallet(bob), 1000);
  });

  await t.test("الإنجازات: المقاييس تُجمّع ثم تفتح الإنجاز مرة واحدة مع مكافأته", async () => {
    app.guildConfig.set(guild.id, "levels.levelUp.mode", "off");
    app.features.setForGuild(guild.id, "levels", true);
    const before = app.levels.repo.get(guild.id, carol.id)?.xp || 0;
    app.bus.emitSafe("activity:message", { guildId: guild.id, userId: carol.id });
    assert.equal(app.achievementsRepo.unlocks(guild.id, carol.id).size, 0, "قبل التفريغ");
    await app.achievements.flush();
    assert.ok(app.achievementsRepo.unlocks(guild.id, carol.id).has("first_words"));
    assert.equal(app.levels.repo.get(guild.id, carol.id).xp, before + 10, "مكافأة XP");
    app.bus.emitSafe("activity:message", { guildId: guild.id, userId: carol.id });
    const again = await app.achievements.flush();
    assert.equal(again.filter((a) => a.key === "first_words").length, 0);
    assert.ok(app.__sent.some((d) => d.to === carol.id && /فتح إنجاز/.test(d.payload.content)));
  });

  await t.test("الإنجازات: الألعاب تغذي المقاييس، والمخفي يظهر ??? والمخصص يعمل", async () => {
    const view = app.achievements.overview(guild.id, alice.id);
    assert.ok(view.find((a) => a.key === "gamer_10").value >= 1, "games_played من أحداث الألعاب");
    assert.equal(view.find((a) => a.key === "level_50").visible, false);
    app.commands.cooldowns.clear();
    const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
    const i = H.fakeSlash(admin, channel, { command: "ادارة", group: "achievement", sub: "create", options: { key: "duelist", name: "مبارز", metric: "games_won", target: 1, money: 777 } });
    await app.commands.handleInteraction(i);
    await app.achievements.evaluate(guild.id, alice.id);
    assert.ok(app.achievementsRepo.unlocks(guild.id, alice.id).has("duelist"));
    const m = H.fakeSlash(alice, channel, { command: "عضو", sub: "achievements", options: {} });
    app.commands.cooldowns.clear();
    await app.commands.handleInteraction(m);
    assert.match(H.textOf(m.replies), /مبارز/);
    assert.match(H.textOf(m.replies), /\?\?\?/);
  });

  await t.test("لوحات المتصدرين: الألعاب والثروة والإنجازات مع ترتيبك وتصفح", async () => {
    const lb = (type) => app.leaderboards.payload(guild, { type, ownerId: alice.id });
    assert.match(H.textOf([lb("games")]), /<@/);
    assert.match(H.textOf([lb("economy")]), /ترتيبك/);
    assert.match(H.textOf([lb("achievements")]), /<@700000000000000007>/);
    for (let k = 0; k < 12; k++) {
      const id = `74000000000000000${String(k).padStart(2, "0")}`;
      app.economyService.account(guild.id, id);
      app.economy.setBalance({ guildId: guild.id, userId: id, wallet: 10 + k, bank: 0 });
    }
    const page1 = lb("economy");
    const next = page1.components[0].toJSON().components.find((c) => c.emoji?.name === "▶").custom_id;
    const pager = await click(alice, next);
    assert.match(H.textOf(pager.replies), /#11|`#11`/);
  });
});
