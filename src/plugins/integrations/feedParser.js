/**
 * محلل RSS 2.0 و Atom خفيف بلا مكتبات: يستخرج العناصر الأساسية فقط
 * (معرّف، عنوان، رابط، كاتب، تاريخ، صورة). يتحمّل CDATA والكيانات الشائعة.
 */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'" };

function decode(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : null;
}

function attr(block, name, attribute, filter = null) {
  const re = new RegExp(`<${name}\\s([^>]*?)/?>`, "gi");
  for (const m of block.matchAll(re)) {
    const attrs = m[1];
    if (filter && !filter(attrs)) continue;
    const a = attrs.match(new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
    if (a) return decode(a[1]);
  }
  return null;
}

function stripHtml(html) {
  return decode(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseFeed(xml) {
  const text = String(xml || "");
  const isAtom = /<feed[\s>]/i.test(text) && /<entry[\s>]/i.test(text);
  const blocks = [...text.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const title = tag(text.replace(/<(item|entry)[\s>][\s\S]*$/i, ""), "title");
  const items = blocks.slice(0, 50).map((b) => {
    const link = isAtom ? attr(b, "link", "href", (a) => !/rel\s*=\s*["'](?!alternate)/i.test(a)) : tag(b, "link");
    const id = tag(b, isAtom ? "id" : "guid") || link || tag(b, "title");
    const image = attr(b, "media:thumbnail", "url") || attr(b, "enclosure", "url", (a) => /image\//i.test(a)) || attr(b, "media:content", "url");
    const date = tag(b, isAtom ? "published" : "pubDate") || tag(b, "updated") || tag(b, "dc:date");
    return {
      id: String(id || "").slice(0, 300),
      title: stripHtml(tag(b, "title") || "").slice(0, 256),
      url: link && /^https?:\/\//i.test(link) ? link : null,
      author: stripHtml(tag(b, "author") ? tag(tag(b, "author"), "name") || tag(b, "author") : tag(b, "dc:creator") || "").slice(0, 100) || null,
      summary: stripHtml(tag(b, isAtom ? "summary" : "description") || tag(b, "media:description") || "").slice(0, 300) || null,
      publishedAt: date && !Number.isNaN(Date.parse(date)) ? Date.parse(date) : null,
      image: image && /^https:\/\//i.test(image) ? image : null
    };
  }).filter((i) => i.id);
  return { title, items };
}

module.exports = { parseFeed, decode, stripHtml };
