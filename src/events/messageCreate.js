module.exports = async function messageCreate(app, message) {
  if (message.author.bot) return;

  // رسائل الخاص: تُستهلك كإجابة على نموذج مفتوح إن وُجد
  if (!message.guild) {
    await app.dmFlow.handleMessage(message).catch((err) =>
      app.errors.capture(err, { system: "applications/dmFlow", userId: message.author.id })
    );
    return;
  }

  // تتبّع نشاط الطاقم الإداري
  try {
    const cfg = app.guildConfig.get(message.guild.id);
    if (cfg.staff.trackMessages && cfg.staff.baseRoleId && message.member?.roles.cache.has(cfg.staff.baseRoleId)) {
      app.activity.increment(message.guild.id, message.author.id, "messages");
      // تسجيل الدخول اليومي للإداريين يحدث تلقائيًا بأول رسالة
      app.staffCheckin.recordFromMessage(message.guild.id, message.member);
    }
  } catch (err) {
    app.errors.capture(err, { system: "staff/activity", guildId: message.guild.id, userId: message.author.id });
  }

  // نشاط التذكرة يُصفّر عدّاد الخمول
  try {
    app.tickets.touch(message.channel.id);
  } catch { /* ليست تذكرة */ }

  await app.commands.handleMessage(message);

  // الردود التلقائية تُفحص أخيرًا، فلا تتعارض مع أي أمر
  try {
    await app.autoReplyService.handle(message);
  } catch (err) {
    app.errors.capture(err, { system: "autoreply", guildId: message.guild.id, userId: message.author.id });
  }
};
