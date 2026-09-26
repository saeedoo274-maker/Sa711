const GuildBackupService = require("./GuildBackupService");

module.exports = {
  register(app) {
    app.guildBackups = new GuildBackupService(app);
    app.queue.define("backup:restore", (job, tools) => app.guildBackups.restoreWorker(job, tools), { concurrency: 1, description: "استعادة نسخة سيرفر" });
    app.scheduler.define("guild-backup:run", (job) => app.guildBackups.scheduledRun(job.payload.guildId), { description: "نسخة سيرفر دورية" });
  },
  health() {
    return { ok: true, details: "نسخ السيرفر جاهز" };
  }
};
