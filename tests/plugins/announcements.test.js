const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("الإعلانات: معاينة وتأكيد، منشن، جدولة وتكرار، خاص عبر الطابور، قوالب", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const general = H.fakeChannel(guild, "400000000000000004", { app });
  const news = H.fakeChannel(guild, "400000000000000009", { app });
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const members = H.fakeRole("892000000000000001");
  guild.roles.cache.set(members.id, members);
  const alice = H.fakeMember(guild, "700000000000000007", { roleIds: [members.id] });
  const bob = H.fakeMember(guild, "700000000000000008", { roleIds: [members.id] });
  members.members = new Map([[alice.id, alice], [bob.id, bob]]);
  app.guildConfig.set(guild.id, "announcements.dmDelayMs", 0);

  const ann = async (sub, options = {}, member = admin) => {
    app.commands.cooldowns.clear();
    app.abuseGuard.userWindow.clear();
    app.abuseGuard.guildWindow.clear();
    const i = H.fakeSlash(member, general, { command: "ادارة", group: "announcement", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const buttonsOf = (i) => i.replies.at(-1).components.at(-1).toJSON().components.map((c) => c.custom_id);
  const click = async (member, customId) => {
    const c = H.fakeComponent(member, general, customId);
    await app.interactions.route(c);
    return c;
  };

  await t.test("المعاينة لا ترسل شيئًا، والتأكيد يرسل مرة واحدة فقط", async () => {
    const i = await ann("send", { message: "صيانة الليلة {SERVER}", title: "تنبيه", channel: news, "button-label": "التفاصيل", "button-url": "https://example.com" });
    assert.equal(news.sent.length, 0);
    assert.match(H.textOf(i.replies), /معاينة/);
    const [confirm] = buttonsOf(i);
    const stranger = H.fakeMember(guild, "300000000000000005", { admin: true });
    let c = await click(stranger, confirm);
    assert.match(H.textOf(c.replies), /ليست لك/);
    await click(admin, confirm);
    assert.equal(news.sent.length, 1);
    const payload = news.sent[0].payload;
    assert.equal(payload.embeds[0].data.title, "تنبيه");
    assert.match(payload.embeds[0].data.description, /Test Server/);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    await click(admin, confirm);
    assert.equal(news.sent.length, 1, "الضغط الثاني لا يعيد الإرسال");
  });

  await t.test("التحقق: نص فارغ، صورة غير آمنة، منشن الجميع بدون صلاحية", async () => {
    let i = await ann("send", { channel: news });
    assert.match(H.textOf(i.replies), /اكتب نص/);
    i = await ann("send", { message: "x", image: "http://insecure/img.png" });
    assert.match(H.textOf(i.replies), /https/);
    const plain = H.fakeMember(guild, "300000000000000006", { admin: true });
    plain.permissions.has = (p) => p !== require("discord.js").PermissionFlagsBits.MentionEveryone;
    i = await ann("send", { message: "x", mention: "everyone" }, plain);
    assert.match(H.textOf(i.replies), /منشن الجميع/);
    i = await ann("send", { message: "للجميع", mention: "everyone", channel: news });
    await click(admin, buttonsOf(i)[0]);
    assert.match(news.sent.at(-1).payload.content, /^@everyone\nللجميع/);
    assert.deepEqual(news.sent.at(-1).payload.allowedMentions, { parse: ["everyone"] });
  });

  await t.test("الإلغاء من المعاينة", async () => {
    const i = await ann("send", { message: "لن يُرسل", channel: news });
    const before = news.sent.length;
    const [confirm, cancel] = buttonsOf(i);
    await click(admin, cancel);
    await click(admin, confirm);
    assert.equal(news.sent.length, before);
  });

  await t.test("جدولة متكررة: تُرسل في موعدها ثم تُعاد جدولتها، والإلغاء يوقفها", async () => {
    let i = await ann("schedule", { message: "تذكير يومي", channel: news, in: "10s" });
    assert.match(H.textOf(i.replies), /الوقت غير صالح/);
    i = await ann("schedule", { message: "تذكير", channel: news, at: "2020-01-01 10:00" });
    assert.match(H.textOf(i.replies), /الوقت غير صالح/);
    i = await ann("schedule", { message: "تذكير يومي", channel: news, in: "2h", repeat: "daily" });
    await click(admin, buttonsOf(i)[0]);
    const rec = app.announcementsRepo.list(guild.id, ["scheduled"])[0];
    assert.equal(rec.repeat.kind, "daily");
    const before = news.sent.length;
    await app.scheduler.tick(Date.now() + 3 * 3600_000);
    assert.equal(news.sent.length, before + 1);
    const after = app.announcementsRepo.get(rec.id);
    assert.equal(after.status, "scheduled");
    assert.equal(after.sent_count, 1);
    assert.ok(after.run_at >= rec.run_at + 23 * 3600_000, "الموعد التالي بعد يوم من الموعد السابق");
    i = await ann("list");
    assert.match(H.textOf(i.replies), new RegExp(`#${rec.id}`));
    await ann("cancel", { id: rec.id });
    assert.equal(app.announcementsRepo.get(rec.id).status, "cancelled");
    await app.scheduler.tick(Date.now() + 30 * 3600_000);
    assert.equal(news.sent.length, before + 1);
  });

  await t.test("الإرسال لخاص أعضاء رتبة عبر الطابور مع تقدّم", async () => {
    const i = await ann("send", { message: "رسالة خاصة للأعضاء", target: "dm", "dm-role": members });
    const c = await click(admin, buttonsOf(i)[0]);
    assert.match(H.textOf(c.replies), /مهمة/);
    await app.queue.pump("announce:dm");
    const job = app.queue.list({ queue: "announce:dm" })[0];
    assert.equal(job.status, "done");
    const result = typeof job.result === "string" ? JSON.parse(job.result) : job.result;
    assert.deepEqual(result, { sent: 2, failed: 0, total: 2 });
  });

  await t.test("القوالب: حفظ واستخدام وحذف", async () => {
    let i = await ann("template", { name: "Weekly", message: "ملخص الأسبوع", title: "📅 أسبوعي", color: "info" });
    assert.match(H.textOf(i.replies), /weekly/);
    i = await ann("send", { template: "weekly", channel: news });
    await click(admin, buttonsOf(i)[0]);
    assert.equal(news.sent.at(-1).payload.embeds[0].data.title, "📅 أسبوعي");
    await ann("template", { name: "weekly", delete: true });
    i = await ann("send", { template: "weekly", channel: news });
    assert.match(H.textOf(i.replies), /قالب غير موجود/);
  });

  await t.test("عضو عادي لا يصل لأوامر الإعلانات", async () => {
    const i = await ann("send", { message: "x" }, alice);
    assert.match(H.textOf(i.replies), /صلاحي/);
  });
});
