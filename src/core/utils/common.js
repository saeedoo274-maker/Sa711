// ============================================================
//  دوال نقية بلا أي اعتماد على discord.js
//  تُستخدم من كل الطبقات بما فيها طبقة قاعدة البيانات،
//  حتى تبقى الطبقات الدنيا مستقلة عن مكتبة ديسكورد.
// ============================================================

/** يحوّل نص مدة إلى ميلي ثانية. يدعم الصيغتين العربية والإنجليزية. */
function parseDuration(text) {
  if (!text) return null;
  const normalized = String(text).trim().toLowerCase();
  const regex = /(\d+)\s*(ثانية|ثواني|ث|s|sec|دقيقة|دقائق|د|m|min|ساعة|ساعات|س|h|hr|يوم|أيام|ي|d|day|أسبوع|w|week)?/g;
  let total = 0;
  let matched = false;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const value = parseInt(match[1], 10);
    if (isNaN(value)) continue;
    const unit = match[2] || "m";
    matched = true;
    if (["ثانية", "ثواني", "ث", "s", "sec"].includes(unit)) total += value * 1000;
    else if (["دقيقة", "دقائق", "د", "m", "min"].includes(unit)) total += value * 60_000;
    else if (["ساعة", "ساعات", "س", "h", "hr"].includes(unit)) total += value * 3_600_000;
    else if (["يوم", "أيام", "ي", "d", "day"].includes(unit)) total += value * 86_400_000;
    else if (["أسبوع", "w", "week"].includes(unit)) total += value * 604_800_000;
  }
  return matched && total > 0 ? total : null;
}

/** يعرض المدة بصيغة عربية مقروءة. */
function formatDuration(ms) {
  if (!ms || ms <= 0) return "—";
  const units = [
    { label: "يوم", value: 86_400_000 },
    { label: "ساعة", value: 3_600_000 },
    { label: "دقيقة", value: 60_000 },
    { label: "ثانية", value: 1000 }
  ];
  const parts = [];
  let remaining = ms;
  for (const unit of units) {
    const count = Math.floor(remaining / unit.value);
    if (count > 0) {
      parts.push(`${count} ${unit.label}`);
      remaining -= count * unit.value;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" و ") || "أقل من ثانية";
}

/**
 * يحوّل نص مبلغ مختصر (10k، 100m، 1b) إلى رقم صحيح.
 * يدعم اللاحقات الإنجليزية والعربية، وأرقامًا عادية بلا لاحقة.
 * يرجع null للمدخلات غير الصالحة بدل NaN، حتى يسهل التحقق من الفشل بشرط واحد.
 */
function parseAmount(text) {
  if (text === null || text === undefined) return null;
  const normalized = String(text).trim().toLowerCase().replace(/,/g, "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(k|m|b|ك|الف|ألف|مليون|مليار)?$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (isNaN(value) || value < 0) return null;

  const multipliers = {
    k: 1_000, ك: 1_000, الف: 1_000, ألف: 1_000,
    m: 1_000_000, مليون: 1_000_000,
    b: 1_000_000_000, مليار: 1_000_000_000
  };
  const multiplier = match[2] ? multipliers[match[2]] : 1;
  return Math.round(value * multiplier);
}

/** طابع زمني بصيغة ديسكورد. */
function timestamp(ms, style = "F") {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

/** يقص النص بأمان مع احترام حدود ديسكورد. */
function truncate(text, max = 1024) {
  const str = String(text ?? "");
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/** يستخرج آيدي من منشن أو رقم خام. */
function extractId(input) {
  if (!input) return null;
  const match = String(input).match(/\d{15,25}/);
  return match ? match[0] : null;
}

/** تاريخ اليوم بصيغة YYYY-MM-DD لتجميع الإحصائيات. */
function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

module.exports = { parseDuration, formatDuration, parseAmount, timestamp, truncate, chunk, extractId, dayKey };
