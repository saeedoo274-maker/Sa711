/**
 * مستودع توسعة الاقتصاد.
 *
 * يعمل فوق المستودعات الموجودة ولا يستبدلها:
 *  - المال: EconomyRepository (accounts + transactions) عبر spend/adjustBank/adjustWallet
 *  - المخزون: RpRepository (rp_inventory + rp_inventory_log) عبر give/take
 *
 * كل عملية مركّبة (شراء، بيع، مزايدة، تداول...) داخل معاملة واحدة:
 * أي خطوة فاشلة ترمي `Abort` فتُلغى كل الخطوات السابقة تلقائيًا.
 */
class Abort extends Error {
  constructor(reason, extra = {}) {
    super(reason);
    this.reason = reason;
    this.extra = extra;
  }
}

class EconomyPlusRepository {
  constructor(db, economy, rp) {
    this.db = db;
    this.economy = economy;
    this.rp = rp;
  }

  /** ينفّذ دالة داخل معاملة ويحوّل Abort إلى { ok: false, reason }. */
  atomic(fn) {
    try {
      return this.db.transaction(fn)();
    } catch (error) {
      if (error instanceof Abort) return { ok: false, reason: error.reason, ...error.extra };
      throw error;
    }
  }

  static abort(reason, extra) {
    throw new Abort(reason, extra);
  }

  _spend(args) {
    const res = this.economy.spend(args);
    if (!res.ok) EconomyPlusRepository.abort(res.reason, { account: res.account });
    return res;
  }

  _take(guildId, userId, itemKey, qty, reason) {
    const res = this.rp.take({ guildId, userId, itemKey, amount: qty, reason });
    if (!res.ok) EconomyPlusRepository.abort("notEnoughItems");
    return res;
  }

  // ---------------- التبريد والسلاسل ----------------

  /**
   * مطالبة ذرّية:
   *  - بفترة (يومي/أسبوعي/شهري): مرة لكل فترة، مع سلسلة تزيد إن كانت الفترة السابقة مطالَبة.
   *  - بتبريد (عمل/سرقة): مرة كل cooldownMs.
   */
  claim(guildId, userId, action, { cooldownMs = 0, period = null, previousPeriod = null, now = Date.now() } = {}) {
    return this.atomic(() => {
      const row = this.db.prepare("SELECT * FROM econ_cooldowns WHERE guild_id = ? AND user_id = ? AND action = ?").get(guildId, userId, action);
      let streak = 1;
      if (period) {
        if (row?.period === period) EconomyPlusRepository.abort("alreadyClaimed");
        streak = row && row.period === previousPeriod ? row.streak + 1 : 1;
      } else if (row && now - row.last_at < cooldownMs) {
        EconomyPlusRepository.abort("cooldown", { remainingMs: cooldownMs - (now - row.last_at) });
      }
      this.db
        .prepare(
          `INSERT INTO econ_cooldowns (guild_id, user_id, action, last_at, period, streak) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(guild_id, user_id, action) DO UPDATE SET last_at = excluded.last_at, period = excluded.period, streak = excluded.streak`
        )
        .run(guildId, userId, action, now, period, streak);
      return { ok: true, streak };
    });
  }

  /** تراجع عن مطالبة (عند فشل الدفع بعدها مثلًا). */
  releaseClaim(guildId, userId, action) {
    this.db.prepare("DELETE FROM econ_cooldowns WHERE guild_id = ? AND user_id = ? AND action = ?").run(guildId, userId, action);
  }

  cooldownOf(guildId, userId, action) {
    return this.db.prepare("SELECT * FROM econ_cooldowns WHERE guild_id = ? AND user_id = ? AND action = ?").get(guildId, userId, action) || null;
  }

  // ---------------- الوظائف ----------------

  addJob(guildId, { name, emoji = null, minPay, maxPay, requiredLevel = 0 }) {
    this.db
      .prepare(
        `INSERT INTO econ_jobs (guild_id, name, emoji, min_pay, max_pay, required_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, name) DO UPDATE SET emoji = excluded.emoji, min_pay = excluded.min_pay, max_pay = excluded.max_pay, required_level = excluded.required_level`
      )
      .run(guildId, name, emoji, minPay, maxPay, requiredLevel, Date.now());
    return this.db.prepare("SELECT * FROM econ_jobs WHERE guild_id = ? AND name = ?").get(guildId, name);
  }

  removeJob(guildId, id) {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM econ_member_jobs WHERE guild_id = ? AND job_id = ?").run(guildId, id);
      return this.db.prepare("DELETE FROM econ_jobs WHERE guild_id = ? AND id = ?").run(guildId, id).changes > 0;
    });
    return tx();
  }

  jobs(guildId) {
    return this.db.prepare("SELECT * FROM econ_jobs WHERE guild_id = ? ORDER BY required_level ASC, min_pay ASC").all(guildId);
  }

  job(guildId, id) {
    return this.db.prepare("SELECT * FROM econ_jobs WHERE guild_id = ? AND id = ?").get(guildId, id) || null;
  }

  setMemberJob(guildId, userId, jobId) {
    this.db
      .prepare("INSERT INTO econ_member_jobs (guild_id, user_id, job_id, since) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET job_id = excluded.job_id, since = excluded.since")
      .run(guildId, userId, jobId, Date.now());
  }

  memberJob(guildId, userId) {
    return this.db
      .prepare("SELECT j.* FROM econ_member_jobs m JOIN econ_jobs j ON j.id = m.job_id WHERE m.guild_id = ? AND m.user_id = ?")
      .get(guildId, userId) || null;
  }

  // ---------------- المتجر ----------------

  _item(row) {
    if (!row) return null;
    let data;
    try {
      data = row.data ? JSON.parse(row.data) : null;
    } catch {
      data = null;
    }
    return { ...row, data };
  }

  upsertItem(guildId, item) {
    this.db
      .prepare(
        `INSERT INTO shop_items (guild_id, key, name, description, emoji, type, price, sell_price, stock, role_id, badge_key, data, discount_percent, offer_ends_at, per_user_limit, required_level, enabled, created_at)
         VALUES (@guildId, @key, @name, @description, @emoji, @type, @price, @sellPrice, @stock, @roleId, @badgeKey, @data, @discount, @offerEndsAt, @perUserLimit, @requiredLevel, 1, @now)
         ON CONFLICT(guild_id, key) DO UPDATE SET name = excluded.name, description = excluded.description, emoji = excluded.emoji, type = excluded.type,
           price = excluded.price, sell_price = excluded.sell_price, stock = excluded.stock, role_id = excluded.role_id, badge_key = excluded.badge_key,
           data = excluded.data, per_user_limit = excluded.per_user_limit, required_level = excluded.required_level, enabled = 1`
      )
      .run({
        guildId, key: item.key, name: item.name, description: item.description ?? null, emoji: item.emoji ?? null, type: item.type || "item",
        price: item.price, sellPrice: item.sellPrice ?? null, stock: item.stock ?? null, roleId: item.roleId ?? null, badgeKey: item.badgeKey ?? null,
        data: item.data ? JSON.stringify(item.data) : null, discount: item.discount ?? 0, offerEndsAt: item.offerEndsAt ?? null,
        perUserLimit: item.perUserLimit ?? null, requiredLevel: item.requiredLevel ?? 0, now: Date.now()
      });
    return this.itemByKey(guildId, item.key);
  }

  updateItem(guildId, key, fields) {
    const allowed = { price: "price", sellPrice: "sell_price", stock: "stock", discount: "discount_percent", offerEndsAt: "offer_ends_at", enabled: "enabled", perUserLimit: "per_user_limit", requiredLevel: "required_level", description: "description", name: "name" };
    const sets = [];
    const params = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!allowed[k] || v === undefined) continue;
      sets.push(`${allowed[k]} = ?`);
      params.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
    }
    if (sets.length) this.db.prepare(`UPDATE shop_items SET ${sets.join(", ")} WHERE guild_id = ? AND key = ?`).run(...params, guildId, key);
    return this.itemByKey(guildId, key);
  }

  itemByKey(guildId, key) {
    return this._item(this.db.prepare("SELECT * FROM shop_items WHERE guild_id = ? AND key = ?").get(guildId, key));
  }

  items(guildId, { includeDisabled = false } = {}) {
    return this.db
      .prepare(`SELECT * FROM shop_items WHERE guild_id = ? ${includeDisabled ? "" : "AND enabled = 1"} ORDER BY type, price ASC`)
      .all(guildId)
      .map((r) => this._item(r));
  }

  purchasedCount(guildId, userId, itemId) {
    return this.db
      .prepare("SELECT COALESCE(SUM(quantity), 0) AS c FROM shop_purchases WHERE guild_id = ? AND user_id = ? AND item_id = ? AND refunded = 0")
      .get(guildId, userId, itemId).c;
  }

  /**
   * الشراء: المخزون + الحد لكل عضو + الدفع + إضافة العنصر + سجل الشراء — ذرّيًا.
   * منح الرتبة (API ديسكورد) يتم بعد المعاملة؛ فشله يؤدي لاسترجاع تلقائي عبر refund.
   */
  purchase({ guildId, userId, item, quantity, unitPrice }) {
    return this.atomic(() => {
      const fresh = this.itemByKey(guildId, item.key);
      if (!fresh?.enabled) EconomyPlusRepository.abort("unavailable");
      if (fresh.per_user_limit && this.purchasedCount(guildId, userId, fresh.id) + quantity > fresh.per_user_limit) {
        EconomyPlusRepository.abort("limitReached", { limit: fresh.per_user_limit });
      }
      if (fresh.stock !== null) {
        const res = this.db.prepare("UPDATE shop_items SET stock = stock - ? WHERE id = ? AND stock >= ?").run(quantity, fresh.id, quantity);
        if (res.changes !== 1) EconomyPlusRepository.abort("outOfStock", { stock: fresh.stock });
      }
      const total = unitPrice * quantity;
      const info = this.db
        .prepare("INSERT INTO shop_purchases (guild_id, user_id, item_id, item_key, quantity, unit_price, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(guildId, userId, fresh.id, fresh.key, quantity, unitPrice, total, Date.now());
      if (total > 0) this._spend({ guildId, userId, amount: total, type: "shop_buy", reason: `${quantity}× ${fresh.name}`, refType: "shop", refId: info.lastInsertRowid });
      if (fresh.type === "item" || fresh.type === "cosmetic") {
        this.rp.give({ guildId, userId, itemKey: `shop.${fresh.key}`, amount: quantity, reason: `شراء #${info.lastInsertRowid}` });
      }
      return { ok: true, purchaseId: info.lastInsertRowid, total, item: fresh, account: this.economy.get(guildId, userId) };
    });
  }

  sell({ guildId, userId, item, quantity }) {
    return this.atomic(() => {
      if (!item.sell_price) EconomyPlusRepository.abort("notSellable");
      this._take(guildId, userId, `shop.${item.key}`, quantity, "بيع للمتجر");
      const total = item.sell_price * quantity;
      this.economy.adjustBank({ guildId, userId, delta: total, type: "shop_sell", reason: `${quantity}× ${item.name}`, refType: "shop", refId: item.id });
      if (item.stock !== null) this.db.prepare("UPDATE shop_items SET stock = stock + ? WHERE id = ?").run(quantity, item.id);
      return { ok: true, total };
    });
  }

  /** استرجاع شراء: المال يعود، العنصر يُسحب (إن بقي)، المخزون يرجع — مرة واحدة فقط. */
  refund(guildId, purchaseId, actorId) {
    return this.atomic(() => {
      const p = this.db.prepare("SELECT * FROM shop_purchases WHERE id = ? AND guild_id = ?").get(purchaseId, guildId);
      if (!p) EconomyPlusRepository.abort("notFound");
      const res = this.db.prepare("UPDATE shop_purchases SET refunded = 1, refunded_by = ? WHERE id = ? AND refunded = 0").run(actorId, purchaseId);
      if (res.changes !== 1) EconomyPlusRepository.abort("alreadyRefunded");
      const item = this._item(this.db.prepare("SELECT * FROM shop_items WHERE id = ?").get(p.item_id));
      let itemsRemoved = 0;
      if (item && (item.type === "item" || item.type === "cosmetic")) {
        const owned = this.rp.amountOf(guildId, p.user_id, `shop.${item.key}`);
        itemsRemoved = Math.min(owned, p.quantity);
        if (itemsRemoved) this.rp.take({ guildId, userId: p.user_id, itemKey: `shop.${item.key}`, amount: itemsRemoved, reason: `استرجاع #${p.id}`, actorId });
      }
      if (item?.stock !== null && item) this.db.prepare("UPDATE shop_items SET stock = stock + ? WHERE id = ?").run(p.quantity, item.id);
      if (p.total > 0) this.economy.adjustBank({ guildId, userId: p.user_id, delta: p.total, type: "shop_refund", reason: `استرجاع #${p.id}`, refType: "shop", refId: p.id, actorId });
      return { ok: true, purchase: p, item, itemsRemoved };
    });
  }

  purchases(guildId, userId, limit = 15) {
    return this.db.prepare("SELECT * FROM shop_purchases WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?").all(guildId, userId, limit);
  }

  purchaseById(guildId, id) {
    return this.db.prepare("SELECT * FROM shop_purchases WHERE guild_id = ? AND id = ?").get(guildId, id) || null;
  }

  shopStats(guildId) {
    return this.db
      .prepare("SELECT COUNT(*) AS purchases, COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(refunded), 0) AS refunds FROM shop_purchases WHERE guild_id = ?")
      .get(guildId);
  }

  // ---------------- التجميلات ----------------

  equip(guildId, userId, slot, itemKey) {
    this.db
      .prepare("INSERT INTO member_cosmetics (guild_id, user_id, slot, item_key) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id, slot) DO UPDATE SET item_key = excluded.item_key")
      .run(guildId, userId, slot, itemKey);
  }

  unequip(guildId, userId, slot) {
    return this.db.prepare("DELETE FROM member_cosmetics WHERE guild_id = ? AND user_id = ? AND slot = ?").run(guildId, userId, slot).changes > 0;
  }

  equipped(guildId, userId) {
    return this.db.prepare("SELECT * FROM member_cosmetics WHERE guild_id = ? AND user_id = ?").all(guildId, userId);
  }

  // ---------------- الاستثمار ----------------

  invest({ guildId, userId, plan, amount, rate, durationMs, maxActive }) {
    return this.atomic(() => {
      const active = this.db.prepare("SELECT COUNT(*) AS c FROM econ_investments WHERE guild_id = ? AND user_id = ? AND status = 'active'").get(guildId, userId).c;
      if (active >= maxActive) EconomyPlusRepository.abort("maxActive", { max: maxActive });
      const now = Date.now();
      const info = this.db
        .prepare("INSERT INTO econ_investments (guild_id, user_id, plan, amount, rate, started_at, matures_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(guildId, userId, plan, amount, rate, now, now + durationMs);
      this._spend({ guildId, userId, amount, type: "invest", reason: `خطة ${plan}`, refType: "investment", refId: info.lastInsertRowid });
      return { ok: true, id: info.lastInsertRowid, maturesAt: now + durationMs };
    });
  }

  /** سحب الاستثمار: كامل العائد عند النضج، أو الأصل ناقص الغرامة قبله. مرة واحدة فقط. */
  closeInvestment({ guildId, userId, id, penaltyPercent }) {
    return this.atomic(() => {
      const inv = this.db.prepare("SELECT * FROM econ_investments WHERE id = ? AND guild_id = ? AND user_id = ?").get(id, guildId, userId);
      if (!inv) EconomyPlusRepository.abort("notFound");
      const matured = Date.now() >= inv.matures_at;
      const payout = matured ? Math.floor(inv.amount * (1 + inv.rate / 100)) : Math.floor(inv.amount * (1 - penaltyPercent / 100));
      const status = matured ? "claimed" : "withdrawn";
      const res = this.db
        .prepare("UPDATE econ_investments SET status = ?, payout = ?, closed_at = ? WHERE id = ? AND status = 'active'")
        .run(status, payout, Date.now(), id);
      if (res.changes !== 1) EconomyPlusRepository.abort("closed");
      this.economy.adjustBank({ guildId, userId, delta: payout, type: matured ? "invest_return" : "invest_withdraw", reason: `استثمار #${id}`, refType: "investment", refId: id });
      return { ok: true, matured, payout, investment: inv };
    });
  }

  investments(guildId, userId, { activeOnly = false } = {}) {
    return this.db
      .prepare(`SELECT * FROM econ_investments WHERE guild_id = ? AND user_id = ? ${activeOnly ? "AND status = 'active'" : ""} ORDER BY id DESC LIMIT 20`)
      .all(guildId, userId);
  }

  // ---------------- السوق ----------------

  listOnMarket({ guildId, sellerId, itemKey, quantity, price, maxListings }) {
    return this.atomic(() => {
      const active = this.db.prepare("SELECT COUNT(*) AS c FROM econ_market WHERE guild_id = ? AND seller_id = ? AND status = 'active'").get(guildId, sellerId).c;
      if (active >= maxListings) EconomyPlusRepository.abort("maxListings", { max: maxListings });
      // العناصر تُحجز من حقيبة البائع حتى البيع أو الإلغاء
      this._take(guildId, sellerId, itemKey, quantity, "حجز في السوق");
      const info = this.db
        .prepare("INSERT INTO econ_market (guild_id, seller_id, item_key, quantity, price, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(guildId, sellerId, itemKey, quantity, price, Date.now());
      return { ok: true, id: info.lastInsertRowid };
    });
  }

  buyFromMarket({ guildId, buyerId, listingId, taxPercent }) {
    return this.atomic(() => {
      const l = this.db.prepare("SELECT * FROM econ_market WHERE id = ? AND guild_id = ?").get(listingId, guildId);
      if (!l || l.status !== "active") EconomyPlusRepository.abort("notFound");
      if (l.seller_id === buyerId) EconomyPlusRepository.abort("ownListing");
      const res = this.db.prepare("UPDATE econ_market SET status = 'sold', buyer_id = ?, closed_at = ? WHERE id = ? AND status = 'active'").run(buyerId, Date.now(), listingId);
      if (res.changes !== 1) EconomyPlusRepository.abort("notFound");
      this._spend({ guildId, userId: buyerId, amount: l.price, type: "market_buy", reason: `${l.quantity}× ${l.item_key}`, refType: "market", refId: l.id, counterpartyId: l.seller_id });
      const tax = Math.floor((l.price * taxPercent) / 100);
      this.economy.adjustBank({ guildId, userId: l.seller_id, delta: l.price - tax, type: "market_sell", reason: `${l.quantity}× ${l.item_key}${tax ? ` (ضريبة ${tax})` : ""}`, refType: "market", refId: l.id, counterpartyId: buyerId });
      this.rp.give({ guildId, userId: buyerId, itemKey: l.item_key, amount: l.quantity, reason: `سوق #${l.id}` });
      return { ok: true, listing: l, tax };
    });
  }

  cancelListing({ guildId, userId, listingId, force = false }) {
    return this.atomic(() => {
      const l = this.db.prepare("SELECT * FROM econ_market WHERE id = ? AND guild_id = ?").get(listingId, guildId);
      if (!l || l.status !== "active" || (!force && l.seller_id !== userId)) EconomyPlusRepository.abort("notFound");
      this.db.prepare("UPDATE econ_market SET status = 'cancelled', closed_at = ? WHERE id = ? AND status = 'active'").run(Date.now(), listingId);
      this.rp.give({ guildId, userId: l.seller_id, itemKey: l.item_key, amount: l.quantity, reason: `إلغاء عرض سوق #${l.id}` });
      return { ok: true, listing: l };
    });
  }

  marketListings(guildId, { limit = 10, offset = 0, itemKey = null } = {}) {
    const where = itemKey ? "AND item_key = ?" : "";
    const params = itemKey ? [guildId, itemKey, limit, offset] : [guildId, limit, offset];
    return this.db.prepare(`SELECT * FROM econ_market WHERE guild_id = ? AND status = 'active' ${where} ORDER BY price * 1.0 / quantity ASC LIMIT ? OFFSET ?`).all(...params);
  }

  marketCount(guildId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM econ_market WHERE guild_id = ? AND status = 'active'").get(guildId).c;
  }

  // ---------------- المزادات ----------------

  createAuction({ guildId, sellerId, itemKey, quantity, minBid, endsAt }) {
    return this.atomic(() => {
      this._take(guildId, sellerId, itemKey, quantity, "حجز للمزاد");
      const info = this.db
        .prepare("INSERT INTO econ_auctions (guild_id, seller_id, item_key, quantity, min_bid, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(guildId, sellerId, itemKey, quantity, minBid, endsAt, Date.now());
      return { ok: true, id: info.lastInsertRowid };
    });
  }

  auction(id) {
    return this.db.prepare("SELECT * FROM econ_auctions WHERE id = ?").get(id) || null;
  }

  setAuctionMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE econ_auctions SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  /** مزايدة: تُحجز من المزايد، والمزايدة السابقة تُعاد لصاحبها — في نفس المعاملة. */
  bid({ guildId, auctionId, userId, amount, minIncrementPercent = 5 }) {
    return this.atomic(() => {
      const a = this.auction(auctionId);
      if (!a || a.guild_id !== guildId || a.status !== "active" || a.ends_at <= Date.now()) EconomyPlusRepository.abort("closed");
      if (a.seller_id === userId) EconomyPlusRepository.abort("ownAuction");
      if (a.top_bidder === userId) EconomyPlusRepository.abort("alreadyTop");
      const minimum = a.top_bid ? Math.ceil(a.top_bid * (1 + minIncrementPercent / 100)) : a.min_bid;
      if (amount < minimum) EconomyPlusRepository.abort("tooLow", { minimum });
      const res = this.db
        .prepare("UPDATE econ_auctions SET top_bid = ?, top_bidder = ? WHERE id = ? AND status = 'active' AND COALESCE(top_bid, 0) = ?")
        .run(amount, userId, auctionId, a.top_bid || 0);
      if (res.changes !== 1) EconomyPlusRepository.abort("outbid");
      this._spend({ guildId, userId, amount, type: "auction_bid", reason: `مزاد #${auctionId}`, refType: "auction", refId: auctionId });
      if (a.top_bidder) {
        this.economy.adjustBank({ guildId, userId: a.top_bidder, delta: a.top_bid, type: "auction_refund", reason: `تجاوز مزايدتك في مزاد #${auctionId}`, refType: "auction", refId: auctionId });
      }
      this.db.prepare("INSERT INTO econ_bids (auction_id, user_id, amount, created_at) VALUES (?, ?, ?, ?)").run(auctionId, userId, amount, Date.now());
      return { ok: true, previousBidder: a.top_bidder, previousBid: a.top_bid };
    });
  }

  /** إنهاء المزاد: العنصر للفائز والمال للبائع (ناقص الرسوم)، أو إعادة العنصر إن لم توجد مزايدات. */
  endAuction(auctionId, feePercent) {
    return this.atomic(() => {
      const a = this.auction(auctionId);
      if (!a || a.status !== "active") EconomyPlusRepository.abort("closed");
      this.db.prepare("UPDATE econ_auctions SET status = 'ended' WHERE id = ? AND status = 'active'").run(auctionId);
      if (!a.top_bidder) {
        this.rp.give({ guildId: a.guild_id, userId: a.seller_id, itemKey: a.item_key, amount: a.quantity, reason: `مزاد #${a.id} بلا مزايدات` });
        return { ok: true, auction: a, sold: false };
      }
      const fee = Math.floor((a.top_bid * feePercent) / 100);
      this.rp.give({ guildId: a.guild_id, userId: a.top_bidder, itemKey: a.item_key, amount: a.quantity, reason: `فوز بمزاد #${a.id}` });
      this.economy.adjustBank({ guildId: a.guild_id, userId: a.seller_id, delta: a.top_bid - fee, type: "auction_sale", reason: `مزاد #${a.id}${fee ? ` (رسوم ${fee})` : ""}`, refType: "auction", refId: a.id, counterpartyId: a.top_bidder });
      return { ok: true, auction: a, sold: true, fee };
    });
  }

  cancelAuction(auctionId, actorId, force = false) {
    return this.atomic(() => {
      const a = this.auction(auctionId);
      if (!a || a.status !== "active") EconomyPlusRepository.abort("closed");
      if (!force && a.seller_id !== actorId) EconomyPlusRepository.abort("notOwner");
      if (!force && a.top_bidder) EconomyPlusRepository.abort("hasBids");
      this.db.prepare("UPDATE econ_auctions SET status = 'cancelled' WHERE id = ?").run(auctionId);
      if (a.top_bidder) this.economy.adjustBank({ guildId: a.guild_id, userId: a.top_bidder, delta: a.top_bid, type: "auction_refund", reason: `إلغاء مزاد #${a.id}`, refType: "auction", refId: a.id });
      this.rp.give({ guildId: a.guild_id, userId: a.seller_id, itemKey: a.item_key, amount: a.quantity, reason: `إلغاء مزاد #${a.id}` });
      return { ok: true, auction: a };
    });
  }

  auctions(guildId, limit = 10) {
    return this.db.prepare("SELECT * FROM econ_auctions WHERE guild_id = ? AND status = 'active' ORDER BY ends_at ASC LIMIT ?").all(guildId, limit);
  }

  // ---------------- التداول ----------------

  createTrade(t) {
    const info = this.db
      .prepare(
        `INSERT INTO econ_trades (guild_id, from_id, to_id, offer_money, offer_item, offer_qty, want_money, want_item, want_qty, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(t.guildId, t.fromId, t.toId, t.offerMoney || 0, t.offerItem || null, t.offerQty || 0, t.wantMoney || 0, t.wantItem || null, t.wantQty || 0, t.expiresAt, Date.now());
    return this.trade(info.lastInsertRowid);
  }

  trade(id) {
    return this.db.prepare("SELECT * FROM econ_trades WHERE id = ?").get(id) || null;
  }

  /** قبول التداول: الطرفان يسلّمان ما وعدا به أو لا يحدث شيء إطلاقًا. */
  acceptTrade(id, userId) {
    return this.atomic(() => {
      const t = this.trade(id);
      if (!t || t.status !== "pending") EconomyPlusRepository.abort("closed");
      if (t.to_id !== userId) EconomyPlusRepository.abort("notYours");
      if (t.expires_at <= Date.now()) {
        this.db.prepare("UPDATE econ_trades SET status = 'expired', closed_at = ? WHERE id = ?").run(Date.now(), id);
        EconomyPlusRepository.abort("expired");
      }
      const res = this.db.prepare("UPDATE econ_trades SET status = 'accepted', closed_at = ? WHERE id = ? AND status = 'pending'").run(Date.now(), id);
      if (res.changes !== 1) EconomyPlusRepository.abort("closed");
      const g = t.guild_id;
      if (t.offer_money) {
        this._spend({ guildId: g, userId: t.from_id, amount: t.offer_money, type: "trade_out", reason: `تداول #${id}`, refType: "trade", refId: id, counterpartyId: t.to_id });
        this.economy.adjustBank({ guildId: g, userId: t.to_id, delta: t.offer_money, type: "trade_in", reason: `تداول #${id}`, refType: "trade", refId: id, counterpartyId: t.from_id });
      }
      if (t.want_money) {
        this._spend({ guildId: g, userId: t.to_id, amount: t.want_money, type: "trade_out", reason: `تداول #${id}`, refType: "trade", refId: id, counterpartyId: t.from_id });
        this.economy.adjustBank({ guildId: g, userId: t.from_id, delta: t.want_money, type: "trade_in", reason: `تداول #${id}`, refType: "trade", refId: id, counterpartyId: t.to_id });
      }
      if (t.offer_item && t.offer_qty) {
        this._take(g, t.from_id, t.offer_item, t.offer_qty, `تداول #${id}`);
        this.rp.give({ guildId: g, userId: t.to_id, itemKey: t.offer_item, amount: t.offer_qty, reason: `تداول #${id}` });
      }
      if (t.want_item && t.want_qty) {
        this._take(g, t.to_id, t.want_item, t.want_qty, `تداول #${id}`);
        this.rp.give({ guildId: g, userId: t.from_id, itemKey: t.want_item, amount: t.want_qty, reason: `تداول #${id}` });
      }
      return { ok: true, trade: t };
    });
  }

  closeTrade(id, userId, status) {
    const t = this.trade(id);
    if (!t || t.status !== "pending") return { ok: false, reason: "closed" };
    if (status === "declined" && t.to_id !== userId) return { ok: false, reason: "notYours" };
    if (status === "cancelled" && t.from_id !== userId) return { ok: false, reason: "notYours" };
    const res = this.db.prepare("UPDATE econ_trades SET status = ?, closed_at = ? WHERE id = ? AND status = 'pending'").run(status, Date.now(), id);
    return res.changes === 1 ? { ok: true, trade: t } : { ok: false, reason: "closed" };
  }

  // ---------------- القروض (فوق جدول loans الموجود) ----------------

  /** الموافقة تصرف المبلغ وتضبط المستحق بالفائدة وموعد الاستحقاق — ذرّيًا. */
  approveLoan({ loanId, guildId, reviewerId, interestPercent, termMs }) {
    return this.atomic(() => {
      const loan = this.economy.getLoan(loanId);
      if (!loan || loan.guild_id !== guildId) EconomyPlusRepository.abort("notFound");
      if (!this.economy.approveLoan(loanId, reviewerId)) EconomyPlusRepository.abort("alreadyDecided");
      const due = Math.ceil(loan.amount * (1 + interestPercent / 100));
      this.db.prepare("UPDATE loans SET remaining = ?, interest_percent = ?, due_at = ? WHERE id = ?").run(due, interestPercent, Date.now() + termMs, loanId);
      this.economy.adjustBank({ guildId, userId: loan.user_id, delta: loan.amount, type: "loan", reason: `قرض #${loanId}`, refType: "loan", refId: loanId, actorId: reviewerId });
      return { ok: true, loan: this.economy.getLoan(loanId), due };
    });
  }

  repayLoan({ guildId, userId, loanId, amount }) {
    return this.atomic(() => {
      const loan = this.economy.getLoan(loanId);
      if (!loan || loan.guild_id !== guildId || loan.user_id !== userId || loan.status !== "active") EconomyPlusRepository.abort("notFound");
      const pay = Math.min(amount, loan.remaining);
      this._spend({ guildId, userId, amount: pay, type: "loan_repay", reason: `سداد قرض #${loanId}`, refType: "loan", refId: loanId });
      if (!this.economy.repayLoan(loanId, pay)) EconomyPlusRepository.abort("notFound");
      return { ok: true, paid: pay, loan: this.economy.getLoan(loanId) };
    });
  }

  overdueLoans(now = Date.now(), limit = 100) {
    return this.db.prepare("SELECT * FROM loans WHERE status = 'active' AND due_at IS NOT NULL AND due_at <= ? LIMIT ?").all(now, limit);
  }

  /** تحصيل المتأخر: يُخصم المتاح (حتى المستحق كاملًا) دون أن ينزل الرصيد تحت الصفر. */
  collectOverdue(loan) {
    return this.atomic(() => {
      const account = this.economy.get(loan.guild_id, loan.user_id);
      const available = account ? account.bank + account.wallet : 0;
      const pay = Math.min(available, loan.remaining);
      if (pay <= 0) return { ok: true, paid: 0 };
      this._spend({ guildId: loan.guild_id, userId: loan.user_id, amount: pay, type: "loan_repay", reason: `تحصيل قرض متأخر #${loan.id}`, refType: "loan", refId: loan.id });
      this.economy.repayLoan(loan.id, pay);
      return { ok: true, paid: pay };
    });
  }

  // ---------------- إحصاءات ----------------

  stats(guildId, sinceMs) {
    const volume = this.db
      .prepare("SELECT type, COUNT(*) AS c, COALESCE(SUM(amount), 0) AS total FROM transactions WHERE guild_id = ? AND created_at >= ? GROUP BY type ORDER BY total DESC")
      .all(guildId, sinceMs);
    const loans = this.db
      .prepare("SELECT status, COUNT(*) AS c, COALESCE(SUM(remaining), 0) AS remaining FROM loans WHERE guild_id = ? GROUP BY status")
      .all(guildId);
    const invested = this.db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS c FROM econ_investments WHERE guild_id = ? AND status = 'active'")
      .get(guildId);
    return { volume, loans, invested, market: this.marketCount(guildId), shop: this.shopStats(guildId) };
  }

  history(guildId, userId, { type = null, limit = 10, offset = 0 } = {}) {
    const where = type ? "AND type = ?" : "";
    const params = type ? [guildId, userId, type, limit, offset] : [guildId, userId, limit, offset];
    return this.db.prepare(`SELECT * FROM transactions WHERE guild_id = ? AND user_id = ? ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params);
  }

  historyCount(guildId, userId, type = null) {
    const where = type ? "AND type = ?" : "";
    const params = type ? [guildId, userId, type] : [guildId, userId];
    return this.db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE guild_id = ? AND user_id = ? ${where}`).get(...params).c;
  }
}

EconomyPlusRepository.Abort = Abort;
module.exports = EconomyPlusRepository;
