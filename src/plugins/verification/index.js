const VerificationRepository = require("./VerificationRepository");
const VerificationService = require("./VerificationService");

module.exports = {
  register(app) {
    app.verificationRepo = new VerificationRepository(app.db);
    app.verification = new VerificationService(app, app.verificationRepo);
  },
  events: {
    guildMemberAdd: (app, member) => app.verification.onJoin(member)
  },
  health(app) {
    return { ok: true, details: `متحققون: ${app.verificationRepo.total()}` };
  }
};
