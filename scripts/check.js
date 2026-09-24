#!/usr/bin/env node
/**
 * فحص البناء الشامل — بديل "Build" لمشروع JavaScript بلا خطوة ترجمة.
 *
 *  1. صياغة كل ملفات JS (node --check)
 *  2. صحة كل ملفات JSON (الإعدادات، الترجمات، بيانات الإضافات)
 *  3. تحميل كل الأوامر وبناء حمولات السلاش والتحقق من حدود ديسكورد
 *     (100 أمر كحد أقصى، 25 خيارًا، الأسماء، الأوصاف، 4000 حرف لكل أمر)
 *  4. عدم وجود أسرار مكتوبة في الكود
 *
 * يخرج برمز 1 عند أي فشل، فيصلح للاستخدام في CI.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const errors = [];
const warnings = [];

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// ---- 1) الصياغة ----
const jsFiles = [path.join(ROOT, "index.js"), ...walk(path.join(ROOT, "src"), ".js"), ...walk(path.join(ROOT, "tests"), ".js"), ...walk(path.join(ROOT, "scripts"), ".js")];
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    errors.push(`صياغة: ${path.relative(ROOT, file)}\n${String(error.stderr).split("\n").slice(0, 4).join("\n")}`);
  }
}

// ---- 2) JSON ----
const jsonFiles = [
  path.join(ROOT, "package.json"),
  ...walk(path.join(ROOT, "config"), ".json"),
  ...walk(path.join(ROOT, "locales"), ".json"),
  ...walk(path.join(ROOT, "src"), ".json")
];
for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`JSON: ${path.relative(ROOT, file)} — ${error.message}`);
  }
}

// ---- 3) أوامر السلاش ----
const NAME_RE = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
function chars(o) {
  let n = (o.name || "").length + (o.description || "").length;
  for (const c of o.choices || []) n += String(c.name).length + String(c.value).length;
  for (const s of o.options || []) n += chars(s);
  return n;
}
function validateOption(o, where, depth) {
  const isCmd = depth === 0;
  if (!isCmd || (o.type || 1) === 1) {
    if (!NAME_RE.test(o.name) || o.name !== o.name.toLowerCase()) errors.push(`اسم غير صالح: ${where}`);
  }
  if (!isCmd || (o.type || 1) === 1) {
    if (!o.description || o.description.length > 100) errors.push(`وصف غير صالح (1-100): ${where}`);
  }
  const opts = o.options || [];
  if (opts.length > 25) errors.push(`أكثر من 25 خيارًا: ${where}`);
  if ((o.choices || []).length > 25) errors.push(`أكثر من 25 اختيارًا: ${where}`);
  const names = new Set();
  let seenOptional = false;
  for (const s of opts) {
    if (names.has(s.name)) errors.push(`خيار مكرر: ${where}/${s.name}`);
    names.add(s.name);
    if (s.type !== 1 && s.type !== 2) {
      if (!s.required) seenOptional = true;
      else if (seenOptional) errors.push(`خيار إلزامي بعد اختياري: ${where}/${s.name}`);
    }
    validateOption(s, `${where}/${s.name}`, depth + 1);
  }
}

process.env.LOG_LEVEL = "error";
const Logger = require(path.join(ROOT, "src/core/logger/Logger"));
const CommandRegistry = require(path.join(ROOT, "src/core/commands/CommandRegistry"));
const PluginManager = require(path.join(ROOT, "src/core/plugins/PluginManager"));
const I18n = require(path.join(ROOT, "src/core/i18n/I18n"));

const logger = new Logger("error");
const fakeApp = { logger, config: { guildDefaults: {} }, i18n: new I18n("ar") };
const plugins = new PluginManager(fakeApp);
plugins.discover();
for (const p of plugins.list()) if (p.status === "invalid") errors.push(`إضافة غير صالحة: ${p.name} — ${p.error}`);

const registry = new CommandRegistry(logger);
registry.setExtraSources(() => plugins.commandSources());
const originalError = logger.error.bind(logger);
logger.error = (m) => { errors.push(`تحميل الأوامر: ${m}`); originalError(m); };
logger.warn = (m) => warnings.push(m);
registry.load();

let body = [];
try {
  body = registry.slashData();
} catch (error) {
  errors.push(`بناء السلاش فشل: ${error.message}`);
}
const chatInput = body.filter((c) => (c.type || 1) === 1);
const userMenus = body.filter((c) => c.type === 2);
const messageMenus = body.filter((c) => c.type === 3);
if (chatInput.length > 100) errors.push(`عدد أوامر السلاش ${chatInput.length} يتجاوز حد ديسكورد (100)`);
if (userMenus.length > 15 || messageMenus.length > 15) errors.push("قوائم السياق تتجاوز 15");
const seen = new Set();
for (const c of body) {
  const key = `${c.type || 1}:${c.name}`;
  if (seen.has(key)) errors.push(`أمر مكرر: ${c.name}`);
  seen.add(key);
  validateOption(c, c.name, 0);
  const n = chars(c);
  if (n > 4000) errors.push(`الأمر ${c.name} يتجاوز 4000 حرف (${n})`);
}
const aliasOwners = new Map();
const sizes = [];
for (const cmd of registry.all()) {
  if (typeof cmd.execute !== "function") errors.push(`أمر بلا منفّذ: ${cmd.name}`);
  // اختصار بريفكس مكرر بين أمرين يجعل أحدهما يبتلع الآخر بصمت
  for (const name of [cmd.name, ...(cmd.aliases || [])].map((a) => String(a).toLowerCase())) {
    if (aliasOwners.has(name) && aliasOwners.get(name) !== cmd.name) errors.push(`اسم/اختصار مكرر "${name}" بين ${aliasOwners.get(name)} و ${cmd.name}`);
    aliasOwners.set(name, cmd.name);
  }
  if (cmd.slash) sizes.push([cmd.name, chars(typeof cmd.slash.toJSON === "function" ? cmd.slash.toJSON() : cmd.slash)]);
}
if (process.argv.includes("--sizes")) {
  for (const [name, n] of sizes.sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${name}: ${n}/4000`);
}

// ---- 3ب) مفاتيح الترجمة المستخدمة موجودة بالعربية ----
{
  const i18n = new I18n("ar");
  for (const name of plugins.order) {
    const dir = path.join(plugins.get(name).dir, "locales");
    if (fs.existsSync(dir)) i18n.addDirectory(dir);
  }
  i18n.load();
  const KEY_RE = /(?:\bt|\.t|\.tr|\.tg|\.fail|forGuild\([^)]*\))\(\s*(?:[\w.]+\s*,\s*)?["']([a-zA-Z][\w]*(?:\.[\w]+)+)["']/g;
  const missing = new Set();
  for (const file of walk(path.join(ROOT, "src"), ".js")) {
    const code = fs.readFileSync(file, "utf8");
    for (const m of code.matchAll(KEY_RE)) {
      const key = m[1];
      if (i18n.t(key) === key) missing.add(`${key} (${path.relative(ROOT, file)})`);
    }
  }
  for (const k of missing) errors.push(`مفتاح ترجمة مفقود: ${k}`);
}

// ---- 4) الأسرار ----
const SECRET_RE = /(BOT_TOKEN|CLIENT_SECRET|SESSION_SECRET|API_KEY)\s*[=:]\s*['"][A-Za-z0-9_.-]{20,}['"]|[MN][A-Za-z\d]{23,25}\.[\w-]{6}\.[\w-]{27,}/;
for (const file of [...walk(path.join(ROOT, "src"), ".js"), ...walk(path.join(ROOT, "config"), ".json")]) {
  if (SECRET_RE.test(fs.readFileSync(file, "utf8"))) errors.push(`سر مكتوب في الكود: ${path.relative(ROOT, file)}`);
}

// ---- النتيجة ----
console.log(`ملفات JS: ${jsFiles.length} | JSON: ${jsonFiles.length} | أوامر: ${registry.commands.size} | سلاش: ${chatInput.length}/100 | قوائم سياق: ${userMenus.length + messageMenus.length} | إضافات: ${plugins.order.length}`);
for (const w of warnings) console.log(`تحذير: ${w}`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} خطأ:`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log("✓ كل الفحوصات نجحت");
