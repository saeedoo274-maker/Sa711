const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("التواصل الاجتماعي المتقدم", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const alice = H.fakeMember(guild, "700000000000000007");
  const bob = H.fakeMember(guild, "700000000000000008");
  const carl = H.fakeMember(guild, "700000000000000009");
  app.social.createProfile({ guildId: guild.id, userId: alice.id, handle: "alice", displayName: "Alice" });
  app.social.createProfile({ guildId: guild.id, userId: bob.id, handle: "bob", displayName: "Bob" });

  const run = async (member, sub, options = {}) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(member, general, { command: "تغريدة", sub, options });
    await app.commands.handleInteraction(i);
    return H.textOf(i.replies);
  };

  await t.test("السمعة: لا لنفسك، تبريد لنفس العضو، حد يومي، ولوحة المتصدرين والمتغير", async () => {
    assert.match(await run(alice, "rep", { user: alice.user }), /نفسك/);
    assert.match(await run(alice, "rep", { user: bob.user, reason: "مساعد" }), /المجموع 1/);
    assert.match(await run(alice, "rep", { user: bob.user }), /مجددًا بعد/);
    app.guildConfig.set(guild.id, "socialPlus.repDailyLimit", 2);
    await run(alice, "rep", { user: carl.user });
    const extra = H.fakeMember(guild, "700000000000000010");
    assert.match(await run(alice, "rep", { user: extra.user }), /للحد اليومي/);
    assert.equal(app.leaderboards.rows("reputation", guild.id, {})[0].user_id, bob.id);
    assert.equal(app.socialPlus.reputation(guild.id, bob.id), 1);
  });

  await t.test("المتابعة والصداقة بطلب وقبول (زر الخاص)", async () => {
    assert.match(await run(alice, "follow", { user: bob.user }), /تتابع/);
    assert.match(await run(alice, "follow", { user: bob.user }), /ألغيت/);
    await run(alice, "follow", { user: bob.user });
    assert.match(await run(alice, "friend", { action: "add", user: bob.user }), /تم إرسال/);
    assert.match(await run(alice, "friend", { action: "add", user: bob.user }), /معلّق/);
    const click = H.fakeComponent(bob, general, `soc:faccept:${guild.id}:${alice.id}`);
    click.guild = null;
    click.member = null;
    await app.interactions.route(click);
    assert.match(H.textOf(click.replies), /صديقًا/);
    assert.deepEqual(app.socialPlusRepo.friends(guild.id, bob.id), [alice.id]);
    assert.match(await run(bob, "friend", { action: "list" }), new RegExp(alice.id));
  });

  await t.test("طلب معاكس يقبل مباشرة، والرفض", async () => {
    await run(carl, "friend", { action: "add", user: bob.user });
    assert.match(await run(bob, "friend", { action: "add", user: carl.user }), /صديقًا/);
    const dave = H.fakeMember(guild, "700000000000000011");
    await run(dave, "friend", { action: "add", user: bob.user });
    assert.match(await run(bob, "friend", { action: "decline", user: dave.user }), /رفض/);
    assert.equal(app.socialPlusRepo.friendship(guild.id, bob.id, dave.id), null);
  });

  await t.test("التعليقات والخصوصية", async () => {
    assert.match(await run(carl, "comment", { user: alice.user, text: "ملف رائع" }), /#\d+/);
    await run(alice, "privacy", { visibility: "friends", comments: true });
    assert.match(await run(carl, "comment", { user: alice.user, text: "مرة أخرى" }), /خصوصية/);
    assert.match(await run(bob, "comment", { user: alice.user, text: "صديقك هنا" }), /#\d+/);
    assert.match(await run(carl, "profile", { user: alice.user }), /خاص/);
    const profile = await run(bob, "profile", { user: alice.user });
    assert.match(profile, /صديقك هنا/);
    assert.match(profile, /السمعة/);
    const c = app.socialPlusRepo.comments(guild.id, alice.id, 1)[0];
    assert.match(await run(carl, "comment", { delete: c.id }), /صلاحية/);
    assert.match(await run(alice, "comment", { delete: c.id }), /حذف/);
  });

  await t.test("الحظر يلغي العلاقات ويمنع التفاعل، والكتم يخفي المنشورات", async () => {
    assert.match(await run(bob, "block", { user: alice.user }), /حظر/);
    assert.equal(app.socialPlusRepo.friendship(guild.id, alice.id, bob.id), null);
    assert.equal(app.socialPlusRepo.followCounts(guild.id, bob.id).followers, 0);
    assert.match(await run(alice, "rep", { user: bob.user }), /حظر/);
    assert.match(await run(alice, "follow", { user: bob.user }), /حظر/);
    assert.match(await run(alice, "profile", { user: bob.user }), /خاص/);
    await run(bob, "block", { user: alice.user });
    app.social.createPost({ guildId: guild.id, authorId: carl.id, content: "منشور كارل" });
    assert.match(await run(bob, "feed"), /منشور كارل/);
    await run(bob, "block", { user: carl.user, mute: true });
    assert.doesNotMatch(await run(bob, "feed"), /منشور كارل/);
  });
});
