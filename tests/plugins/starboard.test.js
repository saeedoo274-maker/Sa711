const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("لوحات النجوم المتعددة والأصوات الفريدة", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const memes = H.fakeChannel(guild, "400000000000000010", { app });
  const legacyBoard = H.fakeChannel(guild, "400000000000000011", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const muted = H.fakeRole("880000000000000088");
  const author = H.fakeMember(guild, "700000000000000007");
  const voters = [1, 2, 3, 4].map((n) => H.fakeMember(guild, `70000000000000010${n}`));
  const ignoredVoter = H.fakeMember(guild, "700000000000000120", { roleIds: [muted.id] });

  const sb = async (sub, options = {}, member = admin) => {
    app.commands.cooldowns.clear();
    const i = H.fakeSlash(member, general, { command: "لوحة_نجوم", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const reactors = new Map();
  const react = async (message, emoji, member, added = true) => {
    const key = `${message.id}:${emoji}`;
    const set = reactors.get(key) || new Map();
    if (added) set.set(member.id, member.user);
    else set.delete(member.id);
    reactors.set(key, set);
    const reaction = { partial: false, emoji: { name: emoji, id: null }, count: set.size, message, users: { fetch: async () => new Map(set) } };
    await app.starboardService.sync(reaction, guild);
    await app.starboardPlus.onReaction(reaction, member.user, added);
  };

  await t.test("إنشاء لوحة إضافية: التحقق من الاسم والصلاحية والتكرار", async () => {
    let i = await sb("board", { action: "add", name: "memes", channel: memes, emoji: "😂", threshold: 2 }, voters[0]);
    assert.match(H.textOf(i.replies), /صلاحي/);
    i = await sb("board", { action: "add", name: "bad name", channel: memes });
    assert.match(H.textOf(i.replies), /غير صالح/);
    await sb("board", { action: "add", name: "memes", channel: memes, emoji: "😂", threshold: 2 });
    i = await sb("board", { action: "add", name: "memes", channel: memes });
    assert.match(H.textOf(i.replies), /يوجد لوحة/);
    assert.equal(app.starboardPlus.boards(guild.id).length, 1);
  });

  await t.test("الأصوات الفريدة: تنجيم النفس والبوت والرتبة المتجاهلة لا تُحتسب", async () => {
    await sb("ignore", { role: muted, board: "memes" });
    const msg = H.fakeMessage(author, general, "نكتة");
    msg.url = "https://discord.com/channels/x/y/z";
    await react(msg, "😂", author);
    await react(msg, "😂", ignoredVoter);
    await react(msg, "😂", voters[0]);
    assert.equal(memes.sent.length, 0, "صوت واحد صالح فقط");
    await react(msg, "😂", voters[1]);
    assert.equal(memes.sent.length, 1);
    assert.match(memes.sent[0].payload.content, /\*\*2\*\*/);
    await react(msg, "😂", voters[2]);
    assert.equal(memes.sent.length, 1, "تحديث لا نشر جديد");
    assert.match(memes.sent[0].payload.content, /\*\*3\*\*/);
    await react(msg, "😂", voters[1], false);
    await react(msg, "😂", voters[2], false);
    assert.equal(memes.sent[0].deleted, true, "نزل تحت الحد فحُذف");
    assert.equal(app.starboardPlusRepo.entry(app.starboardPlus.boards(guild.id)[0].id, msg.id), null);
  });

  await t.test("التفاعلات المتزامنة لا تنشر مرتين", async () => {
    const msg = H.fakeMessage(author, general, "رسالة مشهورة");
    msg.url = "https://discord.com/x";
    const set = new Map(voters.map((v) => [v.id, v.user]));
    reactors.set(`${msg.id}:😂`, set);
    const reaction = { partial: false, emoji: { name: "😂", id: null }, count: set.size, message: msg, users: { fetch: async () => new Map(set) } };
    const before = memes.sent.length;
    await Promise.all(voters.map((v) => app.starboardPlus.onReaction(reaction, v.user, true)));
    assert.equal(memes.sent.length, before + 1);
  });

  await t.test("اللوحة الأصلية: تجاهل الرتب واستثناء قناة الثريد الأم ومرفقات", async () => {
    app.guildConfig.setMany(guild.id, { "starboard.enabled": true, "starboard.channelId": legacyBoard.id, "starboard.threshold": 2 });
    await sb("ignore", { role: muted });
    assert.deepEqual(app.guildConfig.value(guild.id, "starboard.ignoredRoles"), [muted.id]);
    const msg = H.fakeMessage(author, general, "صورة");
    msg.url = "https://discord.com/x";
    msg.attachments.set("a1", { name: "clip.mp4", url: "https://cdn/x.mp4", contentType: "video/mp4" });
    await react(msg, "⭐", ignoredVoter);
    await react(msg, "⭐", voters[0]);
    assert.equal(legacyBoard.sent.length, 0);
    await react(msg, "⭐", voters[1]);
    assert.equal(legacyBoard.sent.length, 1);
    assert.match(H.textOf([legacyBoard.sent[0].payload]), /clip\.mp4/);

    const thread = H.fakeChannel(guild, "400000000000000012", { app });
    thread.parentId = general.id;
    await sb("ignore", { channel: general });
    const inThread = H.fakeMessage(author, thread, "داخل ثريد");
    inThread.url = "https://discord.com/y";
    await react(inThread, "⭐", voters[0]);
    await react(inThread, "⭐", voters[1]);
    assert.equal(legacyBoard.sent.length, 1, "الثريد يتبع استثناء القناة الأم");
  });

  await t.test("متصدرو النجوم يجمعون اللوحة الأصلية والإضافية", async () => {
    const i = await sb("leaderboard");
    assert.match(H.textOf(i.replies), new RegExp(author.id));
    const rows = app.leaderboards.rows("stars", guild.id, {});
    assert.equal(rows[0].user_id, author.id);
    assert.ok(rows[0].score >= 6);
  });

  await t.test("تعديل وتعطيل وحذف اللوحة", async () => {
    await sb("board", { action: "edit", name: "memes", enabled: false });
    assert.equal(app.starboardPlus.boards(guild.id)[0].enabled, 0);
    const i = await sb("board", { action: "list" });
    assert.match(H.textOf(i.replies), /memes/);
    await sb("board", { action: "remove", name: "memes" });
    assert.equal(app.starboardPlus.boards(guild.id).length, 0);
  });
});
