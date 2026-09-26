const CaseworkRepository = require("./CaseworkRepository");
const CaseworkService = require("./CaseworkService");

module.exports = {
  register(app) {
    app.caseworkRepo = new CaseworkRepository(app.db);
    app.casework = new CaseworkService(app, app.caseworkRepo);
    app.bus.on("report:created", (p) => app.casework.onReportCreated(p));
    app.scheduler.define("report:sla", (job) => app.casework.reportSla(job.payload.id), { description: "فحص SLA لبلاغ" });
  },
  health() {
    return { ok: true, details: "القضايا والبلاغات جاهزة" };
  }
};
