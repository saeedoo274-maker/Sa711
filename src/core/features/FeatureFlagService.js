const GLOBAL_KEY = "features.global";

/**
 * أعلام الميزات (Feature Flags).
 *
 * طبقتان:
 *  1. عامة (يتحكم بها المطور): `false` تعطّل النظام في كل السيرفرات.
 *  2. لكل سيرفر: `features.<name>` في إعدادات السيرفر.
 *
 * بلا قيمة صريحة يُستخدم الافتراضي المسجّل للنظام (الأنظمة القديمة مفعّلة
 * افتراضيًا حتى لا يتغير سلوك أي سيرفر بعد التحديث).
 *
 * ملاحظة: أعلام الأنظمة القديمة الموجودة أصلًا (`economy.enabled` وغيرها)
 * تبقى كما هي وتُفحص عبر `systemFlag` في CommandHandler — هذا طبقة إضافية لا بديلة.
 */
class FeatureFlagService {
  constructor(app) {
    this.app = app;
    this.known = new Map(); // name -> { default, label, source }
    this.global = app.platform.getState(GLOBAL_KEY, {}) || {};
  }

  register(name, { defaultEnabled = true, label = name, source = "module" } = {}) {
    if (!name) return;
    const existing = this.known.get(name);
    // الإضافة تفوز على الوحدة القديمة بنفس الاسم لأنها أدق في وصف افتراضيها
    if (!existing || source === "plugin") this.known.set(name, { default: defaultEnabled, label, source });
  }

  list() {
    return [...this.known.entries()].map(([name, meta]) => ({ name, ...meta }));
  }

  isKnown(name) {
    return this.known.has(name);
  }

  globallyEnabled(name) {
    return this.global[name] !== false;
  }

  setGlobal(name, enabled) {
    if (enabled === null || enabled === undefined) delete this.global[name];
    else this.global[name] = !!enabled;
    this.app.platform.setState(GLOBAL_KEY, this.global);
    return this.global[name];
  }

  isEnabled(guildId, name) {
    if (!name) return true;
    if (!this.globallyEnabled(name)) return false;
    if (guildId) {
      const value = this.app.guildConfig.value(guildId, `features.${name}`);
      if (typeof value === "boolean") return value;
    }
    const meta = this.known.get(name);
    return meta ? meta.default !== false : true;
  }

  setForGuild(guildId, name, enabled) {
    this.app.guildConfig.set(guildId, `features.${name}`, enabled === null ? null : !!enabled);
    return this.isEnabled(guildId, name);
  }

  /** كل الأعلام بحالتها لسيرفر محدد — للوحة التحكم وأمر الإعدادات. */
  forGuild(guildId) {
    return this.list().map((f) => ({
      ...f,
      enabled: this.isEnabled(guildId, f.name),
      globallyEnabled: this.globallyEnabled(f.name),
      explicit: typeof this.app.guildConfig.value(guildId, `features.${f.name}`) === "boolean"
    }));
  }
}

module.exports = FeatureFlagService;
