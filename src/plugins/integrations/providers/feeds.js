const { validateUrl } = require("../../../core/utils/safeFetch");
const { parseFeed } = require("../feedParser");

/** مزوّدات تعتمد على خلاصات RSS/Atom عامة (بلا مفاتيح). */
async function fetchFeed(http, url) {
  const res = await http(url, { maxBytes: 1024 * 1024, headers: { accept: "application/rss+xml, application/atom+xml, text/xml, */*" } });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status || res.reason}`), { code: res.reason });
  return parseFeed(res.body);
}

const rssLike = (key, label, emoji, hint) => ({
  key, label, emoji, kind: "feed", hint,
  normalize(source) {
    const url = String(source || "").trim();
    return validateUrl(url).ok ? { ok: true, source: url } : { ok: false, reason: "badUrl" };
  },
  fetch: (sub, http) => fetchFeed(http, sub.source)
});

module.exports = [
  rssLike("rss", "RSS / Atom", "📰", "https://example.com/feed.xml"),
  rssLike("x", "X (Twitter) عبر RSS bridge", "𝕏", "https://rsshub.app/twitter/user/<name>"),
  rssLike("tiktok", "TikTok عبر RSS bridge", "🎵", "https://rsshub.app/tiktok/user/@<name>"),
  {
    key: "youtube", label: "YouTube", emoji: "▶️", kind: "feed", hint: "UCxxxxxxxxxxxxxxxxxxxxxx أو رابط القناة",
    normalize(source) {
      const id = String(source || "").match(/(UC[\w-]{22})/)?.[1];
      return id ? { ok: true, source: id } : { ok: false, reason: "badYoutube" };
    },
    fetch: (sub, http) => fetchFeed(http, `https://www.youtube.com/feeds/videos.xml?channel_id=${sub.source}`)
  },
  {
    key: "github", label: "GitHub (إصدارات/تعديلات)", emoji: "🐙", kind: "feed", hint: "owner/repo أو owner/repo@branch للتعديلات",
    normalize(source) {
      const m = String(source || "").trim().replace(/^https:\/\/github\.com\//, "").match(/^([\w.-]{1,39})\/([\w.-]{1,100})(?:@([\w./-]{1,100}))?$/);
      return m ? { ok: true, source: `${m[1]}/${m[2]}${m[3] ? `@${m[3]}` : ""}` } : { ok: false, reason: "badGithub" };
    },
    fetch(sub, http) {
      const [repo, branch] = sub.source.split("@");
      return fetchFeed(http, branch ? `https://github.com/${repo}/commits/${encodeURIComponent(branch)}.atom` : `https://github.com/${repo}/releases.atom`);
    }
  },
  {
    key: "steam", label: "Steam (أخبار لعبة)", emoji: "🎮", kind: "feed", hint: "App ID مثل 730",
    normalize(source) {
      const id = String(source || "").match(/(?:app\/)?(\d{1,10})/)?.[1];
      return id ? { ok: true, source: id } : { ok: false, reason: "badNumber" };
    },
    fetch: (sub, http) => fetchFeed(http, `https://store.steampowered.com/feeds/news/app/${sub.source}/`)
  }
];
