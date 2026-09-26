/**
 * مزوّدات الحالة: تُقارن الحالة الجديدة بالسابقة وتنشر عند التغيّر المهم فقط
 * (تشغيل/إيقاف، بث مباشر، تحديث لعبة) — لا رسائل على كل فحص.
 */
const HOST_RE = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}(:\d{1,5})?$/i;
const twitchToken = { value: null, expiresAt: 0 };

module.exports = [
  {
    key: "minecraft", label: "Minecraft (حالة خادم)", emoji: "⛏️", kind: "status", hint: "play.example.com أو play.example.com:25565",
    normalize(source) {
      const host = String(source || "").trim().toLowerCase();
      return HOST_RE.test(host) ? { ok: true, source: host } : { ok: false, reason: "badHost" };
    },
    async fetch(sub, http) {
      const res = await http(`https://api.mcsrvstat.us/3/${encodeURIComponent(sub.source)}`, { json: true });
      if (!res.ok) throw new Error(`HTTP ${res.status || res.reason}`);
      const j = res.json || {};
      return { state: { online: !!j.online, players: j.players?.online ?? 0, max: j.players?.max ?? 0, version: j.version || null } };
    }
  },
  {
    key: "fivem", label: "FiveM (حالة خادم)", emoji: "🚗", kind: "status", hint: "رمز cfx.re/join مثل abc123",
    normalize(source) {
      const code = String(source || "").trim().replace(/^https?:\/\/cfx\.re\/join\//i, "").toLowerCase();
      return /^[a-z0-9]{4,10}$/.test(code) ? { ok: true, source: code } : { ok: false, reason: "badCode" };
    },
    async fetch(sub, http) {
      const res = await http(`https://servers-frontend.fivem.net/api/servers/single/${sub.source}`, { json: true });
      if (res.status === 404) return { state: { online: false, players: 0, max: 0 } };
      if (!res.ok) throw new Error(`HTTP ${res.status || res.reason}`);
      const d = res.json?.Data || {};
      return { state: { online: true, players: d.clients ?? 0, max: d.sv_maxclients ?? 0, name: String(d.hostname || "").replace(/\^\d/g, "").slice(0, 100) } };
    }
  },
  {
    key: "roblox", label: "Roblox (تحديثات لعبة)", emoji: "🧱", kind: "status", hint: "Universe ID",
    normalize(source) {
      const id = String(source || "").match(/(\d{1,15})/)?.[1];
      return id ? { ok: true, source: id } : { ok: false, reason: "badNumber" };
    },
    async fetch(sub, http) {
      const res = await http(`https://games.roblox.com/v1/games?universeIds=${sub.source}`, { json: true });
      if (!res.ok) throw new Error(`HTTP ${res.status || res.reason}`);
      const g = res.json?.data?.[0];
      if (!g) throw new Error("game not found");
      return { state: { online: true, updated: g.updated, name: g.name, players: g.playing ?? 0, visits: g.visits ?? 0 } };
    }
  },
  {
    key: "twitch", label: "Twitch (بث مباشر)", emoji: "🟣", kind: "status", hint: "اسم القناة",
    available: () => !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET),
    normalize(source) {
      const login = String(source || "").trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i, "").toLowerCase();
      return /^[a-z0-9_]{3,25}$/.test(login) ? { ok: true, source: login } : { ok: false, reason: "badName" };
    },
    async fetch(sub, http) {
      const id = process.env.TWITCH_CLIENT_ID;
      if (!twitchToken.value || Date.now() > twitchToken.expiresAt) {
        const body = new URLSearchParams({ client_id: id, client_secret: process.env.TWITCH_CLIENT_SECRET, grant_type: "client_credentials" }).toString();
        const tok = await http("https://id.twitch.tv/oauth2/token", { method: "POST", json: true, body, headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) } });
        if (!tok.ok || !tok.json?.access_token) throw new Error("twitch auth failed");
        twitchToken.value = tok.json.access_token;
        twitchToken.expiresAt = Date.now() + (tok.json.expires_in - 60) * 1000;
      }
      const res = await http(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(sub.source)}`, { json: true, headers: { "client-id": id, authorization: `Bearer ${twitchToken.value}` } });
      if (res.status === 401) twitchToken.value = null;
      if (!res.ok) throw new Error(`HTTP ${res.status || res.reason}`);
      const s = res.json?.data?.[0];
      return { state: s ? { online: true, title: String(s.title || "").slice(0, 200), game: s.game_name || null, viewers: s.viewer_count ?? 0, startedAt: s.started_at } : { online: false } };
    }
  }
];
