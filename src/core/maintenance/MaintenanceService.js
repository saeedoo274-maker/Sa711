const STATE_KEY = "maintenance";

function emptyState() {
  return { global: null, modules: {}, commands: {} };
}

/**
 * وضع الصيانة على ثلاث مستويات:
 *  - عام: يوقف كل الأوامر والتفاعلات (السلوك القديم)
 *  - نظام: يوقف أوامر وتفاعلات نظام واحد (مثل tickets)
 *  - أمر: يوقف أمرًا واحدًا
 *
 * كل مدخل قد يحمل وقت بداية ونهاية (صيانة مجدولة)، ورسالة مخصصة.
 * الحالة محفوظة في قاعدة البيانات فتنجو من إعادة التشغيل (كانت سابقًا في الذاكرة فقط).
 * المطورون يتجاوزون كل المستويات دائمًا.
 */
class MaintenanceService {
  constructor(app) {
    this.app = app;
    this.repo = app.platform;
    this.state = { ...emptyState(), ...(this.repo.getState(STATE_KEY, null) || {}) };
  }

  _save() {
    this.repo.setState(STATE_KEY, this.state);
  }

  static isActive(entry, now = Date.now()) {
    if (!entry || !entry.enabled) return false;
    if (entry.startsAt && now < entry.startsAt) return false;
    if (entry.endsAt && now >= entry.endsAt) return false;
    return true;
  }

  /** يطبّق تغييرًا على مستوى معيّن ويسجّله. */
  set(scope, target, { enabled, message = null, startsAt = null, endsAt = null, actorId = null } = {}) {
    if (!["global", "module", "command"].includes(scope)) throw new Error(`نطاق صيانة غير معروف: ${scope}`);
    const entry = enabled ? { enabled: true, message, startsAt, endsAt, by: actorId, at: Date.now() } : null;

    if (scope === "global") this.state.global = entry;
    else {
      const bucket = scope === "module" ? this.state.modules : this.state.commands;
      if (entry) bucket[target] = entry;
      else delete bucket[target];
    }
    this._save();

    const action = !enabled ? "disable" : startsAt && startsAt > Date.now() ? "schedule" : "enable";
    this.repo.logMaintenance({ scope, target, action, message, actorId, startsAt, endsAt });
    this.app.logger.warn(`الصيانة [${scope}${target ? `:${target}` : ""}] ← ${action}`);

    // مهمة لتسجيل الانتهاء في السجل عند موعده — الفحص نفسه لا يعتمد عليها
    if (entry?.endsAt && this.app.scheduler?.handlers.has("maintenance:expire")) {
      this.app.scheduler.schedule({
        type: "maintenance:expire",
        runAt: entry.endsAt,
        uniqueKey: `maintenance:${scope}:${target || "*"}`,
        payload: { scope, target }
      });
    }
    return entry;
  }

  get globalActive() {
    return MaintenanceService.isActive(this.state.global);
  }

  /**
   * هل يُمنع هذا الأمر/النظام الآن؟
   * يُرجع { blocked: false } أو { blocked: true, scope, message }
   */
  check({ module = null, command = null, userId = null } = {}) {
    if (userId && this.app.permissions?.isDeveloper(userId)) return { blocked: false };
    if (MaintenanceService.isActive(this.state.global)) return { blocked: true, scope: "global", message: this.state.global.message };
    if (module && MaintenanceService.isActive(this.state.modules[module])) {
      return { blocked: true, scope: "module", target: module, message: this.state.modules[module].message };
    }
    if (command && MaintenanceService.isActive(this.state.commands[command])) {
      return { blocked: true, scope: "command", target: command, message: this.state.commands[command].message };
    }
    return { blocked: false };
  }

  /** يُسجّل انتهاء صيانة مجدولة ويزيل المدخل المنتهي من الحالة. */
  expire(scope, target) {
    const entry = scope === "global" ? this.state.global : (scope === "module" ? this.state.modules : this.state.commands)[target];
    if (!entry || !entry.endsAt || entry.endsAt > Date.now()) return false;
    if (scope === "global") this.state.global = null;
    else delete (scope === "module" ? this.state.modules : this.state.commands)[target];
    this._save();
    this.repo.logMaintenance({ scope, target, action: "expire" });
    return true;
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  log(limit = 15) {
    return this.repo.maintenanceLog(limit);
  }
}

module.exports = MaintenanceService;
