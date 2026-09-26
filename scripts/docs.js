#!/usr/bin/env node
/**
 * يولّد docs/COMMANDS.md من سجل الأوامر الفعلي (لا يُكتب يدويًا فلا يتقادم):
 *   npm run docs
 * يعرض لكل أمر: الأسماء البديلة، الوصف، المستوى المطلوب، النظام/الإضافة، والأوامر الفرعية.
 */
const fs = require("node:fs");
const path = require("node:path");
const CommandRegistry = require("../src/core/commands/CommandRegistry");
const PluginManager = require("../src/core/plugins/PluginManager");

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const LEVELS = ["الجميع", "الطاقم", "مشرف", "أدمن", "مالك السيرفر", "المطور"];

const plugins = new PluginManager({ logger: quiet, config: { guildDefaults: {} }, i18n: { addDirectory() {}, load() {} } });
plugins.discover();
const registry = new CommandRegistry(quiet);
registry.setExtraSources(() => plugins.commandSources());
registry.load();

function subs(json) {
  const out = [];
  for (const o of json.options || []) {
    if (o.type === 1) out.push(`\`${o.name}\` — ${o.description}`);
    if (o.type === 2) for (const s of o.options || []) out.push(`\`${o.name} ${s.name}\` — ${s.description}`);
  }
  return out;
}

const byCategory = new Map();
for (const c of registry.all()) {
  const key = c.plugin ? `إضافة: ${c.plugin}` : c.category || c.module || "عام";
  if (!byCategory.has(key)) byCategory.set(key, []);
  byCategory.get(key).push(c);
}

const lines = [
  "# مرجع الأوامر",
  "",
  "> مولَّد تلقائيًا بـ `npm run docs` من سجل الأوامر — لا تعدّله يدويًا.",
  "",
  `الإجمالي: **${registry.all().length}** أمر • أوامر سلاش: **${registry.all().filter((c) => c.slash && [undefined, 1].includes(c.slash.toJSON().type)).length}/100**`,
  "",
  "كل الأوامر تعمل بالسلاش، ومعظمها بالبريفكس أيضًا (عدا المعلَّمة \"سلاش فقط\"). الصلاحية تُفحص في الخادم دائمًا، وقد تعدّلها قواعد `/اعداد permissions`.",
  ""
];
for (const [category, cmds] of [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`## ${category}`, "");
  for (const c of cmds.sort((a, b) => a.name.localeCompare(b.name))) {
    const level = c.permissions?.developerOnly ? LEVELS[5] : LEVELS[c.permissions?.level ?? 0];
    lines.push(`### \`${c.name}\`${c.aliases?.length ? ` — ${c.aliases.map((a) => `\`${a}\``).join(" ")}` : ""}`);
    lines.push("", `${c.description || ""}`, "", `- الصلاحية: **${level}**${c.slashOnly ? " • سلاش فقط" : ""}${c.cooldown ? ` • تبريد ${Math.round(c.cooldown / 1000)}ث` : ""}`);
    if (c.usage) lines.push(`- الاستخدام: \`${c.usage}\``);
    const s = c.slash ? subs(c.slash.toJSON()) : [];
    if (s.length) lines.push("- الأوامر الفرعية:", ...s.map((x) => `  - ${x}`));
    lines.push("");
  }
}
fs.mkdirSync(path.join(__dirname, "..", "docs"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "..", "docs", "COMMANDS.md"), `${lines.join("\n")}\n`);
console.log(`✓ docs/COMMANDS.md (${registry.all().length} أمر)`);
