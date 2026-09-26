const { REST, Routes } = require("discord.js");

/** ينشر أوامر السلاش تلقائيًا عند الإقلاع، فلا يحتاج المستخدم لتشغيل أمر منفصل. */
async function deployCommands(app) {
  const body = app.registry.slashData();
  if (!body.length) return;

  try {
    const rest = new REST({ version: "10" }).setToken(app.config.env.token);
    const route = app.config.env.devGuildId
      ? Routes.applicationGuildCommands(app.client.user.id, app.config.env.devGuildId)
      : Routes.applicationCommands(app.client.user.id);

    const data = await rest.put(route, { body });
    app.logger.info(
      `تم نشر ${data.length} أمر سلاش ${app.config.env.devGuildId ? "على سيرفر التطوير" : "عالميًا"}.`
    );
    if (!app.config.env.devGuildId) {
      app.logger.info("النشر العالمي قد يستغرق حتى ساعة ليظهر في كل السيرفرات.");
    }
  } catch (error) {
    // فشل النشر لا يجب أن يمنع البوت من العمل — أوامر البريفكس تبقى شغّالة
    app.logger.error(`تعذّر نشر أوامر السلاش: ${error.message}`);
    app.logger.error("أوامر البريفكس ستعمل طبيعيًا. شغّل `npm run deploy` لاحقًا لإعادة المحاولة.");
  }
}

module.exports = async function ready(app) {
  app.logger.info(`تم تسجيل الدخول باسم ${app.client.user.tag}`);
  app.logger.info(`السيرفرات: ${app.client.guilds.cache.size} | الأوامر: ${app.registry.commands.size}`);

  // تسجيل كل سيرفر موجود مسبقًا حتى تكون له إعدادات مستقلة من اللحظة الأولى
  let leftBlacklisted = 0;
  for (const guild of app.client.guilds.cache.values()) {
    // سيرفر حُظر أثناء توقف البوت يُغادَر عند الإقلاع
    if (app.oversight.isBlacklisted(guild.id)) {
      await guild.leave().catch(() => {});
      leftBlacklisted++;
      continue;
    }
    app.guilds.ensure(guild.id);
    app.oversight.track({
      guildId: guild.id,
      name: guild.name,
      ownerId: guild.ownerId,
      memberCount: guild.memberCount,
      iconUrl: guild.iconURL() || null
    });
  }
  if (leftBlacklisted) app.logger.warn(`غادر البوت ${leftBlacklisted} سيرفر محظور.`);

  await deployCommands(app);

  // المؤقتات الدورية للسحوبات والاستطلاعات
  app.giveawayService.start();
  app.pollService.start();
  app.lifecycleService.start();
  app.ticketAutomation.start();
  app.reportService.start();
  // يفحص السجناء المستحقين فورًا، فتنجو حالة السجن من إعادة تشغيل البوت
  app.rpService.start();
  app.staffCheckin.start();
  app.questService.start();
  app.backups.start();
  app.health.start();
  // المجدول والطابور المركزيان: يستأنفان أي مهمة محفوظة من قبل إعادة التشغيل
  app.scheduler.start();
  // تنظيف يومي للبيانات القديمة حسب سياسات الاحتفاظ (قابلة للتعديل من /مطور cleanup)
  app.scheduler.ensureRecurring("cleanup:run", "cleanup:daily", { kind: "daily", time: "03:30" });
  app.queue.start();
  await app.plugins.start();
  await app.scheduler.tick().catch((err) => app.errors.capture(err, { system: "scheduler" }));

  // معالجة أي سحوبات أو استطلاعات انتهت وقت توقف البوت
  await app.giveawayService.tick().catch(() => {});
  await app.pollService.tick().catch(() => {});
  await app.lifecycleService.tick().catch(() => {});

  // تجميلية بحتة — تُنفَّذ أخيرًا عمدًا فلا يتوقف عليها إقلاع حقيقي.
  // setPresence لا يرمي أبدًا (محمية داخليًا)، لكن ترتيبها هنا خط دفاع إضافي.
  app.setPresence();

  app.logger.info("البوت جاهز.");
};
