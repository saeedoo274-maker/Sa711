const SetupWizard = require("./setupWizard");

module.exports = {
  register(app) {
    app.setupWizard = new SetupWizard(app);
  },
  health(app) {
    return { ok: true, details: `أعلام الميزات المعروفة: ${app.features.list().length} • جلسات الإعداد: ${app.setupWizard.sessions.size}` };
  }
};
