const ReminderRepository = require("./ReminderRepository");
const ReminderService = require("./ReminderService");

module.exports = {
  register(app) {
    app.remindersRepo = new ReminderRepository(app.db);
    app.reminders = new ReminderService(app, app.remindersRepo);
    app.scheduler.define("reminder:fire", (job) => app.reminders.fire(job.payload.id), { description: "إرسال تذكير" });
    app.scheduler.define("reminders:cleanup", () => { app.remindersRepo.purgeInactive(30 * 86_400_000); }, { description: "حذف التذكيرات المنتهية القديمة" });
    app.notifications.registerCategory("reminders", "التذكيرات");
  },
  start(app) {
    app.scheduler.ensureRecurring("reminders:cleanup", "reminders:cleanup", { kind: "daily", time: "04:10", tz: "UTC" });
  },
  health(app) {
    const active = app.db.prepare("SELECT COUNT(*) AS c FROM reminders WHERE active = 1").get().c;
    const orphans = app.db.prepare(
      "SELECT COUNT(*) AS c FROM reminders r WHERE r.active = 1 AND NOT EXISTS (SELECT 1 FROM scheduled_jobs j WHERE j.unique_key = 'reminder:' || r.id AND j.status IN ('pending','running'))"
    ).get().c;
    return { ok: orphans === 0, details: `نشطة: ${active}${orphans ? ` — بلا مهمة مجدولة: ${orphans}` : ""}` };
  }
};
