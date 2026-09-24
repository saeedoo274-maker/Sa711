const RewardRepository = require("./RewardRepository");
const RewardService = require("./RewardService");

module.exports = {
  register(app) {
    app.rewardsRepo = new RewardRepository(app.db);
    app.rewards = new RewardService(app, app.rewardsRepo);

    app.scheduler.define("rewards:weekly", () => app.rewards.runWeekly(), { description: "مكافآت النشاط الأسبوعي" });
    app.scheduler.define("rewards:cleanup", () => { app.rewardsRepo.purgeOldClaims(120 * 86_400_000); }, { description: "تنظيف مطالبات المكافآت القديمة" });
    app.notifications.registerCategory("rewards", "المكافآت");
  },

  start(app) {
    // مهام عامة واحدة للبوت كله (المفتاح الفريد يمنع تكرارها مع كل إقلاع)
    app.scheduler.ensureRecurring("rewards:weekly", "rewards:weekly", { kind: "weekly", weekday: 0, time: "00:05", tz: "UTC" });
    app.scheduler.ensureRecurring("rewards:cleanup", "rewards:cleanup", { kind: "daily", time: "04:00", tz: "UTC" });
  },

  events: {
    messageCreate: (app, message) => app.rewards.onMessage(message)
  },

  health(app) {
    return { ok: !!app.rewards, details: `شارات مسجّلة: ${app.db.prepare("SELECT COUNT(*) AS c FROM badges").get().c}` };
  }
};
