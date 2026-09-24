const AchievementRepository = require("./AchievementRepository");
const AchievementService = require("./AchievementService");

module.exports = {
  register(app) {
    app.achievementsRepo = new AchievementRepository(app.db);
    app.achievements = new AchievementService(app, app.achievementsRepo);
    app.achievements.wire();
    app.notifications.registerCategory("achievements", "الإنجازات");
  },
  start(app) {
    app.achievements.start();
  },
  stop(app) {
    app.achievements?.stop();
  },
  health(app) {
    return { ok: true, details: `مقاييس بانتظار الكتابة: ${app.achievements.pending.size}` };
  }
};
