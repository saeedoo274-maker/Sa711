const AfkRepository = require("./AfkRepository");
const AfkService = require("./AfkService");

module.exports = {
  register(app) {
    app.afkRepo = new AfkRepository(app.db);
    app.afk = new AfkService(app, app.afkRepo);
    app.afk.load();
    app.scheduler.define("afk:expire", async (job) => {
      const guild = app.client.guilds?.cache?.get(job.payload.guildId);
      if (guild) await app.afk.clear(guild, job.payload.userId, { reason: "expired" });
      else {
        app.afkRepo.remove(job.payload.guildId, job.payload.userId);
        app.afk.index.delete(app.afk.key(job.payload.guildId, job.payload.userId));
      }
    }, { description: "انتهاء مدة الغياب" });
  },

  events: {
    messageCreate: (app, message) => app.afk.handleMessage(message)
  },

  health(app) {
    return { ok: true, details: `غائبون الآن: ${app.afk.index.size}` };
  }
};
