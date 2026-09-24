const LevelRepository = require("./LevelRepository");
const LevelService = require("./LevelService");

module.exports = {
  register(app) {
    app.levelsRepo = new LevelRepository(app.db);
    app.levels = new LevelService(app, app.levelsRepo);
    app.notifications.registerCategory("levels", "المستويات");
  },

  start(app) {
    app.levels.startVoice();
  },

  stop(app) {
    app.levels?.stopVoice();
  },

  events: {
    messageCreate: (app, message) => app.levels.handleMessage(message),
    voiceStateUpdate: (app, oldState, newState) => app.levels.onVoiceState(oldState, newState)
  },

  health(app) {
    return { ok: true, details: `جلسات صوت نشطة: ${app.levels.voiceSessions.size}` };
  }
};
