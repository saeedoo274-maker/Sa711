const TicketsPlusRepository = require("./TicketsPlusRepository");
const TicketsPlusService = require("./TicketsPlusService");

module.exports = {
  register(app) {
    app.ticketsPlusRepo = new TicketsPlusRepository(app.db);
    app.ticketsPlus = new TicketsPlusService(app, app.ticketsPlusRepo);
    app.bus.on("ticket:created", (p) => app.ticketsPlus.onCreated(p));
    app.bus.on("ticket:closed", ({ ticket }) => ticket && app.ticketsPlus.awaiting.delete(ticket.channel_id));
    app.scheduler.define("ticket:sla", (job) => app.ticketsPlus.slaCheck(job.payload.id), { description: "فحص SLA لتذكرة" });
    app.scheduler.define("ticket:close", (job) => app.ticketsPlus.runScheduledClose(job.payload), { description: "إغلاق تذكرة مؤجل" });
  },
  start(app) {
    app.ticketsPlus.loadAwaiting();
  },
  events: {
    messageCreate: (app, message) => app.ticketsPlus.onMessage(message)
  },
  health(app) {
    return { ok: true, details: `تذاكر بانتظار أول رد: ${app.ticketsPlus.awaiting.size}` };
  }
};
