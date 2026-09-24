const AnalyticsRepository = require("./AnalyticsRepository");
const AnalyticsService = require("./AnalyticsService");

module.exports = {
  register(app) {
    app.analyticsRepo = new AnalyticsRepository(app.db);
    app.analytics = new AnalyticsService(app, app.analyticsRepo);
  },
  health(app) {
    return { ok: true, details: `كاش: ${app.analytics.cache.size}` };
  }
};
