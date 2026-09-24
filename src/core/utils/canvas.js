/**
 * رسم البطاقات (الرتبة، الترحيب، الرسوم البيانية) بمكتبة `canvas` الاختيارية.
 *
 * المكتبة مذكورة في optionalDependencies: إن لم تُثبَّت (استضافات تمنع
 * البناء الأصلي) تُرجع كل دوال الرسم null، والأنظمة تعرض إمبيدًا بدلها.
 * لا يفشل أي نظام بسبب غياب المكتبة.
 */
let lib;
let loadError = null;

function load() {
  if (lib !== undefined) return lib;
  for (const name of ["canvas", "@napi-rs/canvas"]) {
    try {
      lib = require(name);
      return lib;
    } catch (error) {
      loadError = error.message;
    }
  }
  lib = null;
  return lib;
}

function available() {
  return !!load();
}

const imageCache = new Map(); // url -> { image, at } — محدود الحجم
const IMAGE_CACHE_MAX = 200;
const IMAGE_TTL_MS = 10 * 60_000;

/** يحمّل صورة من رابط مع مهلة وحد حجم، وكاش محدود. */
async function loadRemoteImage(url, { timeoutMs = 5000, maxBytes = 5_000_000 } = {}) {
  const canvas = load();
  if (!canvas || !url || !/^https:\/\//i.test(url)) return null;
  const cached = imageCache.get(url);
  if (cached && Date.now() - cached.at < IMAGE_TTL_MS) return cached.image;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") || 0);
    if (length > maxBytes) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) return null;
    const image = await canvas.loadImage(buffer);
    if (imageCache.size >= IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(url, { image, at: Date.now() });
    return image;
  } catch {
    // صورة غير متاحة (رابط منتهٍ/مهلة) — البطاقة تُرسم بدونها
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hex(num) {
  return `#${Number(num || 0).toString(16).padStart(6, "0")}`;
}

function drawAvatar(ctx, image, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (image) ctx.drawImage(image, x, y, size, size);
  else {
    ctx.fillStyle = "#40444b";
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

function fitText(ctx, text, maxWidth, startSize, weight = "bold") {
  let size = startSize;
  do {
    ctx.font = `${weight} ${size}px sans-serif`;
    size -= 2;
  } while (ctx.measureText(text).width > maxWidth && size > 10);
  return text;
}

function compact(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

/**
 * بطاقة الرتبة.
 * @returns {Promise<Buffer|null>}
 */
async function rankCard({ username, avatarUrl, level, rank, xpInLevel, xpForNext, totalXp, color = 0x5865f2, backgroundUrl = null }) {
  const canvas = load();
  if (!canvas) return null;
  const W = 934, H = 282;
  const c = canvas.createCanvas(W, H);
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#23272a";
  roundRect(ctx, 0, 0, W, H, 24);
  ctx.fill();
  const bg = await loadRemoteImage(backgroundUrl);
  if (bg) {
    ctx.save();
    roundRect(ctx, 0, 0, W, H, 24);
    ctx.clip();
    ctx.globalAlpha = 0.35;
    ctx.drawImage(bg, 0, 0, W, H);
    ctx.restore();
  }

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, 20, 20, W - 40, H - 40, 20);
  ctx.fill();

  drawAvatar(ctx, await loadRemoteImage(avatarUrl), 50, 51, 180);

  ctx.fillStyle = "#ffffff";
  fitText(ctx, username, 380, 40);
  ctx.textAlign = "left";
  ctx.fillText(username, 270, 150);

  ctx.textAlign = "right";
  ctx.font = "bold 30px sans-serif";
  ctx.fillStyle = hex(color);
  ctx.fillText(`LVL ${level}`, W - 60, 90);
  ctx.fillStyle = "#b9bbbe";
  ctx.fillText(`#${rank}`, W - 220, 90);

  ctx.font = "24px sans-serif";
  ctx.fillStyle = "#b9bbbe";
  ctx.fillText(`${compact(xpInLevel)} / ${compact(xpForNext)} XP`, W - 60, 150);

  const barX = 270, barY = 180, barW = W - 330, barH = 36;
  ctx.fillStyle = "#484b4e";
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();
  const ratio = Math.max(0, Math.min(1, xpForNext ? xpInLevel / xpForNext : 0));
  if (ratio > 0) {
    ctx.fillStyle = hex(color);
    roundRect(ctx, barX, barY, Math.max(barH, barW * ratio), barH, barH / 2);
    ctx.fill();
  }
  ctx.textAlign = "left";
  ctx.font = "18px sans-serif";
  ctx.fillStyle = "#8e9297";
  ctx.fillText(`Total ${compact(totalXp)} XP`, 270, 240);

  return c.toBuffer("image/png");
}

/**
 * بطاقة ترحيب/وداع.
 * @returns {Promise<Buffer|null>}
 */
async function welcomeCard({ title, subtitle, avatarUrl, backgroundUrl = null, color = 0x5865f2 }) {
  const canvas = load();
  if (!canvas) return null;
  const W = 1024, H = 450;
  const c = canvas.createCanvas(W, H);
  const ctx = c.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, "#1e2124");
  gradient.addColorStop(1, hex(color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  const bg = await loadRemoteImage(backgroundUrl);
  if (bg) {
    ctx.globalAlpha = 0.5;
    ctx.drawImage(bg, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  ctx.arc(W / 2, 150, 106, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  drawAvatar(ctx, await loadRemoteImage(avatarUrl), W / 2 - 100, 50, 200);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  fitText(ctx, title || "", W - 80, 48);
  ctx.fillText(title || "", W / 2, 320);
  ctx.fillStyle = "#dcddde";
  fitText(ctx, subtitle || "", W - 80, 30, "normal");
  ctx.fillText(subtitle || "", W / 2, 370);

  return c.toBuffer("image/png");
}

/**
 * رسم بياني خطي/أعمدة بسيط لسلاسل زمنية.
 * series: [{ label, color, values: number[] }], labels: string[]
 */
function chart({ title = "", labels = [], series = [], type = "line", width = 1000, height = 420 }) {
  const canvas = load();
  if (!canvas || !labels.length) return null;
  const c = canvas.createCanvas(width, height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 0, width, height);

  const pad = { l: 60, r: 20, t: 50, b: 50 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = Math.max(1, ...series.flatMap((s) => s.values));

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, pad.l, 30);

  ctx.strokeStyle = "#3f4147";
  ctx.fillStyle = "#b5bac1";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + h - (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
    ctx.fillText(compact(Math.round((max * i) / 4)), pad.l - 8, y + 4);
  }

  const step = labels.length > 1 ? w / (labels.length - 1) : w;
  ctx.textAlign = "center";
  const every = Math.ceil(labels.length / 10);
  labels.forEach((label, i) => {
    if (i % every !== 0 && i !== labels.length - 1) return;
    ctx.fillText(label, pad.l + (labels.length > 1 ? i * step : w / 2), height - 20);
  });

  series.forEach((s, si) => {
    ctx.strokeStyle = s.color || ["#5865f2", "#57f287", "#fee75c", "#ed4245"][si % 4];
    ctx.fillStyle = ctx.strokeStyle;
    if (type === "bar") {
      const bw = Math.max(2, (w / labels.length / series.length) * 0.8);
      s.values.forEach((v, i) => {
        const bh = (v / max) * h;
        const x = pad.l + (i * w) / labels.length + si * bw;
        ctx.fillRect(x, pad.t + h - bh, bw, bh);
      });
      return;
    }
    ctx.lineWidth = 3;
    ctx.beginPath();
    s.values.forEach((v, i) => {
      const x = pad.l + (labels.length > 1 ? i * step : w / 2);
      const y = pad.t + h - (v / max) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // مفتاح الألوان
  ctx.textAlign = "left";
  ctx.font = "14px sans-serif";
  let lx = width - pad.r - series.length * 140;
  for (const [si, s] of series.entries()) {
    ctx.fillStyle = s.color || ["#5865f2", "#57f287", "#fee75c", "#ed4245"][si % 4];
    ctx.fillRect(lx, 20, 14, 14);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(s.label || "", lx + 20, 32);
    lx += 140;
  }

  return c.toBuffer("image/png");
}

/** شريط تقدم نصي — البديل حين لا تتوفر مكتبة الرسم. */
function progressBar(ratio, length = 16) {
  const filled = Math.round(Math.max(0, Math.min(1, ratio || 0)) * length);
  return "▰".repeat(filled) + "▱".repeat(length - filled);
}

/** رسم بياني نصي مصغّر (Sparkline). */
function sparkline(values = []) {
  const blocks = "▁▂▃▄▅▆▇█";
  const max = Math.max(1, ...values);
  return values.map((v) => blocks[Math.min(7, Math.floor((v / max) * 7))]).join("");
}

module.exports = { available, load, loadRemoteImage, rankCard, welcomeCard, chart, progressBar, sparkline, compact, loadError: () => loadError };
