/**
 * إعدادات كل سيرفر على حدة.
 * قاعدة صارمة: لا تُقرأ ولا تُكتب أي إعدادات إلا عبر guildId صريح،
 * ولا توجد أي حالة عامة مشتركة بين السيرفرات.
 */
class GuildConfigService {
  constructor(guildRepo, defaults, cacheMs = 300000) {
    this.repo = guildRepo;
    this.defaults = defaults;
    this.cacheMs = cacheMs;
    this.cache = new Map(); // guildId -> { data, expiresAt }
  }

  static deepMerge(base, override) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    if (!override || typeof override !== "object") return out;
    for (const [key, value] of Object.entries(override)) {
      if (value && typeof value === "object" && !Array.isArray(value) && base && typeof base[key] === "object" && !Array.isArray(base[key])) {
        out[key] = GuildConfigService.deepMerge(base[key], value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  static getPath(obj, dotPath) {
    return dotPath.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  }

  static setPath(obj, dotPath, value) {
    const keys = dotPath.split(".");
    let node = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof node[keys[i]] !== "object" || node[keys[i]] === null) node[keys[i]] = {};
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = value;
    return obj;
  }

  /** الإعدادات الكاملة للسيرفر = الافتراضيات مدموجة مع المحفوظ. */
  get(guildId) {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const stored = this.repo.getRawConfig(guildId) || {};
    const data = GuildConfigService.deepMerge(this.defaults, stored);
    this.cache.set(guildId, { data, expiresAt: Date.now() + this.cacheMs });
    return data;
  }

  value(guildId, dotPath) {
    return GuildConfigService.getPath(this.get(guildId), dotPath);
  }

  /** يحفظ قيمة واحدة ويُبطل الكاش فورًا حتى تُطبَّق في نفس اللحظة. */
  set(guildId, dotPath, value) {
    const stored = this.repo.getRawConfig(guildId) || {};
    GuildConfigService.setPath(stored, dotPath, value);
    this.repo.saveConfig(guildId, stored);
    this.cache.delete(guildId);
    return this.get(guildId);
  }

  setMany(guildId, entries) {
    const stored = this.repo.getRawConfig(guildId) || {};
    for (const [dotPath, value] of Object.entries(entries)) {
      GuildConfigService.setPath(stored, dotPath, value);
    }
    this.repo.saveConfig(guildId, stored);
    this.cache.delete(guildId);
    return this.get(guildId);
  }

  reset(guildId) {
    this.repo.saveConfig(guildId, {});
    this.cache.delete(guildId);
    return this.get(guildId);
  }

  invalidate(guildId) {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
  }
}

module.exports = GuildConfigService;
