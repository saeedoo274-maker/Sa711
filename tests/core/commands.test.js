const test = require("node:test");
const assert = require("node:assert/strict");
const { SlashCommandBuilder } = require("discord.js");
const H = require("../helpers/harness");

test("تنفيذ الأوامر: التوجيه، الأعلام، الصيانة", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));

  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  const channel = H.fakeChannel(guild, "400000000000000004", { app });
  const member = H.fakeMember(guild, "700000000000000007");

  // أمر تجريبي بأوامر فرعية ومجموعة، يُسجَّل مباشرة في السجل
  const calls = [];
  const probe = {
    name: "تجربة",
    aliases: ["probe", "rank"],
    aliasRoutes: { rank: { sub: "rank" } },
    subAliases: { ترتيب: "top" },
    description: "أمر اختبار",
    module: "probe-module",
    cooldown: 0,
    slash: new SlashCommandBuilder().setName("تجربة").setDescription("x")
      .addSubcommand((s) => s.setName("rank").setDescription("x"))
      .addSubcommand((s) => s.setName("top").setDescription("x"))
      .addSubcommandGroup((g) => g.setName("admin").setDescription("x").addSubcommand((s) => s.setName("reset").setDescription("x"))),
    async execute(ctx) {
      calls.push({ group: ctx.subcommandGroup(), sub: ctx.subcommand(), args: ctx.args });
      return ctx.reply("ok");
    }
  };
  app.registry.commands.set(probe.name, probe);
  for (const a of probe.aliases) app.registry.aliases.set(a, probe.name);

  const run = async (content) => {
    const msg = H.fakeMessage(member, channel, content);
    await app.commands.handleMessage(msg);
    return msg;
  };

  await t.test("البريفكس: اسم أمر فرعي، اختصار عربي، مجموعة، ومسار اختصار", async () => {
    await run("!probe top 5");
    await run("!تجربة ترتيب");
    await run("!probe admin reset now");
    await run("!rank @x");
    assert.deepEqual(calls.map((c) => [c.group, c.sub, c.args.join(" ")]), [
      [null, "top", "5"],
      [null, "top", ""],
      ["admin", "reset", "now"],
      [null, "rank", "@x"]
    ]);
  });

  await t.test("البريفكس: أمر فرعي مجهول يعرض القائمة ولا ينفّذ", async () => {
    const before = calls.length;
    const msg = await run("!probe nothing");
    assert.equal(calls.length, before);
    assert.match(H.textOf(msg.replies), /rank/);
  });

  await t.test("علم الميزة يمنع الأمر في سيرفر واحد فقط", async () => {
    app.features.register("probe-module");
    app.features.setForGuild(guild.id, "probe-module", false);
    const before = calls.length;
    const msg = await run("!probe top");
    assert.equal(calls.length, before);
    assert.match(H.textOf(msg.replies), /probe-module/);
    app.features.setForGuild(guild.id, "probe-module", null);
  });

  await t.test("صيانة أمر محدد برسالة مخصصة", async () => {
    app.maintenanceService.set("command", "تجربة", { enabled: true, message: "قيد التحديث" });
    const before = calls.length;
    const msg = await run("!probe top");
    assert.equal(calls.length, before);
    assert.match(H.textOf(msg.replies), /قيد التحديث/);
    app.maintenanceService.set("command", "تجربة", { enabled: false });
    await run("!probe top");
    assert.equal(calls.length, before + 1);
  });

  await t.test("السلاش يقرأ الأمر الفرعي من التفاعل", async () => {
    const i = H.fakeSlash(member, channel, { command: "تجربة", sub: "reset", group: "admin" });
    await app.commands.handleInteraction(i);
    assert.deepEqual(calls.at(-1).sub, "reset");
    assert.deepEqual(calls.at(-1).group, "admin");
  });

  await t.test("الأحداث: كل الأحداث الأساسية وأحداث الإضافات مربوطة", () => {
    app.security.register = () => {};
    app.registerEvents();
    for (const ev of ["interactionCreate", "messageCreate", "guildMemberAdd", "voiceStateUpdate", "messageReactionAdd"]) {
      assert.ok(app.client.listenerCount(ev) >= 1, `الحدث ${ev} مربوط`);
    }
    for (const ev of Object.keys(app.plugins.eventHandlers())) {
      assert.ok(app.client.listenerCount(ev) >= 1, `حدث الإضافة ${ev} مربوط`);
    }
  });

  await t.test("كل أوامر السجل لها منفّذ وبيانات مساعدة", () => {
    for (const cmd of app.registry.all()) {
      assert.equal(typeof cmd.execute, "function", cmd.name);
      if (!cmd.isContextMenu) assert.ok(cmd.description, `${cmd.name} بلا وصف`);
    }
  });
});
