const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("الاقتصاد الموسّع والمتجر والسوق", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  app.guildConfig.set(guild.id, "economy.enabled", true);
  const channel = H.fakeChannel(guild, "400000000000000004", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const alice = H.fakeMember(guild, "700000000000000007");
  const bob = H.fakeMember(guild, "700000000000000008");

  const eco = (who, sub, options = {}, group = null) => {
    app.commands.cooldowns.clear();
    const i = H.fakeSlash(who, channel, { command: "اقتصاد", sub, group, options });
    return app.commands.handleInteraction(i).then(() => i);
  };
  const wallet = (m) => app.economy.get(guild.id, m.id)?.wallet || 0;
  const bank = (m) => app.economy.get(guild.id, m.id)?.bank || 0;
  const total = (m) => wallet(m) + bank(m);
  const setMoney = (m, w, b = 0) => {
    app.economyService.account(guild.id, m.id);
    app.economy.setBalance({ guildId: guild.id, userId: m.id, wallet: w, bank: b });
  };

  await t.test("اليومي: مرة لكل يوم، والسلسلة تزيد المكافأة، والتزامن لا يضاعف", async () => {
    setMoney(alice, 0);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => Promise.resolve(app.economyPlus.claimPeriodic(alice, "daily"))));
    assert.equal(results.filter((r) => r.ok).length, 1, "مطالبة واحدة فقط رغم خمس محاولات");
    assert.equal(wallet(alice), 500);

    // محاكاة: أمس استلم ← السلسلة 2
    app.db.prepare("UPDATE econ_cooldowns SET period = ?, streak = 1 WHERE user_id = ? AND action = 'daily'")
      .run(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), alice.id);
    const again = app.economyPlus.claimPeriodic(alice, "daily");
    assert.equal(again.streak, 2);
    assert.equal(again.amount, 550);
    const i = await eco(alice, "daily");
    assert.match(H.textOf(i.replies), /استلمتها مسبقًا/);
  });

  await t.test("العمل: تبريد ذرّي، ووظيفة بمستوى مطلوب", async () => {
    const r1 = app.economyPlus.work(alice);
    const r2 = app.economyPlus.work(alice);
    assert.equal(r1.ok, true);
    assert.equal(r2.reason, "cooldown");
    app.economyPlusRepo.addJob(guild.id, { name: "طبيب", minPay: 1000, maxPay: 1000, requiredLevel: 5 });
    const job = app.economyPlusRepo.jobs(guild.id)[0];
    assert.equal(app.economyPlus.applyJob(alice, job.id).reason, "level");
    app.levels.addXp(guild.id, alice.id, 5000, { silent: true });
    assert.equal(app.economyPlus.applyJob(alice, job.id).ok, true);
    app.economyPlusRepo.releaseClaim(guild.id, alice.id, "work");
    assert.equal(app.economyPlus.work(alice).amount, 1000);
  });

  await t.test("السرقة: معطّلة افتراضيًا، والنجاح ينقل المال بلا خلقه، والحماية تمنع التكرار", async () => {
    assert.equal(app.economyPlus.rob(alice, bob).reason, "disabled");
    app.guildConfig.set(guild.id, "economy.rob.enabled", true);
    setMoney(alice, 1000);
    setMoney(bob, 10_000);
    const before = total(alice) + total(bob);
    const orig = Math.random;
    Math.random = () => 0.01; // نجاح
    const res = app.economyPlus.rob(alice, bob);
    Math.random = orig;
    assert.equal(res.success, true);
    assert.equal(total(alice) + total(bob), before, "المال ينتقل ولا يُخلق");
    app.economyPlusRepo.releaseClaim(guild.id, alice.id, "rob");
    assert.equal(app.economyPlus.rob(alice, bob).reason, "protected");
  });

  await t.test("المتجر: عنصر بمخزون وحد لكل عضو، خصم، بيع، واسترجاع", async () => {
    await eco(admin, "item-add", { key: "potion", name: "جرعة", type: "item", price: 200, sell: 50, stock: 3, limit: 2 }, "admin");
    setMoney(alice, 0, 1000);
    const buy = await eco(alice, "buy", { item: "potion", qty: 2 }, "shop");
    assert.match(H.textOf(buy.replies), /اشتريت/);
    assert.equal(bank(alice), 600);
    assert.equal(app.inventory.amountOf(guild.id, alice.id, "shop.potion"), 2);
    assert.equal(app.economyPlusRepo.itemByKey(guild.id, "potion").stock, 1);
    assert.equal((await app.shop.buy(alice, "potion", 1)).reason, "limitReached");

    await eco(admin, "item-edit", { item: "potion", discount: 50 }, "admin");
    const r = await app.shop.buy(bob, "potion", 1);
    assert.equal(r.total, 100, "خصم 50%");
    assert.equal((await app.shop.buy(bob, "potion", 1)).reason, "outOfStock");

    const sell = app.shop.sell(alice, "potion", 1);
    assert.equal(sell.total, 50);
    assert.equal(app.economyPlusRepo.itemByKey(guild.id, "potion").stock, 1, "البيع يعيد المخزون");

    const purchase = app.economyPlusRepo.purchases(guild.id, alice.id)[0];
    const refund = await eco(admin, "refund", { id: purchase.id }, "admin");
    assert.match(H.textOf(refund.replies), /استرجاع/);
    assert.equal(app.inventory.amountOf(guild.id, alice.id, "shop.potion"), 0, "العنصر المتبقي سُحب");
    assert.equal((await app.shop.refund(guild, purchase.id, admin.id)).reason, "alreadyRefunded");
  });

  await t.test("المتجر: الرصيد غير الكافي لا يغيّر شيئًا (ذرّية كاملة)", async () => {
    await eco(admin, "item-add", { key: "gem", name: "جوهرة", type: "item", price: 99999, stock: 5 }, "admin");
    setMoney(bob, 10);
    const res = await app.shop.buy(bob, "gem", 1);
    assert.equal(res.reason, "insufficient");
    assert.equal(app.economyPlusRepo.itemByKey(guild.id, "gem").stock, 5, "المخزون لم يُنقص");
    assert.equal(app.inventory.amountOf(guild.id, bob.id, "shop.gem"), 0);
    assert.equal(app.economyPlusRepo.purchases(guild.id, bob.id).filter((p) => p.item_key === "gem").length, 0, "لا سجل شراء يتيم");
  });

  await t.test("المتجر: رتبة (تُمنح وتُسحب بالاسترجاع)، شارة، وعرض محدود منتهٍ", async () => {
    const role = H.fakeRole("880000000000000088", { position: 2 });
    guild.roles.cache.set(role.id, role);
    guild.members.me.permissions = { has: () => true, any: () => true };
    await eco(admin, "item-add", { key: "vip", name: "VIP", type: "role", price: 100, role }, "admin");
    setMoney(alice, 0, 500);
    const r = await app.shop.buy(alice, "vip", 1);
    assert.equal(r.ok, true);
    assert.ok(alice.roles.cache.has(role.id));
    assert.equal((await app.shop.buy(alice, "vip", 1)).reason, "alreadyOwned");
    await app.shop.refund(guild, r.purchaseId, admin.id);
    assert.ok(!alice.roles.cache.has(role.id));

    await eco(admin, "item-add", { key: "early", name: "مبكر", type: "badge", price: 10, badge: "early" }, "admin");
    assert.equal((await app.shop.buy(alice, "early", 1)).ok, true);
    assert.ok(app.rewardsRepo.memberBadges(guild.id, alice.id).some((b) => b.badge === "early"));

    await eco(admin, "item-add", { key: "flash", name: "عرض", type: "item", price: 10 }, "admin");
    app.economyPlusRepo.updateItem(guild.id, "flash", { offerEndsAt: Date.now() - 1000 });
    assert.equal((await app.shop.buy(alice, "flash", 1)).reason, "unavailable");
  });

  await t.test("التجميلي: التجهيز يغيّر خلفية بطاقة الرتبة ما دام العضو يملكه", async () => {
    await eco(admin, "item-add", { key: "bg1", name: "خلفية", type: "cosmetic", price: 10, value: "https://example.com/bg.png" }, "admin");
    await app.shop.buy(alice, "bg1", 1);
    assert.equal(app.shop.equip(alice, "bg1").ok, true);
    assert.equal(app.shop.cosmetic(guild.id, alice.id, "rankBackground"), "https://example.com/bg.png");
    app.inventory.remove(guild.id, alice.id, "shop.bg1", 1);
    assert.equal(app.shop.cosmetic(guild.id, alice.id, "rankBackground"), null);
  });

  await t.test("السوق: حجز العناصر، الشراء مع الضريبة، والإلغاء يعيدها", async () => {
    app.inventory.add(guild.id, alice.id, "shop.gem", 3);
    const listed = app.market.list(alice, "shop.gem", 2, 1000);
    assert.equal(listed.ok, true);
    assert.equal(app.inventory.amountOf(guild.id, alice.id, "shop.gem"), 1, "محجوزة");
    setMoney(bob, 0, 2000);
    const before = bank(alice);
    const bought = app.market.buy(bob, listed.id);
    assert.equal(bought.ok, true);
    assert.equal(bank(alice), before + 950, "ضريبة 5%");
    assert.equal(app.inventory.amountOf(guild.id, bob.id, "shop.gem"), 2);
    assert.equal(app.market.buy(bob, listed.id).reason, "notFound", "لا يُشترى مرتين");

    const l2 = app.market.list(alice, "shop.gem", 1, 500);
    app.economyPlusRepo.cancelListing({ guildId: guild.id, userId: alice.id, listingId: l2.id });
    assert.equal(app.inventory.amountOf(guild.id, alice.id, "shop.gem"), 1);
    assert.equal(app.market.list(alice, "shop.gem", 5, 10).reason, "notEnoughItems");
  });

  await t.test("المزاد: حجز المزايدة، إرجاع المتجاوَز، وإنهاء عبر المجدول", async () => {
    app.inventory.add(guild.id, alice.id, "shop.gold", 1);
    const started = await app.market.startAuction(alice, channel, { itemKey: "shop.gold", quantity: 1, minBid: 100, durationMs: 600_000 });
    const id = started.auction.id;
    setMoney(bob, 0, 1000);
    const carol = H.fakeMember(guild, "700000000000000009");
    setMoney(carol, 0, 1000);
    assert.equal(app.market.bid(bob, id, 50).reason, "tooLow");
    assert.equal(app.market.bid(bob, id, 200).ok, true);
    assert.equal(bank(bob), 800, "محجوز");
    assert.equal(app.market.bid(carol, id, 205).reason, "tooLow", "زيادة 5% على الأقل");
    assert.equal(app.market.bid(carol, id, 300).ok, true);
    assert.equal(bank(bob), 1000, "أُعيدت مزايدة المتجاوَز");
    assert.equal(app.market.bid(alice, id, 999).reason, "ownAuction");

    const sellerBefore = bank(alice);
    app.db.prepare("UPDATE scheduled_jobs SET run_at = ? WHERE unique_key = ?").run(Date.now() - 1, `auction:${id}`);
    await app.scheduler.tick();
    assert.equal(app.inventory.amountOf(guild.id, carol.id, "shop.gold"), 1);
    assert.equal(bank(alice), sellerBefore + 285, "رسوم 5%");
    assert.equal(app.economyPlusRepo.auction(id).status, "ended");
  });

  await t.test("التداول: القبول يبدّل الطرفين ذرّيًا، ونقص أحدهما يلغي الكل", async () => {
    app.inventory.add(guild.id, alice.id, "shop.sword", 1);
    setMoney(bob, 0, 500);
    const res = app.market.proposeTrade(alice, bob, { offerItem: "shop.sword", offerQty: 1, wantMoney: 400 });
    assert.equal(res.ok, true);
    const accept = H.fakeComponent(bob, channel, `eco:trade:${res.trade.id}:accept`);
    await app.interactions.route(accept);
    assert.equal(app.inventory.amountOf(guild.id, bob.id, "shop.sword"), 1);
    assert.equal(bank(bob), 100);

    const t2 = app.market.proposeTrade(bob, alice, { offerItem: "shop.sword", offerQty: 1, wantMoney: 10_000_000 });
    const beforeAlice = total(alice);
    const click = H.fakeComponent(alice, channel, `eco:trade:${t2.trade.id}:accept`);
    await app.interactions.route(click);
    assert.match(H.textOf(click.replies), /غير كافٍ/);
    assert.equal(app.inventory.amountOf(guild.id, bob.id, "shop.sword"), 1, "لم يُسلَّم العنصر");
    assert.equal(total(alice), beforeAlice);
    const stranger = H.fakeComponent(admin, channel, `eco:trade:${t2.trade.id}:accept`);
    await app.interactions.route(stranger);
    assert.match(H.textOf(stranger.replies), /ليس لك/);
  });

  await t.test("الاستثمار: سحب مبكر بغرامة، وعائد كامل عند النضج", async () => {
    setMoney(alice, 0, 10_000);
    const inv = app.economyPlus.invest(alice, "short", 1000);
    assert.equal(bank(alice), 9000);
    const early = app.economyPlus.closeInvestment(alice, inv.id);
    assert.equal(early.payout, 900);
    const inv2 = app.economyPlus.invest(alice, "mid", 1000);
    app.db.prepare("UPDATE econ_investments SET matures_at = ? WHERE id = ?").run(Date.now() - 1, inv2.id);
    const matured = app.economyPlus.closeInvestment(alice, inv2.id);
    assert.equal(matured.payout, 1180);
    assert.equal(app.economyPlus.closeInvestment(alice, inv2.id).reason, "closed");
  });

  await t.test("القروض: طلب ← موافقة أدمن (صرف + فائدة) ← سداد ← تحصيل المتأخر", async () => {
    app.guildConfig.set(guild.id, "economy.loans.enabled", true);
    setMoney(bob, 0, 0);
    const req = await eco(bob, "request", { amount: "1000", reason: "مشروع" }, "loan");
    assert.match(H.textOf(req.replies), /#1/);
    const loanId = app.economy.pendingLoans(guild.id)[0].id;
    const deny = H.fakeComponent(bob, channel, `eco:loan:${loanId}:approve`);
    await app.interactions.route(deny);
    assert.match(H.textOf(deny.replies), /الصلاحية/);
    const approve = H.fakeComponent(admin, channel, `eco:loan:${loanId}:approve`);
    await app.interactions.route(approve);
    assert.equal(bank(bob), 1000);
    assert.equal(app.economy.getLoan(loanId).remaining, 1100, "فائدة 10%");
    const again = H.fakeComponent(admin, channel, `eco:loan:${loanId}:approve`);
    await app.interactions.route(again);
    assert.equal(bank(bob), 1000, "لا صرف مزدوج");

    app.economyPlus.repayLoan(bob, null, 600);
    assert.equal(app.economy.getLoan(loanId).remaining, 500);
    app.db.prepare("UPDATE loans SET due_at = ? WHERE id = ?").run(Date.now() - 1, loanId);
    await app.economyPlus.collectOverdue();
    // المتاح 400 فقط من مستحق 500: يُحصَّل المتاح دون أن ينزل الرصيد تحت الصفر
    assert.equal(app.economy.getLoan(loanId).remaining, 100);
    assert.equal(app.economy.getLoan(loanId).status, "active");
    assert.equal(bank(bob), 0);
    setMoney(bob, 0, 100);
    await app.economyPlus.collectOverdue();
    assert.equal(app.economy.getLoan(loanId).status, "paid");
  });

  await t.test("الحساب المجمّد لا يشتري ولا يستلم اليومي", async () => {
    setMoney(bob, 0, 5000);
    app.economy.freeze({ guildId: guild.id, userId: bob.id, reason: "تحقيق", actorId: admin.id });
    assert.equal((await app.shop.buy(bob, "vip", 1)).reason !== undefined, true);
    app.db.prepare("DELETE FROM econ_cooldowns WHERE user_id = ?").run(bob.id);
    assert.equal(app.economyPlus.claimPeriodic(bob, "weekly").reason, "frozen");
    app.economy.unfreeze({ guildId: guild.id, userId: bob.id });
  });

  await t.test("الإحصاءات والسجل عبر الأوامر، والبريفكس !daily", async () => {
    assert.match(H.textOf((await eco(admin, "stats")).replies), /المال المتداول/);
    assert.match(H.textOf((await eco(alice, "history")).replies), /#/);
    app.commands.cooldowns.clear();
    const msg = H.fakeMessage(bob, channel, "!weekly");
    await app.commands.handleMessage(msg);
    assert.match(H.textOf(msg.replies), /الأسبوعية/);
  });
});
