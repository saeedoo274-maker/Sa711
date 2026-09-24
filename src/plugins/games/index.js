const GameRepository = require("./GameRepository");
const GameEngine = require("./GameEngine");

module.exports = {
  register(app) {
    app.gamesRepo = new GameRepository(app.db, app.economy);
    app.games = new GameEngine(app, app.gamesRepo);
    app.scheduler.define("games:expire", (job) => app.games.expire(job.payload.id), { description: "انتهاء مهلة لعبة" });
  },
  start(app) {
    // الجلسات التي كانت جارية قبل التوقف تُسترد رهاناتها (رسائلها التفاعلية لم تعد صالحة)
    const refunded = app.games.refundAllStale();
    if (refunded) app.logger.warn(`الألعاب: استُردّت رهانات ${refunded} جلسة كانت جارية قبل إعادة التشغيل.`);
  },
  health(app) {
    return { ok: true, details: `ألعاب محمّلة: ${[...app.games.games.keys()].join(", ")}` };
  }
};
