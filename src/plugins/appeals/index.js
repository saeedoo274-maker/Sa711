const AppealRepository = require("./AppealRepository");
const AppealService = require("./AppealService");

module.exports = {
  register(app) {
    app.appealsRepo = new AppealRepository(app.db);
    app.appeals = new AppealService(app, app.appealsRepo);
  },
  health(app) {
    return { ok: true, details: "الاستئنافات جاهزة" };
  }
};
