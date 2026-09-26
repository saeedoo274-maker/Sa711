const http = require("node:http");
const crypto = require("node:crypto");

/**
 * خادم HTTP للبوت: فحص الصحة + استقبال Webhook من GitHub.
 *
 * منصات الاستضافة (Railway وغيرها) تحتاج منفذًا مفتوحًا ومسار فحص
 * لتعرف أن الخدمة حيّة، وإلا تعتبرها فاشلة وتعيد تشغيلها بلا داعٍ.
 * نفس الخادم يستقبل أحداث GitHub بدل فتح منفذ ثانٍ.
 *
 * مبني على `node:http` المدمج — بلا أي مكتبة إضافية.
 */
class HealthServer {
  constructor(app) {
    this.app = app;
    this.server = null;
    this.port = null;
  }

  start() {
    // PORT من منصة الاستضافة، أو DASHBOARD_PORT عند تشغيل لوحة التحكم محليًا
    const port = parseInt(process.env.PORT || process.env.DASHBOARD_PORT || "", 10);
    // بلا PORT نفترض تشغيلًا محليًا لا يحتاج خادمًا
    if (!port) return null;
    this.port = port;

    this.server = http.createServer((req, res) => {
      const url = (req.url || "/").split("?")[0];

      if (url === "/health" || url === "/healthz") return this._json(res, 200, this.status());
      if (url.startsWith("/github/")) return this._github(req, res, url.slice("/github/".length));
      // لوحة التحكم و REST API v1 على نفس الخادم
      if (this.app.web?.handles(url)) return this.app.web.handle(req, res);
      if (url === "/") return this._json(res, 200, { name: this.app.config.bot.name, status: "ok" });

      this._json(res, 404, { error: "not found" });
    });

    this.server.on("error", (err) => {
      this.app.logger.error(`خادم الفحص فشل: ${err.message}`);
    });

    this.server.listen(port, "0.0.0.0", () => {
      this.app.logger.info(`خادم فحص الصحة يعمل على المنفذ ${port}`);
    });

    return this.server;
  }

  /** الرابط العام للخادم إن كان معروفًا، وإلا null. */
  publicUrl() {
    const explicit = process.env.PUBLIC_URL;
    if (explicit) return explicit.replace(/\/$/, "");
    // Railway يوفّر هذا المتغيّر تلقائيًا لكل خدمة
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (domain) return `https://${domain}`;
    return null;
  }

  /** يستقبل Webhook من GitHub، يتحقق من التوقيع، وينشر إمبيدًا مناسبًا. */
  async _github(req, res, guildId) {
    if (req.method !== "POST") return this._json(res, 405, { error: "method not allowed" });
    if (!/^\d{15,25}$/.test(guildId)) return this._json(res, 404, { error: "not found" });

    const hook = this.app.githubWebhooks.get(guildId);
    if (!hook) return this._json(res, 404, { error: "not configured" });

    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) { tooLarge = true; req.destroy(); }
    });

    req.on("end", async () => {
      if (tooLarge) return this._json(res, 413, { error: "payload too large" });

      const signature = req.headers["x-hub-signature-256"];
      if (!this._verifySignature(body, signature, hook.secret)) {
        return this._json(res, 401, { error: "invalid signature" });
      }

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return this._json(res, 400, { error: "invalid json" });
      }

      const event = req.headers["x-github-event"];
      const repoName = payload.repository?.full_name;
      if (hook.repo_filter && repoName !== hook.repo_filter) {
        return this._json(res, 200, { ok: true, skipped: "repo filter" });
      }
      if (event && hook.events.length && !hook.events.includes(event)) {
        return this._json(res, 200, { ok: true, skipped: "event filter" });
      }

      await this._publishGithubEvent(hook, event, payload).catch((err) =>
        this.app.logger.error(`فشل نشر حدث GitHub: ${err.message}`)
      );

      this._json(res, 200, { ok: true });
    });
  }

  _verifySignature(body, signature, secret) {
    if (!signature || !signature.startsWith("sha256=")) return false;
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async _publishGithubEvent(hook, event, payload) {
    const channel = await this.app.client.channels.fetch(hook.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;

    const { buildEmbed } = require("../utils/helpers");
    const repo = payload.repository?.full_name || "؟";
    let embed;

    if (event === "push") {
      const commits = payload.commits || [];
      embed = buildEmbed({
        title: `📦 ${commits.length} كوميت جديد على ${repo}`,
        description: commits.slice(0, 5).map((c) => `\`${c.id.slice(0, 7)}\` ${(c.message || "").split("\n")[0].slice(0, 100)}`).join("\n"),
        color: this.app.config.color("info"),
        footer: payload.pusher?.name ? `بواسطة ${payload.pusher.name}` : undefined
      });
    } else if (event === "pull_request") {
      const pr = payload.pull_request;
      embed = buildEmbed({
        title: `🔀 Pull Request ${payload.action}: #${pr.number}`,
        description: `**${pr.title}**\n${(pr.body || "").slice(0, 300)}`,
        color: this.app.config.color(payload.action === "closed" ? "neutral" : "success"),
        footer: `بواسطة ${pr.user?.login || "؟"}`
      });
    } else if (event === "issues") {
      const issue = payload.issue;
      embed = buildEmbed({
        title: `🐛 Issue ${payload.action}: #${issue.number}`,
        description: `**${issue.title}**`,
        color: this.app.config.color(payload.action === "closed" ? "neutral" : "warning")
      });
    } else if (event === "release") {
      const release = payload.release;
      embed = buildEmbed({
        title: `🚀 إصدار جديد: ${release.tag_name}`,
        description: (release.body || "").slice(0, 1000) || release.name || "",
        color: this.app.config.color("success")
      });
    } else {
      return; // حدث غير مدعوم بعرض مخصص
    }

    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  /** ملخص حالة البوت. لا يكشف أي بيانات حساسة. */
  status() {
    const ready = !!this.app.client?.isReady?.();
    return {
      status: ready ? "ok" : "starting",
      uptimeSeconds: Math.round(process.uptime()),
      guilds: this.app.client?.guilds?.cache?.size ?? 0,
      commands: this.app.registry?.commands?.size ?? 0,
      database: this.app.database?.db ? "connected" : "disconnected",
      maintenance: !!this.app.maintenance,
      version: require("../../../package.json").version
    };
  }

  stop() {
    if (this.server) this.server.close();
  }

  _json(res, code, body) {
    const payload = JSON.stringify(body);
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
    res.end(payload);
  }
}

module.exports = HealthServer;
