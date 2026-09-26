#!/usr/bin/env node
/**
 * أداة إدارة قاعدة البيانات من سطر الأوامر (بلا تشغيل البوت).
 *
 *   npm run migrate                 تطبيق الهجرات المعلّقة (الأساسية + الإضافات)
 *   npm run migrate -- status       حالة كل هجرة (مطبّقة / معلّقة / قابلة للتراجع)
 *   npm run migrate -- down [name]  التراجع عن آخر هجرة (أو هجرة محددة) إن كان لها قسم @down
 *   npm run migrate -- integrity    فحص سلامة القاعدة والمفاتيح الأجنبية
 *   npm run migrate -- stats        عدد الصفوف لكل جدول وحجم الملف
 *   npm run migrate -- backup [dir] نسخة احتياطية متسقة (VACUUM INTO / backup)
 *
 * المسار من DATABASE_PATH (أو ./data/bot.db). لا يحتاج توكن ديسكورد.
 */
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const DatabaseService = require("../src/core/database/Database");
const PluginManager = require("../src/core/plugins/PluginManager");

const logger = {
  info: (m) => console.log(`ℹ️  ${m}`),
  warn: (m) => console.warn(`⚠️  ${m}`),
  error: (m) => console.error(`❌ ${m}`),
  debug: () => {}
};

function pluginSources() {
  // مدير الإضافات يحتاج فقط هذه الواجهات لقراءة البيانات الوصفية
  const stub = { logger, config: { guildDefaults: {} }, i18n: { addDirectory() {}, load() {} } };
  const manager = new PluginManager(stub);
  manager.discover();
  return manager.migrationSources();
}

async function main() {
  const [command = "up", arg] = process.argv.slice(2);
  const dbPath = process.env.DATABASE_PATH || "./data/bot.db";
  const database = new DatabaseService(logger, dbPath);
  database.extraMigrationSources = pluginSources();

  if (command === "up") {
    database.connect({ migrate: false });
    const count = database.runMigrations(database.extraMigrationSources);
    console.log(count ? `✓ طُبّقت ${count} هجرة.` : "✓ لا توجد هجرات معلّقة.");
  } else if (command === "status") {
    database.connect({ migrate: false });
    const rows = database.migrationStatus();
    for (const m of rows) {
      console.log(`${m.appliedAt ? "✓" : "…"} ${m.reversible ? "↺" : " "} ${m.name}${m.appliedAt ? `  (${new Date(m.appliedAt).toISOString()})` : ""}`);
    }
    const pending = rows.filter((m) => !m.appliedAt).length;
    console.log(`\nالإجمالي: ${rows.length} • مطبّقة: ${rows.length - pending} • معلّقة: ${pending}`);
    if (pending) process.exitCode = 2;
  } else if (command === "down") {
    database.connect({ migrate: false });
    const res = database.rollback(arg || null);
    if (!res.ok) {
      console.error(res.reason === "irreversible" ? `✗ الهجرة ${res.name} بلا قسم @down — التراجع غير آمن.` : "✗ لم تُعثر على هجرة مطبّقة.");
      process.exitCode = 1;
    } else console.log(`✓ تم التراجع عن ${res.name}`);
  } else if (command === "integrity") {
    database.connect({ migrate: false });
    const res = database.integrityCheck();
    console.log(res.ok ? "✓ القاعدة سليمة." : `✗ مشاكل: ${JSON.stringify({ integrity: res.integrity, foreignKeys: res.foreignKeys })}`);
    if (!res.ok) process.exitCode = 1;
  } else if (command === "stats") {
    database.connect({ migrate: false });
    const s = database.stats();
    console.log(`${s.path} — ${Math.round(s.sizeBytes / 1024)} KB`);
    for (const [t, c] of Object.entries(s.tables).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(8)}  ${t}`);
  } else if (command === "backup") {
    database.connect({ migrate: false });
    const dir = arg || path.join(path.dirname(dbPath), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `bot-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    if (typeof database.db.backup === "function") await database.db.backup(target);
    else database.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    console.log(`✓ نسخة احتياطية: ${target}`);
  } else {
    console.error(`أمر غير معروف: ${command}\nالأوامر: up | status | down [name] | integrity | stats | backup [dir]`);
    process.exitCode = 1;
  }
  database.close();
}

main().catch((err) => {
  console.error(`❌ ${err.stack || err.message}`);
  process.exit(1);
});
