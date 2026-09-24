const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../helpers/harness");

test("التذاكر المتقدمة: النقل، الأولوية وSLA، الوسوم، التكليف، القفل، الإغلاق المؤجل، التصعيد", async (t) => {
  const app = await H.createApp();
  t.after(() => H.cleanup(app));
  const guild = H.fakeGuild();
  app.guilds.ensure(guild.id);
  app.client.guilds.cache.set(guild.id, guild);
  const admin = H.fakeMember(guild, "300000000000000003", { admin: true });
  const staffRole = H.fakeRole("860000000000000086");
  guild.roles.cache.set(staffRole.id, staffRole);
  app.guildConfig.set(guild.id, "staff.baseRoleId", staffRole.id);
  const staffA = H.fakeMember(guild, "600000000000000061", { roleIds: [staffRole.id] });
  const staffB = H.fakeMember(guild, "600000000000000062", { roleIds: [staffRole.id] });
  const alice = H.fakeMember(guild, "700000000000000007");
  const escalationCh = H.fakeChannel(guild, "400000000000000090", { app });

  const overwrites = new Map();
  const makeTicketChannel = (id) => {
    const ch = H.fakeChannel(guild, id, { app });
    ch.permissionOverwrites = {
      edit: async (target, perms) => { overwrites.set(`${id}:${target}`, { ...(overwrites.get(`${id}:${target}`) || {}), ...perms }); },
      delete: async (target) => { overwrites.delete(`${id}:${target}`); }
    };
    return ch;
  };
  const openTicket = (channelId, ownerId = alice.id) => {
    const ch = makeTicketChannel(channelId);
    const ticket = app.tickets.create({ guildId: guild.id, channelId, ownerId, number: app.tickets.nextNumber(guild.id) });
    app.bus.emitSafe("ticket:created", { guild, ticket, member: guild.members.cache.get(ownerId) });
    return { ch, ticket };
  };
  const cmd = async (member, channel, sub, options = {}) => {
    app.commands.cooldowns.clear();
    const i = H.fakeSlash(member, channel, { command: "تذكرة", sub, options });
    await app.commands.handleInteraction(i);
    return i;
  };
  const get = (ch) => app.ticketsPlusRepo.byChannel(ch.id);
  const job = (key) => app.db.prepare("SELECT * FROM scheduled_jobs WHERE unique_key = ? AND status = 'pending'").get(key);

  const { ch, ticket } = openTicket("450000000000000001");
  await new Promise((r) => setTimeout(r, 5));

  await t.test("فتح التذكرة يجدول SLA بالأولوية العادية ويسجّل الحدث", () => {
    const fresh = get(ch);
    assert.equal(fresh.priority, "normal");
    assert.equal(fresh.sla_due_at, fresh.created_at + 240 * 60_000);
    assert.ok(job(`ticket-sla:${ticket.id}`));
    assert.ok(app.ticketsPlus.awaiting.has(ch.id));
    assert.equal(app.ticketsPlusRepo.timeline(ticket.id)[0].action, "created");
  });

  await t.test("صاحب التذكرة لا يستخدم أدوات الطاقم، ويستطيع رؤية المعلومات", async () => {
    let i = await cmd(alice, ch, "priority", { level: "high" });
    assert.match(H.textOf(i.replies), /صلاحي/);
    i = await cmd(alice, ch, "info");
    assert.match(H.textOf(i.replies), /#0001/);
  });

  await t.test("الأوامر خارج قناة تذكرة ترفض", async () => {
    const other = H.fakeChannel(guild, "400000000000000091", { app });
    const i = await cmd(admin, other, "lock");
    assert.equal(i.replies.length > 0, true);
    assert.equal(get(ch).locked, 0);
  });

  await t.test("رسالة صاحب التذكرة لا تُحسب ردًا أولًا، ورسالة الطاقم تُحسب مرة واحدة وتلغي SLA", () => {
    app.ticketsPlus.onMessage(H.fakeMessage(alice, ch, "مرحبا"));
    assert.equal(get(ch).first_response_at, null);
    app.ticketsPlus.onMessage(H.fakeMessage(staffA, ch, "أهلًا كيف أساعدك"));
    const fresh = get(ch);
    assert.equal(fresh.first_responder, staffA.id);
    assert.ok(!job(`ticket-sla:${ticket.id}`), "ألغيت مهمة SLA");
    app.ticketsPlus.onMessage(H.fakeMessage(staffB, ch, "رد ثان"));
    assert.equal(get(ch).first_responder, staffA.id);
  });

  await t.test("تغيير الأولوية والوسوم (تحقق من الصيغة والحد الأقصى)", async () => {
    await cmd(staffA, ch, "priority", { level: "urgent" });
    assert.equal(get(ch).priority, "urgent");
    await cmd(staffA, ch, "tag", { action: "add", name: "Billing" });
    await cmd(staffA, ch, "tag", { action: "add", name: "vip" });
    assert.deepEqual(get(ch).tags, ["billing", "vip"]);
    const bad = app.ticketsPlus.tag(get(ch), staffA, "add", "مسافة فيها");
    assert.equal(bad.reason, "badTag");
    app.guildConfig.set(guild.id, "tickets.maxTags", 2);
    assert.equal(app.ticketsPlus.tag(get(ch), staffA, "add", "third").reason, "maxTags");
    await cmd(staffA, ch, "tag", { action: "remove", name: "vip" });
    assert.deepEqual(get(ch).tags, ["billing"]);
  });

  await t.test("النقل: المستلم فقط (أو الأدمن) ينقل، والنقل ذرّي", async () => {
    app.tickets.claim(ch.id, staffA.id);
    const res1 = await app.ticketsPlus.transfer(guild, get(ch), staffB, staffA);
    assert.equal(res1.reason, "notClaimer");
    const notStaff = await app.ticketsPlus.transfer(guild, get(ch), staffA, alice);
    assert.equal(notStaff.reason, "targetNotStaff");
    const stale = get(ch);
    await cmd(staffA, ch, "transfer", { user: staffB.user });
    assert.equal(get(ch).claimed_by, staffB.id);
    assert.equal(overwrites.get(`${ch.id}:${staffB.id}`).ViewChannel, true);
    // نسخة قديمة من التذكرة (المستلم السابق) لا تنجح بعد التغيير
    assert.equal(app.ticketsPlusRepo.transfer(stale.id, stale.claimed_by, admin.id), false);
  });

  await t.test("التكليف وإلغاؤه", async () => {
    await cmd(staffB, ch, "assign", { user: staffA.user });
    assert.deepEqual(app.ticketsPlusRepo.assignees(ticket.id), [staffA.id]);
    const dup = await app.ticketsPlus.assign(guild, get(ch), staffB, staffA);
    assert.equal(dup.reason, "alreadyAssigned");
    await cmd(staffB, ch, "unassign", { user: staffA.user });
    assert.deepEqual(app.ticketsPlusRepo.assignees(ticket.id), []);
  });

  await t.test("القفل يمنع صاحب التذكرة من الكتابة، والفتح يعيدها", async () => {
    await cmd(staffB, ch, "lock");
    assert.equal(get(ch).locked, 1);
    assert.equal(overwrites.get(`${ch.id}:${alice.id}`).SendMessages, false);
    const again = await app.ticketsPlus.lock(guild, get(ch), staffB, true);
    assert.equal(again.reason, "alreadyLocked");
    await cmd(staffB, ch, "unlock");
    assert.equal(overwrites.get(`${ch.id}:${alice.id}`).SendMessages, true);
  });

  await t.test("التصعيد مرة واحدة فقط ويرسل للقناة المحددة", async () => {
    app.guildConfig.set(guild.id, "tickets.escalation.channelId", escalationCh.id);
    await cmd(staffB, ch, "escalate", { reason: "عميل مهم" });
    assert.ok(get(ch).escalated_at);
    assert.match(H.textOf([escalationCh.sent.at(-1).payload]), /عميل مهم/);
    const again = await app.ticketsPlus.escalate(guild, get(ch), staffB, "x");
    assert.equal(again.reason, "alreadyEscalated");
  });

  await t.test("الإغلاق المؤجل: زر الإلغاء يلغي المهمة، والإعادة تُغلق عبر المجدول", async () => {
    await cmd(staffB, ch, "close", { delay: "10m", reason: "تم الحل" });
    assert.ok(get(ch).close_scheduled_at);
    const msg = ch.sent.at(-1);
    const button = msg.payload.components[0].components[0].data.custom_id;
    assert.equal(button, `tkt:cancelclose:${ticket.id}`);

    const stranger = H.fakeMember(guild, "700000000000000099");
    let i = H.fakeComponent(stranger, ch, button, { message: msg });
    await app.interactions.route(i);
    assert.ok(get(ch).close_scheduled_at, "غريب لا يلغي الإغلاق");

    i = H.fakeComponent(alice, ch, button, { message: msg });
    await app.interactions.route(i);
    assert.equal(get(ch).close_scheduled_at, null);
    assert.ok(!job(`ticket-close:${ticket.id}`));

    await cmd(staffB, ch, "close", { delay: "1m" });
    await app.scheduler.tick(Date.now() + 2 * 60_000);
    assert.equal(app.tickets.getByChannel(ch.id).status, "closed");
    assert.equal(app.ticketsPlusRepo.timeline(ticket.id).some((e) => e.action === "closed"), true);
  });

  await t.test("خرق SLA: يُعلَّم مرة واحدة وتصعيد تلقائي عند التفعيل", async () => {
    app.guildConfig.set(guild.id, "tickets.escalation.autoOnBreach", true);
    const { ch: ch2, ticket: t2 } = openTicket("450000000000000002", "700000000000000008");
    H.fakeMember(guild, "700000000000000008");
    await app.ticketsPlus.slaCheck(t2.id);
    const fresh = get(ch2);
    assert.equal(fresh.sla_breached, 1);
    assert.ok(fresh.escalated_at, "صُعّدت تلقائيًا");
    await app.ticketsPlus.slaCheck(t2.id);
    assert.equal(app.ticketsPlusRepo.timeline(t2.id).filter((e) => e.action === "slaBreached").length, 1);
  });

  await t.test("الإحصاءات للطاقم والإعدادات للأدمن فقط", async () => {
    let i = await cmd(alice, ch, "stats");
    assert.match(H.textOf(i.replies), /صلاحي/);
    i = await cmd(staffA, ch, "stats", { days: 7 });
    assert.match(H.textOf(i.replies), /📊/);
    await cmd(staffA, ch, "settings", { cooldown: 5 });
    assert.equal(app.guildConfig.value(guild.id, "tickets.cooldownMs") || 0, 0);
    await cmd(admin, ch, "settings", { cooldown: 5, "sla-high": 30 });
    assert.equal(app.guildConfig.value(guild.id, "tickets.cooldownMs"), 5 * 60_000);
    assert.equal(app.guildConfig.value(guild.id, "tickets.sla.high"), 30);
  });

  await t.test("تبريد فتح التذاكر في TicketService.open", async () => {
    app.guildConfig.set(guild.id, "tickets.enabled", true);
    const res = await app.ticketService.open({ guild, member: alice });
    assert.equal(res.reason, "cooldown");
    assert.ok(res.remainingMs > 0);
  });
});
