require("dotenv").config();
const { REST, Routes } = require("discord.js");
const path = require("path");
const ConfigService = require(path.join(__dirname, "..", "config", "ConfigService"));
const Logger = require(path.join(__dirname, "..", "logger", "Logger"));
const CommandRegistry = require("./CommandRegistry");

/**
 * نشر أوامر السلاش على ديسكورد.
 * DEV_GUILD_ID موجود؟ يُنشر على ذلك السيرفر فورًا (مناسب للتطوير).
 * غير موجود؟ يُنشر عالميًا (قد يستغرق حتى ساعة لينتشر).
 */
(async () => {
  const config = new ConfigService();
  const logger = new Logger(config.env.logLevel);

  const missing = config.validate();
  if (missing.length) {
    logger.error(`متغيرات بيئة ناقصة: ${missing.join(", ")}`);
    process.exit(1);
  }

  const registry = new CommandRegistry(logger);
  registry.load();
  const body = registry.slashData();

  if (!body.length) {
    logger.warn("لا توجد أوامر سلاش لنشرها.");
    process.exit(0);
  }

  const rest = new REST({ version: "10" }).setToken(config.env.token);

  try {
    const route = config.env.devGuildId
      ? Routes.applicationGuildCommands(config.env.clientId, config.env.devGuildId)
      : Routes.applicationCommands(config.env.clientId);

    const data = await rest.put(route, { body });
    logger.info(`تم نشر ${data.length} أمر سلاش ${config.env.devGuildId ? `على سيرفر التطوير ${config.env.devGuildId}` : "عالميًا"}.`);
    if (!config.env.devGuildId) logger.info("النشر العالمي قد يستغرق حتى ساعة ليظهر في كل السيرفرات.");
  } catch (error) {
    logger.error(`فشل النشر: ${error.message}`);
    if (error.rawError) logger.error("تفاصيل:", JSON.stringify(error.rawError, null, 2));
    process.exit(1);
  }
})();
