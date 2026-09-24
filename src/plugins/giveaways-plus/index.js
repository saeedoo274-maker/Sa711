const GiveawaysPlusRepository = require("./GiveawaysPlusRepository");
const GiveawaysPlusService = require("./GiveawaysPlusService");

module.exports = {
  register(app) {
    app.giveawaysPlusRepo = new GiveawaysPlusRepository(app.db);
    app.giveawaysPlus = new GiveawaysPlusService(app, app.giveawaysPlusRepo);
    app.bus.on("giveaway:ended", (p) => app.giveawaysPlus.onEnded(p).catch((err) => app.errors.capture(err, { system: "giveaways-plus" })));
    app.scheduler.define("giveaway:start", (job) => app.giveawaysPlus.start(job.payload.id), { description: "بدء سحب مجدول" });
  },
  health(app) {
    return { ok: true, details: "السحوبات المتقدمة جاهزة" };
  }
};
