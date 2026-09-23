const fs = require("fs");
const path = require("path");

const LOCALES_DIR = path.join(__dirname, "..", "..", "..", "locales");

/** اللغات المدعومة رسميًا. أي ملف آخر في locales/ يُحمَّل لكنه لا يظهر في قوائم الاختيار. */
const SUPPORTED = {
  ar: { name: "العربية", native: "العربية", dir: "rtl" },
  en: { name: "English", native: "English", dir: "ltr" },
  fr: { name: "French", native: "Français", dir: "ltr" },
  tr: { name: "Turkish", native: "Türkçe", dir: "ltr" },
  es: { name: "Spanish", native: "Español", dir: "ltr" }
};

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && out[key] && typeof out[key] === "object") {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function lookup(pack, key) {
  return key.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), pack);
}

/**
 * كل النصوص الظاهرة للمستخدم تأتي من ملفات locales/.
 * هذا يسمح بتعديل صياغة أي رسالة من ملف واحد بدون لمس منطق البوت.
 *
 * كل سيرفر يختار لغته (`language` في إعداداته). المفتاح الناقص في لغة ما
 * يسقط على العربية مفتاحًا بمفتاح، فترجمة جزئية لا تُظهر أسماء مفاتيح خام.
 */
class I18n {
  constructor(defaultLocale = "ar") {
    this.defaultLocale = defaultLocale;
    this.locales = new Map();
    /** مصادر إضافية (ملفات لغات الإضافات) تُدمج فوق الأساسية عند كل load(). */
    this.extraDirs = [];
    /** دالة تعيد لغة السيرفر — تُحقن من Application بعد تهيئة الإعدادات. */
    this.guildLocaleResolver = null;
    this.load();
  }

  static get SUPPORTED() {
    return SUPPORTED;
  }

  addDirectory(dir) {
    if (dir && !this.extraDirs.includes(dir)) this.extraDirs.push(dir);
  }

  load() {
    this.locales.clear();
    for (const dir of [LOCALES_DIR, ...this.extraDirs]) {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        const name = path.basename(file, ".json");
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        this.locales.set(name, deepMerge(this.locales.get(name) || {}, data));
      }
    }
  }

  has(locale) {
    return this.locales.has(locale);
  }

  /** لغة سيرفر محدد، مع السقوط على الافتراضية إن كانت غير محمّلة. */
  localeFor(guildId) {
    if (!guildId || !this.guildLocaleResolver) return this.defaultLocale;
    const locale = this.guildLocaleResolver(guildId);
    return locale && this.locales.has(locale) ? locale : this.defaultLocale;
  }

  /**
   * t("errors.noPermission", { emoji: "❌" })
   * إذا لم يوجد المفتاح في أي لغة، يُعاد المفتاح نفسه ليكون النقص واضحًا أثناء التطوير.
   */
  t(key, vars = {}, locale = this.defaultLocale) {
    const pack = this.locales.get(locale) || {};
    let text = lookup(pack, key);
    if (typeof text !== "string" && locale !== this.defaultLocale) {
      text = lookup(this.locales.get(this.defaultLocale) || {}, key);
    }
    if (typeof text !== "string") return key;
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
    return text;
  }

  /** ترجمة بلغة سيرفر محدد. */
  tg(guildId, key, vars = {}) {
    return this.t(key, vars, this.localeFor(guildId));
  }

  /** دالة ترجمة مربوطة بسيرفر — مريحة داخل الخدمات. */
  forGuild(guildId) {
    const locale = this.localeFor(guildId);
    return (key, vars = {}) => this.t(key, vars, locale);
  }

  /** نسبة اكتمال كل لغة مقارنة بالعربية — تُعرض في شاشة اختيار اللغة. */
  coverage() {
    const flatten = (obj, prefix = "") =>
      Object.entries(obj || {}).flatMap(([k, v]) =>
        v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]
      );
    const base = new Set(flatten(this.locales.get(this.defaultLocale)));
    const out = {};
    for (const [name, pack] of this.locales) {
      const keys = flatten(pack).filter((k) => base.has(k));
      out[name] = base.size ? Math.round((keys.length / base.size) * 100) : 100;
    }
    return out;
  }
}

module.exports = I18n;
