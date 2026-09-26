const SocialPlusRepository = require("./SocialPlusRepository");
const SocialPlusService = require("./SocialPlusService");

module.exports = {
  register(app) {
    app.socialPlusRepo = new SocialPlusRepository(app.db);
    app.socialPlus = new SocialPlusService(app, app.socialPlusRepo);
  },
  health() {
    return { ok: true, details: "التواصل الاجتماعي المتقدم جاهز" };
  }
};
