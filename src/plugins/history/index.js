const { Events } = require("../../core/events/EventBus");
const HistoryRepository = require("./HistoryRepository");
const HistoryService = require("./HistoryService");

module.exports = {
  register(app) {
    app.historyRepo = new HistoryRepository(app.db);
    app.history = new HistoryService(app, app.historyRepo);
    // الرتب التي يمنحها البوت بأوامر الإدارة تُسجَّل مع اسم المنفّذ
    for (const event of [Events.ROLE_ADDED, Events.ROLE_REMOVED]) {
      app.bus.on(event, (p) => {
        if (p?.guild && p?.target && p?.role) app.history.rememberRoleActor(p.guild.id, p.target.id, p.role.id, p.executor?.id || null);
      });
    }
    app.scheduler.define("history:retention", () => {
      const removed = app.historyRepo.purgeOlderThan(365 * 86_400_000);
      if (removed.activity || removed.roles) app.logger.info(`سجل الأعضاء: حُذف ${removed.activity} يوم نشاط و${removed.roles} تغيير رتبة أقدم من سنة.`);
    }, { description: "حذف سجل النشاط الأقدم من سنة" });
  },
  start(app) {
    app.history.start();
    app.scheduler.ensureRecurring("history:retention", "history:retention", { kind: "daily", time: "04:20", tz: "UTC" });
  },
  stop(app) {
    app.history?.stop();
  },
  events: {
    messageCreate: (app, message) => app.history.onMessage(message),
    voiceStateUpdate: (app, o, n) => app.history.onVoice(o, n),
    guildMemberAdd: (app, member) => app.history.onJoin(member),
    guildMemberRemove: (app, member) => app.history.onLeave(member),
    guildMemberUpdate: (app, o, n) => app.history.onMemberUpdate(o, n),
    userUpdate: (app, o, n) => app.history.onUserUpdate(o, n)
  },
  health(app) {
    return { ok: true, details: `مخزّن مؤقتًا: ${app.history.activity.size + app.history.seen.size} • صوت: ${app.history.voice.size}` };
  }
};
