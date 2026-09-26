const crypto = require("node:crypto");

/** أدوات HTTP مشتركة للوحة والـ API (بلا مكتبات خارجية). */

const MAX_BODY = 100 * 1024;

function securityHeaders(res, nonce = null) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (nonce) {
    res.setHeader("Content-Security-Policy", `default-src 'none'; img-src 'self' https://cdn.discordapp.com data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  }
}

function json(res, code, body, headers = {}) {
  if (res.headersSent) return;
  securityHeaders(res);
  if (code === 413) headers = { ...headers, Connection: "close" };
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function html(res, code, body, nonce, headers = {}) {
  if (res.headersSent) return;
  securityHeaders(res, nonce);
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  securityHeaders(res);
  res.writeHead(302, { Location: location, "Cache-Control": "no-store", ...headers });
  res.end();
}

/** يقرأ الجسم بحد أقصى، ويحلل JSON أو نموذج HTML حسب النوع. */
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        if (aborted) return;
        // نتوقف عن القراءة ونرد 413 مع إغلاق الاتصال (بدل قطعه قبل وصول الرد)
        aborted = true;
        req.pause();
        chunks.length = 0;
        return resolve({ error: "tooLarge" });
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      const type = String(req.headers["content-type"] || "");
      if (!raw) return resolve({ data: {} });
      try {
        if (type.includes("application/json")) return resolve({ data: JSON.parse(raw) });
        if (type.includes("application/x-www-form-urlencoded")) return resolve({ data: Object.fromEntries(new URLSearchParams(raw)) });
      } catch {
        return resolve({ error: "badJson" });
      }
      return resolve({ error: "unsupportedType" });
    });
    req.on("error", () => resolve({ error: "readError" }));
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, { maxAge = null, secure = false, httpOnly = true } = {}) {
  return [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax", httpOnly ? "HttpOnly" : null, secure ? "Secure" : null, maxAge !== null ? `Max-Age=${maxAge}` : null].filter(Boolean).join("; ");
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * محدد معدل بسيط (نافذة ثابتة) لكل مفتاح. الذاكرة محدودة: تُنظّف النوافذ المنتهية
 * عند تجاوز الحد، ولا تنمو بلا نهاية مع عناوين كثيرة.
 */
class RateLimiter {
  constructor({ limit = 60, windowMs = 60_000, maxKeys = 50_000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.hits = new Map();
  }

  take(key, limit = this.limit, now = Date.now()) {
    let w = this.hits.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (this.hits.size >= this.maxKeys) {
        for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
        if (this.hits.size >= this.maxKeys) this.hits.clear();
      }
      w = { start: now, count: 0 };
      this.hits.set(key, w);
    }
    w.count++;
    const remaining = Math.max(0, limit - w.count);
    return { ok: w.count <= limit, remaining, resetMs: w.start + this.windowMs - now };
  }
}

function clientIp(req) {
  // خلف وكيل الاستضافة يُستخدم أول عنوان في X-Forwarded-For فقط إن فُعّل TRUST_PROXY
  if (process.env.TRUST_PROXY === "true") {
    const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || "unknown";
}

module.exports = { json, html, redirect, readBody, parseCookies, cookie, esc, sha256, safeEqual, RateLimiter, securityHeaders, clientIp, MAX_BODY };
