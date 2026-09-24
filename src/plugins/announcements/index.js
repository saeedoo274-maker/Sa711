const AnnouncementRepository = require("./AnnouncementRepository");
const AnnouncementService = require("./AnnouncementService");

module.exports = {
  register(app) {
    app.announcementsRepo = new AnnouncementRepository(app.db);
    app.announcements = new AnnouncementService(app, app.announcementsRepo);
    app.scheduler.define("announce:send", (job) => app.announcements.runScheduled(job.payload.id), { description: "إرسال إعلان مجدول" });
    app.queue.define("announce:dm", (job, tools) => app.announcements.dmWorker(job, tools), { concurrency: 1, description: "إعلان في خاص أعضاء رتبة" });
  },
  health(app) {
    return { ok: true, details: "الإعلانات جاهزة" };
  }
};
