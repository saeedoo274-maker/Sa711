const { validateUrl, pickPath } = require("../../../core/utils/safeFetch");

/** API خارجي عام: رابط JSON + مسارات للمعرّف والعنوان والرابط؛ ينشر عند تغيّر المعرّف. */
module.exports = [
  {
    key: "api", label: "API خارجي (JSON)", emoji: "🔌", kind: "feed", hint: "https://api.example.com/latest",
    normalize(source, options = {}) {
      const url = String(source || "").trim();
      if (!validateUrl(url).ok) return { ok: false, reason: "badUrl" };
      const path = (p) => (p && /^[\w.[\]-]{1,100}$/.test(p) ? p : null);
      return { ok: true, source: url, options: { idPath: path(options.idPath) || "id", titlePath: path(options.titlePath) || "title", urlPath: path(options.urlPath) } };
    },
    async fetch(sub, http) {
      const res = await http(sub.source, { json: true });
      if (!res.ok) throw new Error(`HTTP ${res.status || res.reason}`);
      const o = sub.options || {};
      const list = Array.isArray(res.json) ? res.json : [res.json];
      return {
        items: list.slice(0, 20).map((x) => {
          const link = o.urlPath ? pickPath(x, o.urlPath) : null;
          return { id: String(pickPath(x, o.idPath) ?? ""), title: String(pickPath(x, o.titlePath) ?? "").slice(0, 256), url: typeof link === "string" && /^https:\/\//.test(link) ? link : null };
        }).filter((i) => i.id)
      };
    }
  },
  {
    key: "webhook", label: "Webhook صادر (أحداث البوت)", emoji: "📤", kind: "push", hint: "https://your-server.example.com/hook",
    normalize(source, options = {}) {
      const url = String(source || "").trim();
      if (!validateUrl(url).ok) return { ok: false, reason: "badUrl" };
      const events = String(options.events || "").split(/[,\s]+/).filter(Boolean);
      const allowed = require("../IntegrationService").PUSH_EVENTS;
      const picked = events.length ? events.filter((e) => allowed.includes(e)) : allowed;
      if (!picked.length) return { ok: false, reason: "badEvents" };
      const secret = options.secret ? String(options.secret).slice(0, 128) : null;
      return { ok: true, source: url, options: { events: picked, secret } };
    }
  }
];
