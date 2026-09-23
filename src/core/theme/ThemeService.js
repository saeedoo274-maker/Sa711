const { buildEmbed } = require("../utils/helpers");

const COLOR_KEYS = ["primary", "success", "danger", "warning", "neutral", "info"];
const HEX_RE = /^#?[0-9a-f]{6}$/i;
const URL_RE = /^https:\/\/\S{4,500}$/i;

/**
 * نظام الثيمات لكل سيرفر.
 *
 * `theme` في إعدادات السيرفر:
 *   colors  : { primary, success, danger(=error), warning, neutral, info } بصيغة #RRGGBB
 *   emojis  : تجاوزات لإيموجيات bot.json (success, error, ...)
 *   footer  : نص تذييل افتراضي للإمبيدات
 *   logoUrl : أيقونة التذييل/الرأس
 *   bannerUrl: صورة شعار عريضة (للترحيب واللوحات)
 *   embed   : { timestamp: bool, authorFromGuild: bool }
 *
 * أي قيمة غير محددة تسقط على الإعدادات العامة (config/bot.json)، فالسيرفرات
 * الحالية تبقى بنفس الشكل تمامًا.
 */
class ThemeService {
  constructor(app) {
    this.app = app;
  }

  get(guildId) {
    return (guildId && this.app.guildConfig.value(guildId, "theme")) || {};
  }

  /** لون كرقم جاهز لـ setColor. "error" مرادف لـ "danger". */
  color(guildId, name = "primary") {
    const key = name === "error" ? "danger" : name;
    const hex = this.get(guildId).colors?.[key];
    if (hex && HEX_RE.test(hex)) return parseInt(hex.replace("#", ""), 16);
    return this.app.config.color(key);
  }

  emoji(guildId, name) {
    const override = this.get(guildId).emojis?.[name];
    return override || this.app.config.emoji(name);
  }

  /** إمبيد بثيم السيرفر: اللون والتذييل والشعار تُطبّق تلقائيًا ما لم تُمرَّر صراحة. */
  embed(guildId, opts = {}, guild = null) {
    const theme = this.get(guildId);
    const out = { ...opts };
    if (out.color === undefined || typeof out.color === "string") out.color = this.color(guildId, out.color || "primary");
    if (out.footer === undefined && theme.footer) {
      out.footer = theme.logoUrl ? { text: theme.footer, iconURL: theme.logoUrl } : theme.footer;
    }
    if (out.author === undefined && theme.embed?.authorFromGuild && guild) {
      out.author = { name: guild.name, iconURL: theme.logoUrl || guild.iconURL?.() || undefined };
    }
    if (out.timestamp === undefined && theme.embed?.timestamp === false) out.timestamp = false;
    return buildEmbed(out);
  }

  /** يتحقق من قيم الثيم قبل الحفظ ويعيد الأخطاء بوضوح. */
  validate(patch = {}) {
    const errors = [];
    const clean = {};
    if (patch.colors) {
      clean.colors = {};
      for (const [k, v] of Object.entries(patch.colors)) {
        const key = k === "error" ? "danger" : k;
        if (!COLOR_KEYS.includes(key)) { errors.push(`لون غير معروف: ${k}`); continue; }
        if (v === null) { clean.colors[key] = null; continue; }
        if (!HEX_RE.test(String(v))) { errors.push(`قيمة لون غير صالحة لـ ${k}: ${v}`); continue; }
        clean.colors[key] = `#${String(v).replace("#", "").toUpperCase()}`;
      }
    }
    for (const key of ["logoUrl", "bannerUrl"]) {
      if (patch[key] === undefined) continue;
      if (patch[key] === null || patch[key] === "") clean[key] = null;
      else if (URL_RE.test(patch[key])) clean[key] = patch[key];
      else errors.push(`رابط غير صالح (${key}) — يجب أن يبدأ بـ https://`);
    }
    if (patch.footer !== undefined) clean.footer = patch.footer ? String(patch.footer).slice(0, 200) : null;
    if (patch.emojis) {
      clean.emojis = {};
      for (const [k, v] of Object.entries(patch.emojis)) clean.emojis[k] = v ? String(v).slice(0, 64) : null;
    }
    if (patch.embed) {
      clean.embed = {};
      if (patch.embed.timestamp !== undefined) clean.embed.timestamp = !!patch.embed.timestamp;
      if (patch.embed.authorFromGuild !== undefined) clean.embed.authorFromGuild = !!patch.embed.authorFromGuild;
    }
    return { ok: errors.length === 0, errors, clean };
  }

  /** يدمج تعديلًا مُتحقَّقًا منه في ثيم السيرفر. */
  update(guildId, patch) {
    const { ok, errors, clean } = this.validate(patch);
    if (!ok) return { ok: false, errors };
    const current = this.get(guildId);
    const next = {
      ...current,
      ...clean,
      colors: { ...(current.colors || {}), ...(clean.colors || {}) },
      emojis: { ...(current.emojis || {}), ...(clean.emojis || {}) },
      embed: { ...(current.embed || {}), ...(clean.embed || {}) }
    };
    for (const bucket of ["colors", "emojis"]) {
      for (const [k, v] of Object.entries(next[bucket])) if (v === null) delete next[bucket][k];
    }
    this.app.guildConfig.set(guildId, "theme", next);
    return { ok: true, theme: next };
  }

  reset(guildId) {
    this.app.guildConfig.set(guildId, "theme", {});
  }

  static get COLOR_KEYS() {
    return COLOR_KEYS;
  }
}

module.exports = ThemeService;
