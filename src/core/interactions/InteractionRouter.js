const fs = require("fs");
const path = require("path");

const MODULES_DIR = path.join(__dirname, "..", "..", "modules");

/**
 * موجّه التفاعلات.
 * كل معالج يسجّل بادئة (prefix)، والـ customId يتبع الصيغة: prefix:action:arg1:arg2
 * لا يوجد أي منطق صلاحيات هنا — كل معالج مسؤول عن فحص صلاحياته بنفسه من الخادم.
 */
class InteractionRouter {
  constructor(app) {
    this.app = app;
    this.handlers = new Map();
  }

  load() {
    this.handlers.clear();
    if (!fs.existsSync(MODULES_DIR)) return 0;

    for (const moduleName of fs.readdirSync(MODULES_DIR)) {
      // بعض الأنظمة لها أكثر من معالج (مثل التذاكر: الإدارة والتقييم)
      const files = ["interactions.js", "rating.js"]
        .map((f) => path.join(MODULES_DIR, moduleName, f))
        .filter((f) => fs.existsSync(f));

      for (const file of files) {
      try {
        delete require.cache[require.resolve(file)];
        const handler = require(file);
        if (!handler?.prefix || typeof handler.handle !== "function") {
          this.app.logger.warn(`معالج تفاعل غير صالح في ${moduleName}`);
          continue;
        }
        this.handlers.set(handler.prefix, handler);
      } catch (err) {
        this.app.logger.error(`فشل تحميل معالج تفاعل ${moduleName}: ${err.message}`);
      }
      }
    }

    this.app.logger.info(`تم تحميل ${this.handlers.size} معالج تفاعل.`);
    return this.handlers.size;
  }

  async route(interaction) {
    if (!interaction.customId) return false;
    const prefix = interaction.customId.split(":")[0];
    const handler = this.handlers.get(prefix);
    if (!handler) return false;

    // معالجات محددة تعمل في الخاص (مثل تقييم التذكرة بعد إغلاقها)
    const DM_ALLOWED = new Set(["trate"]);
    if (!interaction.guild && !DM_ALLOWED.has(prefix)) {
      await interaction.reply({
        content: this.app.i18n.t("errors.guildOnly", { emoji: this.app.config.emoji("error") }),
        flags: 64
      }).catch(() => {});
      return true;
    }

    // وضع الصيانة يوقف كل التفاعلات ما عدا تفاعلات المطور
    if (interaction.guild && this.app.maintenance && !this.app.permissions.isDeveloper(interaction.user.id)) {
      await interaction.reply({
        content: this.app.i18n.t("developer.maintenanceActive", { emoji: this.app.config.emoji("warning") }),
        flags: 64
      }).catch(() => {});
      return true;
    }

    // شبكة أمان: أي معالج قد يتجاوز مهلة ديسكورد (3 ثوانٍ) أو يرمي استثناءً،
    // فنضمن وصول رد للمستخدم بدل رسالة "The application did not respond".
    try {
      await handler.handle(interaction, this.app);
    } catch (error) {
      const { userMessage } = this.app.errors.capture(error, {
        system: `interactions/${prefix}`,
        command: interaction.customId,
        guildId: interaction.guild?.id,
        userId: interaction.user?.id
      });
      const payload = { content: userMessage, flags: 64 };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
    return true;
  }
}

module.exports = InteractionRouter;
