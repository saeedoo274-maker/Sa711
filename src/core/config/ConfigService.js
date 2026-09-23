const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

/**
 * القيم الافتراضية الكاملة لـ bot.json.
 * أي مفتاح ناقص أو ملف معدَّل يدويًا على استضافة (لوحة تحكم بها محرر ملفات
 * مثلًا) يسقط بأمان على هذي القيمة بدل تعطيل كل أمر يستخدم config.color()
 * أو config.emoji() — وهذي تُستدعى من مئات المواضع في المشروع.
 */
const DEFAULTS = {
  bot: {
    name: "البوت الإداري",
    language: "ar",
    defaultPrefix: "!",
    presence: { status: "online", activityType: "Watching", activityName: "إدارة السيرفر" }
  },
  colors: { primary: "#5865F2", success: "#57F287", danger: "#ED4245", warning: "#FEE75C", neutral: "#2B2D31", info: "#3498DB" },
  emojis: {
    success: "✅", error: "❌", warning: "⚠️", lock: "🔒", unlock: "🔓", shield: "🛡️",
    ticket: "🎫", staff: "👥", stats: "📊", logs: "📜", settings: "⚙️", developer: "🧰", help: "❓", back: "⬅️"
  },
  limits: { defaultCooldownMs: 3000, maxClearMessages: 100, maxReasonLength: 512, guildConfigCacheMs: 300000 }
};

/** يدمج القيم المحمَّلة فوق الافتراضية، فمفتاح ناقص من الملف لا يعني قيمة undefined. */
function mergeDefaults(loaded, defaults) {
  const out = { ...defaults, ...loaded };
  for (const key of Object.keys(defaults)) {
    if (defaults[key]?.constructor === Object) {
      out[key] = { ...defaults[key], ...(loaded?.[key] || {}) };
    }
  }
  return out;
}

/**
 * الإعدادات العامة للبوت.
 * الأسرار تأتي من متغيرات البيئة فقط، ولا تُخزَّن في أي ملف داخل المستودع.
 */
class ConfigService {
  constructor() {
    const loadedBot = this._readJson(path.join(ROOT, "config", "bot.json"));
    // نُسطّح bot.json (يحوي bot/colors/emojis/limits كمفاتيح جذرية) عبر نفس آلية الدمج
    const merged = mergeDefaults(loadedBot, DEFAULTS);
    this.bot = merged.bot;
    this.colors = merged.colors;
    this.emojis = merged.emojis;
    this.limits = merged.limits;
    // توافق خلفي: بعض الكود قد يقرأ this.bot.colors/emojis مباشرة كما كانت الملف الخام
    this.bot.colors = this.colors;
    this.bot.emojis = this.emojis;
    this.bot.limits = this.limits;

    this.guildDefaults = this._readJson(path.join(ROOT, "config", "guild-defaults.json"));

    this.env = {
      token: process.env.BOT_TOKEN,
      clientId: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      devGuildId: process.env.DEV_GUILD_ID || null,
      databasePath: process.env.DATABASE_PATH || "./data/bot.db",
      nodeEnv: process.env.NODE_ENV || "development",
      logLevel: process.env.LOG_LEVEL || "info"
    };

    this.developerIds = (process.env.DEVELOPER_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  /** يرجع كائنًا فارغًا بدل رمي استثناء لو الملف مفقودًا أو تالفًا — تُغطّى القيم الناقصة بالافتراضيات دائمًا. */
  _readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }

  color(name) {
    const hex = this.colors[name] || this.colors.neutral;
    return parseInt(hex.replace("#", ""), 16);
  }

  emoji(name) {
    return this.emojis[name] || "";
  }

  isDeveloper(userId) {
    return this.developerIds.includes(userId);
  }

  /** يتحقق من وجود كل المتغيرات المطلوبة قبل الإقلاع. */
  validate() {
    const missing = [];
    if (!this.env.token) missing.push("BOT_TOKEN");
    if (!this.env.clientId) missing.push("CLIENT_ID");
    if (this.developerIds.length === 0) missing.push("DEVELOPER_IDS");
    return missing;
  }
}

module.exports = ConfigService;
