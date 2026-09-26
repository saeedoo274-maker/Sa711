const IntegrationService = require("./IntegrationService");

module.exports = {
  register(app) {
    app.integrations = new IntegrationService(app);
    app.scheduler.define("integrations:poll", () => app.integrations.poll(), { description: "فحص التكاملات المستحقة" });
    for (const event of IntegrationService.PUSH_EVENTS) {
      app.bus.on(event, (payload) => app.integrations.onEvent(event, payload).catch((err) => app.errors.capture(err, { system: "integrations/push" })));
    }
  },
  start(app) {
    app.scheduler.ensureRecurring("integrations:poll", "integrations:poll", { kind: "interval", everyMs: 120_000 });
  },
  health(app) {
    return { ok: true, details: `مزوّدات: ${app.integrations.providers.size}` };
  }
};
