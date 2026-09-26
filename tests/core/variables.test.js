const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");
const variables = require("../../src/core/utils/variables");

test("المتغيرات: الإحصاءات تُملأ في كل الأنظمة عبر EmbedService", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const alice = H.fakeMember(guild, "700000000000000007");
  app.features.setForGuild(guild.id, "levels", true);
  app.levels.setXp(guild.id, alice.id, 5000, admin.id);
  app.economyService.account(guild.id, alice.id);
  app.economy.adjustWallet({ guildId: guild.id, userId: alice.id, delta: 250, type: "test" });
  app.cases.create({ guildId: guild.id, type: "warn", targetId: alice.id, moderatorId: admin.id });

  await t.test("الإحصاءات في replaceVariables (أوامر مخصصة، أتمتة، إعلانات...)", () => {
    const out = app.embedService.replaceVariables("{user} L{LEVEL} XP{xp} 💰{BALANCE} ⚠️{WARNINGS} 🏆{ACHIEVEMENTS} 📨{INVITES}", { member: alice, guild });
    assert.match(out, new RegExp(`<@${alice.id}> L\\d+ XP5000 💰\\d+ ⚠️1 🏆\\d+ 📨0`));
    assert.ok(Number(out.match(/L(\d+)/)[1]) > 0);
    assert.match(out, /💰(\d+)/);
    assert.ok(Number(out.match(/💰(\d+)/)[1]) >= 250);
  });

  await t.test("بلا متغيرات إحصاءات لا تُنفَّذ استعلامات إضافية، والمجهول يبقى كما هو", () => {
    let queries = 0;
    const orig = app.cases.countByTarget.bind(app.cases);
    app.cases.countByTarget = (...a) => { queries++; return orig(...a); };
    assert.equal(app.embedService.replaceVariables("مرحبا {username} {UNKNOWN}", { member: alice, guild }), `مرحبا ${alice.user.username} {UNKNOWN}`);
    assert.equal(queries, 0);
    app.cases.countByTarget = orig;
    assert.ok(variables.VARIABLE_NAMES.includes("WARNINGS"));
  });

  await t.test("/امر_مخصص variables: القائمة والمعاينة الحية", async () => {
    app.commands.cooldowns.clear();
    let i = H.fakeSlash(admin, general, { command: "امر_مخصص", sub: "variables" });
    await app.commands.handleInteraction(i);
    assert.match(H.textOf(i.replies), /\{REPUTATION\}/);
    app.commands.cooldowns.clear();
    i = H.fakeSlash(admin, general, { command: "امر_مخصص", sub: "variables", options: { text: "أنا {username} في {server}" } });
    await app.commands.handleInteraction(i);
    assert.match(H.textOf(i.replies), /Test Server/);
  });
});
