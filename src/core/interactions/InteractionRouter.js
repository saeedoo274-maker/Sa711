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
    /** مصادر معالجات إضافية (الإضافات): [{ name, file, feature, plugin }] */
    this.extraSources = () => [];
  }

  setExtraSources(fn) {
    this.extraSources = typeof fn === "function" ? fn : () => [];
  }

  load() {
    this.handlers.clear();
    const entries = [];
    if (fs.existsSync(MODULES_DIR)) {
      for (const moduleName of fs.readdirSync(MODULES_DIR)) {
        // بعض الأنظمة لها أكثر من معالج (مثل التذاكر: الإدارة والتقييم)
        for (const f of ["interactions.js", "rating.js"]) {
          entries.push({ moduleName, file: path.join(MODULES_DIR, moduleName, f), feature: moduleName });
        }
      }
    }
    for (const extra of this.extraSources() || []) {
      entries.push({ moduleName: extra.name, file: extra.file, feature: extra.feature, plugin: extra.plugin });
    }

    for (const { moduleName, file, feature, plugin } of entries) {
      if (!fs.existsSync(file)) continue;
      try {
        delete require.cache[require.resolve(file)];
        const handler = require(file);
        if (!handler?.prefix || typeof handler.handle !== "function") {
          this.app.logger.warn(`معالج تفاعل غير صالح في ${moduleName}`);
          continue;
        }
        if (this.handlers.has(handler.prefix)) {
          this.app.logger.warn(`بادئة تفاعل مكررة "${handler.prefix}" في ${moduleName} — تم تجاهلها`);
          continue;
        }
        handler.module = moduleName;
        handler.feature = handler.feature || feature;
        if (plugin) handler.plugin = plugin;
        this.handlers.set(handler.prefix, handler);
      } catch (err) {
        this.app.logger.error(`فشل تحميل معالج تفاعل ${moduleName}: ${err.message}`);
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
    const DM_ALLOWED = new Set(["trate", ...(handler.dmAllowed ? [prefix] : [])]);
    if (!interaction.guild && !DM_ALLOWED.has(prefix)) {
      await interaction.reply({
        content: this.app.i18n.t("errors.guildOnly", { emoji: this.app.config.emoji("error") }),
        flags: 64
      }).catch(() => {});
      return true;
    }

    // وضع الصيانة (عام أو لهذا النظام) يوقف التفاعلات ما عدا تفاعلات المطور
    if (interaction.guild) {
      const maintenance = this.app.maintenanceService
        ? this.app.maintenanceService.check({ module: handler.module, userId: interaction.user.id })
        : { blocked: this.app.maintenance && !this.app.permissions.isDeveloper(interaction.user.id) };
      if (maintenance.blocked) {
        await interaction.reply({
          content: maintenance.message || this.app.i18n.tg(interaction.guild.id, "developer.maintenanceActive", { emoji: this.app.config.emoji("warning") }),
          flags: 64
        }).catch(() => {});
        return true;
      }

      // النظام معطّل بعلم الميزة: الأزرار القديمة المنشورة تتوقف مع الأوامر
      if (this.app.features && handler.feature && !this.app.features.isEnabled(interaction.guild.id, handler.feature)) {
        await interaction.reply({
          content: this.app.i18n.tg(interaction.guild.id, "errors.systemDisabled", { emoji: this.app.config.emoji("error"), system: handler.feature }),
          flags: 64
        }).catch(() => {});
        return true;
      }
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
