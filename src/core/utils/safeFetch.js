const dns = require("node:dns");
const net = require("node:net");
const https = require("node:https");
const http = require("node:http");

/**
 * جلب HTTP آمن للروابط التي يُدخلها المستخدمون (ردود API، التكاملات، RSS).
 *
 * الحماية من SSRF تتم عند الاتصال نفسه (خيار lookup)، لا بفحص مسبق فقط،
 * فلا ينفع التلاعب بـ DNS بين الفحص والاتصال (DNS rebinding):
 *  - يُرفض أي عنوان خاص/محلي/ربط محلي/متعدد البث/محجوز (IPv4 و IPv6)
 *  - HTTPS فقط افتراضيًا، ومنافذ 443/80 فقط
 *  - مهلة زمنية وحد أقصى لحجم الرد وعدد محدود من إعادة التوجيه (كل خطوة تُفحص من جديد)
 */

const BLOCKED_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
];

function v4ToInt(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateV4(ip) {
  const n = v4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (!net.isIPv6(ip)) return true;
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || /^ff/.test(lower) || lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8");
}

/** lookup يُستدعى من مكتبة http عند الاتصال — يرفض العناوين الداخلية. */
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return callback(Object.assign(new Error(`عنوان محظور: ${hostname}`), { code: "EBLOCKED" }));
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

function validateUrl(raw, { allowHttp = false } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalidUrl" };
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return { ok: false, reason: "protocol" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port && !["443", "80"].includes(url.port)) return { ok: false, reason: "port" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateAddress(host)) return { ok: false, reason: "privateAddress" };
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) return { ok: false, reason: "privateAddress" };
  return { ok: true, url };
}

function request(url, { method = "GET", headers = {}, body = null, timeoutMs = 5000, maxBytes = 256 * 1024 }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "http:" ? http : https;
    const req = lib.request(url, { method, headers: { "user-agent": "DiscordBot (arabic-admin-bot)", ...headers }, lookup: safeLookup, timeout: timeoutMs }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(Object.assign(new Error("الرد أكبر من الحد المسموح"), { code: "ETOOBIG" }));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("انتهت مهلة الطلب"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * @returns {Promise<{ok: true, status, headers, body, json?} | {ok: false, reason, error?}>}
 */
async function safeFetch(raw, opts = {}) {
  let current = raw;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const check = validateUrl(current, opts);
    if (!check.ok) return check;
    let res;
    try {
      res = await request(check.url, opts);
    } catch (error) {
      return { ok: false, reason: error.code === "EBLOCKED" ? "privateAddress" : error.code === "ETOOBIG" ? "tooBig" : error.code === "ETIMEDOUT" ? "timeout" : "network", error: error.message };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, check.url).toString();
      continue;
    }
    const out = { ok: res.status >= 200 && res.status < 300, status: res.status, headers: res.headers, body: res.body };
    if (!out.ok) out.reason = "httpStatus";
    if (opts.json) {
      try {
        out.json = JSON.parse(res.body);
      } catch {
        return { ok: false, reason: "invalidJson", status: res.status };
      }
    }
    return out;
  }
  return { ok: false, reason: "tooManyRedirects" };
}

/** يقرأ قيمة من كائن بمسار نقطي مثل data.items.0.name */
function pickPath(obj, path) {
  if (!path) return obj;
  return String(path).split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

module.exports = { safeFetch, validateUrl, isPrivateAddress, pickPath };
