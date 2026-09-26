/**
 * مركز الاختبار: فحوص ذاتية تعمل داخل البوت الحي (قراءة فقط، بلا آثار جانبية).
 * كل فحص يُرجع pass / warn / fail مع تفاصيل، ويُعزل فشله عن بقية الفحوص.
 */
const LIMITS = { slash: 100, options: 25, heapMb: 1024, overdueMs: 5 * 60_000 };

class TestCenter {
  constructor(app) {
    this.app = app;
    this.lastReport = null;
  }

  checks() {
    const app = this.app;
    return [
      ["database.integrity", () => {
        const res = app.database.integrityCheck();
        return res.ok ? { status: "pass" } : { status: "fail", details: JSON.stringify(res.integrity).slice(0, 200) };
      }],
      ["database.migrations", () => {
        const pending = app.database.migrationStatus().filter((m) => !m.appliedAt);
        return pending.length ? { status: "fail", details: `${pending.length} pending: ${pending.slice(0, 3).map((m) => m.name).join(", ")}` } : { status: "pass", details: `${app.database.migrationStatus().length}` };
      }],
      ["database.transactions", () => {
        const tx = app.database.txStats || { total: 0, failed: 0 };
        const rate = tx.total ? tx.failed / tx.total : 0;
        return { status: rate > 0.05 ? "warn" : "pass", details: `${tx.total} tx • ${tx.failed} failed • slowest ${Math.round(tx.slowest || 0)}ms` };
      }],
      ["commands.registry", () => {
        const all = app.registry.all();
        // حد الـ 100 يخص أوامر الشات فقط (قوائم السياق لها حد مستقل)
        const isChat = (c) => c.slash && [undefined, 1].includes(c.slash.toJSON().type);
        const slash = all.filter(isChat).length;
        const broken = all.filter((c) => typeof c.execute !== "function").map((c) => c.name);
        const wide = all.filter((c) => isChat(c) && (c.slash.toJSON().options || []).length > LIMITS.options).map((c) => c.name);
        if (broken.length || wide.length || slash > LIMITS.slash) return { status: "fail", details: `broken=${broken.join(",")} wide=${wide.join(",")} slash=${slash}` };
        return { status: slash >= LIMITS.slash ? "warn" : "pass", details: `${all.length} commands • ${slash}/${LIMITS.slash} slash` };
      }],
      ["interactions.handlers", () => ({ status: app.interactions.handlers.size ? "pass" : "fail", details: `${app.interactions.handlers.size} prefixes` })],
      ["plugins.health", async () => {
        const rows = await app.plugins.health();
        const bad = rows.filter((r) => !r.ok);
        return { status: bad.length ? "fail" : "pass", details: bad.length ? bad.map((r) => `${r.name}: ${r.error || r.status}`).join("; ").slice(0, 300) : `${rows.length} loaded` };
      }],
      ["i18n.coverage", () => {
        const cov = app.i18n.coverage();
        const low = Object.entries(cov).filter(([, v]) => v < 60);
        return { status: low.length ? "warn" : "pass", details: Object.entries(cov).map(([k, v]) => `${k}:${v}%`).join(" ") };
      }],
      ["scheduler", () => {
        const st = app.scheduler.status();
        const overdue = app.db.prepare("SELECT COUNT(*) AS c FROM scheduled_jobs WHERE status = 'pending' AND run_at < ?").get(Date.now() - LIMITS.overdueMs).c;
        const status = !st.running ? "fail" : overdue ? "warn" : "pass";
        return { status, details: `running=${st.running} • overdue=${overdue} • failed=${st.counts.failed || 0}` };
      }],
      ["queue", () => {
        const st = app.queue.status();
        const failed = Object.values(st.counts).reduce((a, c) => a + (c.failed || 0), 0);
        return { status: failed ? "warn" : "pass", details: `${st.queues.length} queues • processed=${st.processed} • failed=${failed}` };
      }],
      ["discord.gateway", () => {
        const ping = app.client.ws?.ping ?? -1;
        const ready = typeof app.client.isReady === "function" ? app.client.isReady() : ping >= 0;
        return { status: !ready ? "fail" : ping > 1000 ? "warn" : "pass", details: `ping=${Math.round(ping)}ms • guilds=${app.client.guilds?.cache?.size ?? 0}` };
      }],
      ["runtime.memory", () => {
        const heap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        return { status: heap > LIMITS.heapMb ? "warn" : "pass", details: `${heap} MB heap` };
      }],
      ["errors.lastHour", () => {
        const n = app.errorRepo.countSince(Date.now() - 3_600_000);
        return { status: n > 50 ? "fail" : n > 5 ? "warn" : "pass", details: `${n}` };
      }],
      ["config.developers", () => ({ status: app.config.developerIds.length ? "pass" : "warn", details: `${app.config.developerIds.length}` })]
    ];
  }

  async run() {
    const started = Date.now();
    const results = [];
    for (const [name, fn] of this.checks()) {
      try {
        results.push({ name, ...(await fn()) });
      } catch (error) {
        results.push({ name, status: "fail", details: error.message });
      }
    }
    const summary = { pass: 0, warn: 0, fail: 0 };
    for (const r of results) summary[r.status]++;
    this.lastReport = { at: Date.now(), ms: Date.now() - started, summary, results };
    return this.lastReport;
  }
}

module.exports = TestCenter;
