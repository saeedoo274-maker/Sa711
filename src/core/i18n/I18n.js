const fs = require("fs");
const path = require("path");

const LOCALES_DIR = path.join(__dirname, "..", "..", "..", "locales");

/**
 * كل النصوص الظاهرة للمستخدم تأتي من ملفات locales/.
 * هذا يسمح بتعديل صياغة أي رسالة من ملف واحد بدون لمس منطق البوت.
 */
class I18n {
  constructor(defaultLocale = "ar") {
    this.defaultLocale = defaultLocale;
    this.locales = new Map();
    this.load();
  }

  load() {
    this.locales.clear();
    if (!fs.existsSync(LOCALES_DIR)) return;
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      if (!file.endsWith(".json")) continue;
      const name = path.basename(file, ".json");
      this.locales.set(name, JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8")));
    }
  }

  /**
   * t("errors.noPermission", { emoji: "❌" })
   * إذا لم يوجد المفتاح، يُعاد المفتاح نفسه ليكون النقص واضحًا أثناء التطوير.
   */
  t(key, vars = {}, locale = this.defaultLocale) {
    const pack = this.locales.get(locale) || this.locales.get(this.defaultLocale) || {};
    let text = key.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), pack);
    if (typeof text !== "string") return key;
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
    return text;
  }
}

module.exports = I18n;
