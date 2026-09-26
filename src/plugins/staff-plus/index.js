const StaffPlusRepository = require("./StaffPlusRepository");
const StaffPlusService = require("./StaffPlusService");

module.exports = {
  register(app) {
    app.staffPlusRepo = new StaffPlusRepository(app.db);
    app.staffPlus = new StaffPlusService(app, app.staffPlusRepo);
    app.bus.on(StaffPlusService.EVENTS.promote, (p) => app.staffPlus.onRankEvent("promote", p));
    app.bus.on(StaffPlusService.EVENTS.demote, (p) => app.staffPlus.onRankEvent("demote", p));
    app.scheduler.define("staff:shiftTimeout", (job) => app.staffPlus.timeoutShift(job.payload.id), { description: "إنهاء مناوبة تجاوزت الحد" });
  },
  health(app) {
    return { ok: true, details: "إدارة الطاقم جاهزة" };
  }
};
