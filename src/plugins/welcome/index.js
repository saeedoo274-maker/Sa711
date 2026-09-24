const WelcomeService = require("./WelcomeService");

module.exports = {
  register(app) {
    app.welcome = new WelcomeService(app);
    app.notifications.registerCategory("welcome", "رسائل الترحيب");
  },
  events: {
    guildMemberAdd: (app, member) => app.welcome.onJoin(member),
    guildMemberRemove: (app, member) => app.welcome.onLeave(member)
  },
  health(app) {
    return { ok: true, details: require("../../core/utils/canvas").available() ? "صور الترحيب متاحة" : "بلا مكتبة رسم — إمبيد فقط" };
  }
};
