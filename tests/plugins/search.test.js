const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("البحث الشامل", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const alice = H.fakeMember(guild, "700000000000000007");
  alice.displayName = "AhmedGamer";
  app.cases.create({ guildId: guild.id, type: "warn", targetId: alice.id, moderatorId: admin.id, reason: "إرسال روابط" });
  app.tickets.create({ guildId: guild.id, channelId: "450000000000000001", ownerId: alice.id, number: 7 });
  app.customCommands.create({ guildId: guild.id, name: "rules", content: "اقرأ القوانين", createdBy: admin.id });

  const find = async (options, member = admin) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    const i = H.fakeSlash(member, general, { command: "بحث", options });
    await app.commands.handleInteraction(i);
    return H.textOf(i.replies);
  };

  await t.test("البحث بعضو يجمع القضايا والتذاكر", async () => {
    const text = await find({ user: alice.user });
    assert.match(text, /إرسال روابط/);
    assert.match(text, /#0007/);
    assert.match(text, /AhmedGamer/);
  });

  await t.test("البحث بالنص والرقم والنطاق", async () => {
    assert.match(await find({ query: "ahmed", scope: "members" }), /AhmedGamer/);
    assert.match(await find({ query: "القوانين", scope: "commands" }), /rules/);
    assert.match(await find({ query: "#1", scope: "cases" }), /warn/);
    assert.match(await find({ query: "لا يوجد شيء كهذا" }), /لا توجد نتائج/);
    assert.match(await find({ query: "%_%" }), /لا توجد نتائج/);
  });

  await t.test("يتطلب مدخلًا وصلاحية طاقم، ويعمل بالبريفكس", async () => {
    assert.match(await find({}), /اكتب نصًا/);
    assert.match(await find({ query: "x" }, alice), /صلاحي/);
    app.commands.cooldowns.clear();
    const msg = H.fakeMessage(admin, general, `${app.guildConfig.value(guild.id, "prefix")}find ${alice.id}`);
    await app.commands.handleMessage(msg);
    assert.match(H.textOf(msg.replies.concat(general.sent.map((m) => m.payload))), /إرسال روابط/);
  });
});
