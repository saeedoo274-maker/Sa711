const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("معالج الإعداد", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const logs = H.fakeChannel(guild, "400000000000000016", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const other = H.fakeMember(guild, "300000000000000005", { admin: true });
  const alice = H.fakeMember(guild, "700000000000000007");
  app.guildConfig.set(guild.id, "logs.messages", general.id);

  const start = async (member = admin) => {
    app.commands.cooldowns.clear();
    const i = H.fakeSlash(member, general, { command: "اعداد", sub: "setup" });
    await app.commands.handleInteraction(i);
    return i;
  };
  const sidOf = (payload) => payload.components.at(-1).toJSON().components.find((c) => c.custom_id).custom_id.split(":")[1];
  const click = async (member, sid, action, values = []) => {
    const i = H.fakeComponent(member, general, `setup:${sid}:${action}`, { values, kind: values.length ? "select" : "button" });
    await app.interactions.route(i);
    return i;
  };

  await t.test("غير الأدمن لا يفتح المعالج", async () => {
    assert.match(H.textOf((await start(alice)).replies), /صلاحي/);
  });

  await t.test("الخطوات ثم المعاينة لا تحفظ، والتطبيق يحفظ دفعة واحدة", async () => {
    const i = await start();
    const sid = sidOf(i.replies.at(-1));
    await click(admin, sid, "lang", ["en"]);
    await click(admin, sid, "next");
    await click(admin, sid, "log", [logs.id]);
    await click(admin, sid, "next");
    await click(admin, sid, "wel", [general.id]);
    await click(admin, sid, "next");
    await click(admin, sid, "next");
    await click(admin, sid, "next");
    const features = app.setupWizard.get(sid).draft.features.filter((f) => f !== "games");
    await click(admin, sid, "feat", features);
    const preview = await click(admin, sid, "next");
    const text = H.textOf(preview.replies);
    assert.match(text, /معاينة|Preview/);
    assert.equal(app.guildConfig.value(guild.id, "language"), "ar", "لم يُحفظ شيء قبل التطبيق");
    assert.match(text, new RegExp(logs.id));

    const stranger = await click(other, sid, "apply");
    assert.match(H.textOf(stranger.replies), /ليست لك|not yours|لك/i);
    assert.equal(app.guildConfig.value(guild.id, "language"), "ar");

    await click(admin, sid, "apply");
    assert.equal(app.guildConfig.value(guild.id, "language"), "en");
    assert.equal(app.guildConfig.value(guild.id, "welcome.channelId"), general.id);
    assert.equal(app.guildConfig.value(guild.id, "logs.messages"), general.id, "القنوات المحددة مسبقًا لا تُستبدل");
    assert.equal(app.guildConfig.value(guild.id, "logs.members"), logs.id);
    assert.equal(app.features.isEnabled(guild.id, "games"), false);
    const expired = await click(admin, sid, "next");
    assert.match(H.textOf(expired.replies), /انتهت|expired/i, "الجلسة انتهت بعد التطبيق");
  });

  await t.test("الإلغاء لا يحفظ", async () => {
    const i = await start();
    const sid = sidOf(i.replies.at(-1));
    await click(admin, sid, "lang", ["fr"]);
    await click(admin, sid, "cancel");
    assert.equal(app.guildConfig.value(guild.id, "language"), "en");
    assert.equal(app.setupWizard.get(sid), null);
  });
});
