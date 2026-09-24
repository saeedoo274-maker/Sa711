const EconomyPlusRepository = require("./EconomyPlusRepository");
const EconomyPlusService = require("./EconomyPlusService");
const ShopService = require("./ShopService");
const MarketService = require("./MarketService");
const InventoryService = require("./InventoryService");

module.exports = {
  register(app) {
    app.economyPlusRepo = new EconomyPlusRepository(app.db, app.economy, app.rp);
    app.economyPlus = new EconomyPlusService(app, app.economyPlusRepo);
    app.inventory = new InventoryService(app);
    app.shop = new ShopService(app, app.economyPlusRepo);
    app.market = new MarketService(app, app.economyPlusRepo);
    app.notifications.registerCategory("economy", "الاقتصاد");

    app.scheduler.define("economy:auction-end", (job) => app.market.endAuction(job.payload.id), { description: "إنهاء مزاد" });
    app.scheduler.define("economy:trade-expire", (job) => {
      const trade = app.economyPlusRepo.trade(job.payload.id);
      if (trade?.status === "pending") app.economyPlusRepo.closeTrade(trade.id, trade.from_id, "cancelled");
    }, { description: "انتهاء عرض تداول" });
    app.scheduler.define("economy:loans", () => app.economyPlus.collectOverdue(), { description: "تحصيل القروض المتأخرة" });
  },
  start(app) {
    app.scheduler.ensureRecurring("economy:loans", "economy:loans", { kind: "daily", time: "05:00", tz: "UTC" });
  },
  health(app) {
    const orphan = app.db
      .prepare("SELECT COUNT(*) AS c FROM econ_auctions a WHERE a.status = 'active' AND NOT EXISTS (SELECT 1 FROM scheduled_jobs j WHERE j.unique_key = 'auction:' || a.id AND j.status IN ('pending','running'))")
      .get().c;
    return { ok: orphan === 0, details: `مزادات بلا مهمة إنهاء: ${orphan}` };
  }
};
