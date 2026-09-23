// ============================================================
//  أدوات الوقت والمناطق الزمنية — نقية بلا أي اعتماد على discord.js
//  مبنية على Intl المدمج في Node، فلا تحتاج مكتبة مناطق زمنية خارجية.
// ============================================================

const DAY_MS = 86_400_000;

/** يتحقق أن اسم المنطقة الزمنية صالح (مثل Asia/Riyadh). */
function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatterCache = new Map();
function partsFormatter(tz) {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      weekday: "short"
    });
    // الكاش محدود بعدد المناطق الزمنية الموجودة فعلًا (~400)، فلا يتضخم
    formatterCache.set(tz, fmt);
  }
  return fmt;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** يفكك لحظة زمنية إلى مكوّناتها في منطقة زمنية محددة. */
function zonedParts(ms, tz = "UTC") {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type === "weekday") out.weekday = WEEKDAYS[p.value];
    else if (p.type !== "literal") out[p.type] = parseInt(p.value, 10);
  }
  return out; // { year, month(1-12), day, hour, minute, second, weekday(0-6) }
}

/** فرق المنطقة الزمنية عن UTC بالميلي ثانية عند لحظة معيّنة (يشمل التوقيت الصيفي). */
function tzOffsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** يحوّل وقتًا محليًا في منطقة زمنية إلى طابع UTC. */
function zonedToUtc(year, month, day, hour = 0, minute = 0, tz = "UTC") {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // تكراران يكفيان لتجاوز حدود التوقيت الصيفي
  let ts = guess - tzOffsetMs(guess, tz);
  ts = guess - tzOffsetMs(ts, tz);
  return ts;
}

/**
 * يقرأ تاريخًا ووقتًا نصيًا في منطقة زمنية:
 *   "2026-10-01 18:30" | "2026-10-01" | "18:30" (اليوم أو غدًا إن فات)
 * يُرجع طابع UTC أو null.
 */
function parseDateTime(text, tz = "UTC", now = Date.now()) {
  if (!text) return null;
  const s = String(text).trim().replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0"] = m;
    const month = +mo, day = +d, hour = +h, minute = +mi;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    const ts = zonedToUtc(+y, month, day, hour, minute, tz);
    // رفض تواريخ غير موجودة (31 فبراير) — التحويل يرحّلها لشهر آخر
    const back = zonedParts(ts, tz);
    if (back.month !== month || back.day !== day) return null;
    return ts;
  }
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hour = +m[1], minute = +m[2];
    if (hour > 23 || minute > 59) return null;
    const today = zonedParts(now, tz);
    let ts = zonedToUtc(today.year, today.month, today.day, hour, minute, tz);
    if (ts <= now) ts = zonedToUtc(today.year, today.month, today.day + 1, hour, minute, tz);
    return ts;
  }
  return null;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * الموعد التالي لتكرار زمني بعد لحظة `after`.
 * repeat: { kind: "interval", everyMs } | { kind: "daily"|"weekly"|"monthly", time: "HH:MM", tz, weekday, dayOfMonth }
 * يُرجع null إذا كان التكرار غير صالح.
 */
function nextOccurrence(repeat, after = Date.now()) {
  if (!repeat || typeof repeat !== "object") return null;
  if (repeat.kind === "interval") {
    const every = Number(repeat.everyMs);
    if (!Number.isFinite(every) || every < 60_000) return null;
    return after + every;
  }

  const tz = isValidTimezone(repeat.tz) ? repeat.tz : "UTC";
  const [hh, mm] = String(repeat.time || "00:00").split(":").map((x) => parseInt(x, 10));
  const hour = Number.isInteger(hh) && hh >= 0 && hh < 24 ? hh : 0;
  const minute = Number.isInteger(mm) && mm >= 0 && mm < 60 ? mm : 0;
  const base = zonedParts(after, tz);

  if (repeat.kind === "daily") {
    for (let i = 0; i < 3; i++) {
      const ts = zonedToUtc(base.year, base.month, base.day + i, hour, minute, tz);
      if (ts > after) return ts;
    }
    return null;
  }

  if (repeat.kind === "weekly") {
    const target = Number.isInteger(repeat.weekday) ? ((repeat.weekday % 7) + 7) % 7 : base.weekday;
    for (let i = 0; i < 8; i++) {
      const probe = zonedParts(zonedToUtc(base.year, base.month, base.day + i, 12, 0, tz), tz);
      if (probe.weekday !== target) continue;
      const ts = zonedToUtc(probe.year, probe.month, probe.day, hour, minute, tz);
      if (ts > after) return ts;
    }
    return null;
  }

  if (repeat.kind === "monthly") {
    const wanted = Math.min(Math.max(parseInt(repeat.dayOfMonth, 10) || base.day, 1), 31);
    for (let i = 0; i < 3; i++) {
      const monthIndex = base.month - 1 + i;
      const year = base.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      // يوم 31 في شهر من 30 يومًا يصبح آخر يوم في الشهر
      const day = Math.min(wanted, daysInMonth(year, month));
      const ts = zonedToUtc(year, month, day, hour, minute, tz);
      if (ts > after) return ts;
    }
    return null;
  }

  return null;
}

/** مفتاح يوم (YYYY-MM-DD) في منطقة زمنية. */
function dayKeyIn(ms = Date.now(), tz = "UTC") {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** مفتاح أسبوع ISO (YYYY-Www) بتوقيت UTC — يُستخدم لتجميع الإحصاءات الأسبوعية. */
function weekKey(ms = Date.now()) {
  const d = new Date(ms);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThursday) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** فترات التحليلات القياسية. */
const PERIODS = {
  today: { days: 1, label: "اليوم" },
  "7d": { days: 7, label: "7 أيام" },
  "30d": { days: 30, label: "30 يومًا" },
  "90d": { days: 90, label: "90 يومًا" },
  year: { days: 365, label: "سنة" }
};

/** مفاتيح الأيام لفترة تنتهي اليوم (الأقدم أولًا). */
function dayKeysForPeriod(period, now = Date.now()) {
  const days = PERIODS[period]?.days || 7;
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(new Date(now - i * DAY_MS).toISOString().slice(0, 10));
  return keys;
}

module.exports = {
  DAY_MS,
  PERIODS,
  isValidTimezone,
  zonedParts,
  zonedToUtc,
  parseDateTime,
  nextOccurrence,
  dayKeyIn,
  weekKey,
  dayKeysForPeriod,
  daysInMonth
};
