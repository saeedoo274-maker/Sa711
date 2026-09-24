const test = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");
const H = require("../helpers/harness");

test("نظام الاقتراحات", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const cmdChannel = H.fakeChannel(guild, "400000000000000004", { app });
  const board = H.fakeChannel(guild, "400000000000000005", { app });
  const archive = H.fakeChannel(guild, "400000000000000006", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const author = H.fakeMember(guild, "700000000000000007");
  const voter = H.fakeMember(guild, "700000000000000008");
  const mod = H.fakeMember(guild, "700000000000000009", { permissions: [PermissionFlagsBits.ModerateMembers] });

  const slash = async (who, sub, options = {}) => {
    app.commands.cooldowns.clear();
    const i = H.fakeSlash(who, cmdChannel, { command: "اقتراح", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const click = async (who, customId, extra) => {
    const i = H.fakeComponent(who, board, customId, extra);
    await app.interactions.route(i);
    return i;
  };

  await t.test("بلا قناة: خطأ واضح", async () => {
    const i = await slash(author, "new", { content: "فكرة جميلة جدًا للسيرفر" });
    assert.match(H.textOf(i.replies), /غير مضبوط/);
  });

  await t.test("الإعداد ثم النشر برقم تسلسلي وأزرار", async () => {
    await slash(admin, "settings", { channel: board, archive, cooldown: 5 });
    const i = await slash(author, "new", { content: "إضافة قناة للألعاب الجماعية" });
    assert.match(H.textOf(i.replies), /#1/);
    const s = app.suggestionsRepo.byNumber(guild.id, 1);
    assert.equal(s.channel_id, board.id);
    assert.equal(board.sent.length, 1);
    assert.match(JSON.stringify(board.sent[0].payload.components[0].toJSON()), /sug:v:1:u/);
  });

  await t.test("التبريد يمنع الاقتراح التالي، والطاقم معفي", async () => {
    const i = await slash(author, "new", { content: "اقتراح ثاني بعد قليل" });
    assert.match(H.textOf(i.replies), /انتظر/);
    const j = await slash(mod, "new", { content: "اقتراح من المشرف مباشرة", anonymous: true });
    assert.match(H.textOf(j.replies), /#2/);
    assert.equal(app.suggestionsRepo.byNumber(guild.id, 2).anonymous, 1);
    assert.match(H.textOf([board.sent[1].payload]), /مجهول/);
  });

  await t.test("التصويت: إضافة، سحب، تغيير، ومنع التكرار المتزامن", async () => {
    await click(voter, "sug:v:1:u");
    await click(author, "sug:v:1:u");
    let s = app.suggestionsRepo.get(1);
    assert.deepEqual([s.upvotes, s.downvotes], [2, 0]);
    await click(voter, "sug:v:1:u");
    s = app.suggestionsRepo.get(1);
    assert.equal(s.upvotes, 1, "الضغط الثاني يسحب");
    await click(author, "sug:v:1:d");
    s = app.suggestionsRepo.get(1);
    assert.deepEqual([s.upvotes, s.downvotes], [0, 1], "التغيير");
    await Promise.all([click(voter, "sug:v:1:u"), click(voter, "sug:v:1:u"), click(voter, "sug:v:1:u")]);
    s = app.suggestionsRepo.get(1);
    assert.ok(s.upvotes <= 1, "لا أكثر من صوت واحد للعضو");
  });

  await t.test("تحديث الرسالة مدموج (تعديل واحد لعدة أصوات)", async () => {
    await app.suggestions.refresh(1);
    const msg = board.sent[0];
    assert.ok(msg.edits.length >= 1);
    assert.match(H.textOf([msg.payload]), /%/);
  });

  await t.test("رتبة التصويت مطلوبة عند ضبطها", async () => {
    app.guildConfig.set(guild.id, "suggestions.voteRoleIds", ["999999999999999999"]);
    const i = await click(H.fakeMember(guild, "700000000000000010"), "sug:v:1:u");
    assert.match(H.textOf(i.replies), /الرتبة المطلوبة/);
    app.guildConfig.set(guild.id, "suggestions.voteRoleIds", []);
  });

  await t.test("زر الإدارة للطاقم فقط، والقرار عبر النموذج يؤرشف ويبلغ صاحبه", async () => {
    const denied = await click(voter, "sug:m:1");
    assert.match(H.textOf(denied.replies), /للطاقم/);

    const panel = await click(mod, "sug:m:1");
    const accept = panel.replies[0].components[0].toJSON().components[0].custom_id;
    const modalOpen = await click(mod, accept);
    assert.ok(modalOpen.modal);
    const submit = await click(mod, modalOpen.modal.data.custom_id, { kind: "modal", fields: { reason: "سيُنفّذ الأسبوع القادم" } });
    assert.match(H.textOf(submit.replies), /مقبول/);

    const s = app.suggestionsRepo.get(1);
    assert.equal(s.status, "accepted");
    assert.equal(s.archived, 1);
    assert.equal(s.channel_id, archive.id);
    assert.equal(board.sent[0].deleted, true, "حُذفت من القناة الأصلية");
    assert.ok(app.__sent.some((d) => d.to === author.id && /مقبول/.test(d.payload.content)), "إشعار خاص لصاحب الاقتراح");
    const late = await click(voter, "sug:v:1:u");
    assert.match(H.textOf(late.replies), /مغلق/);
  });

  await t.test("القرار مرتين بنفس الحالة مرفوض، والسجل محفوظ", async () => {
    const res = await app.suggestions.decide(guild, 1, "accepted", mod, null);
    assert.equal(res.reason, "same");
    assert.deepEqual(app.suggestionsRepo.history(1).map((h) => h.status), ["pending", "accepted"]);
  });

  await t.test("الإحصاءات والأفضل", async () => {
    const i = await slash(author, "stats");
    assert.match(H.textOf(i.replies), /100%/);
    const top = await slash(author, "top");
    assert.match(H.textOf(top.replies), /#1/);
  });

  await t.test("متطلبات القناة والرتبة للإنشاء", async () => {
    app.guildConfig.setMany(guild.id, { "suggestions.allowedChannelIds": ["400000000000000099"], "suggestions.cooldownMs": 0 });
    const i = await slash(voter, "new", { content: "من قناة غير مسموحة" });
    assert.match(H.textOf(i.replies), /استخدم الأمر في/);
    app.guildConfig.setMany(guild.id, { "suggestions.allowedChannelIds": [], "suggestions.requiredRoleIds": ["888888888888888888"] });
    const j = await slash(voter, "new", { content: "بدون الرتبة المطلوبة" });
    assert.match(H.textOf(j.replies), /تحتاج إحدى الرتب/);
    app.guildConfig.set(guild.id, "suggestions.requiredRoleIds", []);
  });

  await t.test("قائمة الخدمات القديمة تمر عبر النظام الجديد", async () => {
    const i = H.fakeComponent(voter, cmdChannel, "services:suggestion", { kind: "modal", fields: { text: "اقتراح عبر قائمة الخدمات" } });
    await app.interactions.route(i);
    assert.match(H.textOf(i.replies), /تم نشر اقتراحك #3/);
  });

  await t.test("الحذف عبر الأمر", async () => {
    const i = await slash(mod, "delete", { number: 3 });
    assert.match(H.textOf(i.replies), /حذف/);
    assert.equal(app.suggestionsRepo.byNumber(guild.id, 3), null);
  });
});
