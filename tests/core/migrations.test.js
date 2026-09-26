const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const DatabaseService = require("../../src/core/database/Database");
const PluginManager = require("../../src/core/plugins/PluginManager");

const logger = { info() {}, warn() {}, error() {}, debug() {} };

function pluginSources() {
  const manager = new PluginManager({ logger, config: { guildDefaults: {} }, i18n: { addDirectory() {}, load() {} } });
  manager.discover();
  return manager.migrationSources();
}

test("الهجرات: كل هجرة قابلة للتراجع تنزل وتصعد من جديد دون خطأ، والقاعدة تبقى سليمة", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  const db = new DatabaseService(logger, path.join(dir, "t.db"));
  db.extraMigrationSources = pluginSources();
  db.connect();
  const all = db.migrationStatus();
  assert.ok(all.every((m) => m.appliedAt), "كل الهجرات مطبّقة");
  const reversible = all.filter((m) => m.reversible).map((m) => m.name);
  assert.ok(reversible.length >= 20, `هجرات قابلة للتراجع: ${reversible.length}`);

  // تراجع بترتيب عكسي عن كل الهجرات القابلة للتراجع (الإضافات أولًا ثم الأساسية الجديدة)
  for (const name of [...reversible].reverse()) {
    const res = db.rollback(name);
    assert.equal(res.ok, true, `rollback ${name}`);
  }
  assert.equal(db.migrationStatus().filter((m) => m.appliedAt).length, all.length - reversible.length);
  assert.equal(db.runMigrations(db.extraMigrationSources), reversible.length);
  assert.equal(db.integrityCheck().ok, true);

  // الهجرة القديمة بلا @down ترفض التراجع بوضوح
  const legacy = all.find((m) => !m.reversible);
  assert.equal(db.rollback(legacy.name).reason, "irreversible");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("أداة migrate من سطر الأوامر", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migcli-"));
  const env = { ...process.env, DATABASE_PATH: path.join(dir, "cli.db") };
  const run = (...args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, ["scripts/migrate.js", ...args], { env, encoding: "utf8" }) };
    } catch (error) {
      return { code: error.status, out: String(error.stdout) + String(error.stderr) };
    }
  };
  assert.equal(run("status").code, 2, "هجرات معلّقة ⇒ رمز خروج 2");
  assert.match(run("up").out, /طُبّقت/);
  assert.equal(run("status").code, 0);
  assert.match(run("integrity").out, /سليمة/);
  assert.match(run("down").out, /تم التراجع/);
  assert.match(run("up").out, /طُبّقت 1/);
  assert.match(run("stats").out, /KB/);
  assert.match(run("backup", path.join(dir, "b")).out, /نسخة احتياطية/);
  assert.equal(fs.readdirSync(path.join(dir, "b")).length, 1);
  assert.equal(run("nope").code, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
