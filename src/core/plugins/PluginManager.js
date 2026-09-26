const fs = require("fs");
const path = require("path");

const PLUGINS_DIR = path.join(__dirname, "..", "..", "plugins");
const VERSIONS_KEY = "plugins.versions";
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * مدير الإضافات (Plugins).
 *
 * كل إضافة مجلد داخل `src/plugins/<name>/` يحوي:
 *   plugin.json      ← البيان: name, version, description, feature, defaultEnabled,
 *                       dependencies, configKey, config (القيم الافتراضية), permissions
 *   index.js         ← { register(app, plugin), events: { discordEvent(app, ...args) }, start(app), stop(app), health(app) }
 *   commands/*.js    ← نفس صيغة أوامر الوحدات تمامًا
 *   interactions.js  ← نفس صيغة معالجات الوحدات: { prefix, handle }
 *   migrations/*.sql ← تُطبَّق بعد هجرات الأساس، وتُسجَّل باسم plugin/<name>/<file>
 *   locales/*.json   ← تُدمج في نظام الترجمة
 *
 * الإضافة التي تنقصها تبعية لا تُحمَّل (ولا يسقط البوت). الترتيب يحترم التبعيات.
 * التفعيل والتعطيل عبر أعلام الميزات (عام للمطور، ولكل سيرفر).
 */
class PluginManager {
  constructor(app, dir = PLUGINS_DIR) {
    this.app = app;
    this.dir = dir;
    this.plugins = new Map(); // name -> { manifest, dir, module, status, error }
    this.order = [];
  }

  /** يقرأ البيانات فقط (بلا تنفيذ منطق) — يُستدعى قبل قاعدة البيانات. */
  discover() {
    this.plugins.clear();
    if (!fs.existsSync(this.dir)) return [];

    for (const name of fs.readdirSync(this.dir).sort()) {
      const dir = path.join(this.dir, name);
      const manifestFile = path.join(dir, "plugin.json");
      if (!fs.existsSync(manifestFile)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        const problem = PluginManager.validateManifest(manifest, name);
        if (problem) {
          this.plugins.set(name, { manifest, dir, status: "invalid", error: problem });
          this.app.logger.error(`إضافة غير صالحة ${name}: ${problem}`);
          continue;
        }
        this.plugins.set(manifest.name, { manifest, dir, status: "discovered", error: null });
      } catch (error) {
        this.plugins.set(name, { manifest: { name }, dir, status: "invalid", error: error.message });
        this.app.logger.error(`تعذّر قراءة بيان الإضافة ${name}: ${error.message}`);
      }
    }

    this.order = this._resolveOrder();

    for (const name of this.order) {
      const plugin = this.plugins.get(name);
      const { manifest } = plugin;
      // القيم الافتراضية لإعدادات الإضافة تُدمج في افتراضيات السيرفر، فتعمل مع GuildConfigService كما هو
      if (manifest.configKey && manifest.config) {
        const defaults = this.app.config.guildDefaults;
        defaults[manifest.configKey] = { ...(manifest.config || {}), ...(defaults[manifest.configKey] || {}) };
      }
      const localesDir = path.join(plugin.dir, "locales");
      if (fs.existsSync(localesDir)) this.app.i18n.addDirectory(localesDir);
    }
    this.app.i18n.load();
    return this.order;
  }

  static validateManifest(m, folder) {
    if (!m || typeof m !== "object") return "البيان ليس كائنًا";
    if (!m.name || !/^[a-z][a-z0-9-]{1,31}$/.test(m.name)) return "الاسم مفقود أو غير صالح";
    if (m.name !== folder) return `اسم المجلد (${folder}) لا يطابق الاسم في البيان (${m.name})`;
    if (!m.version || !SEMVER_RE.test(m.version)) return "الإصدار يجب أن يكون بصيغة x.y.z";
    if (m.dependencies && !Array.isArray(m.dependencies)) return "dependencies يجب أن تكون مصفوفة";
    return null;
  }

  /** ترتيب طوبولوجي حسب التبعيات، مع إسقاط ما تنقصه تبعية أو يدخل في حلقة. */
  _resolveOrder() {
    const order = [];
    const state = new Map(); // name -> "visiting" | "done" | "failed"

    const visit = (name, chain = []) => {
      const plugin = this.plugins.get(name);
      if (!plugin || plugin.status === "invalid") return false;
      if (state.get(name) === "done") return true;
      if (state.get(name) === "failed") return false;
      if (state.get(name) === "visiting") {
        plugin.status = "invalid";
        plugin.error = `تبعية دائرية: ${[...chain, name].join(" ← ")}`;
        return false;
      }
      state.set(name, "visiting");
      for (const dep of plugin.manifest.dependencies || []) {
        if (!visit(dep, [...chain, name])) {
          plugin.status = "invalid";
          plugin.error = plugin.error || `تبعية مفقودة أو معطوبة: ${dep}`;
          state.set(name, "failed");
          this.app.logger.error(`الإضافة ${name} لن تُحمَّل: ${plugin.error}`);
          return false;
        }
      }
      state.set(name, "done");
      order.push(name);
      return true;
    };

    for (const name of this.plugins.keys()) visit(name);
    return order;
  }

  /** مصادر الهجرات لطبقة قاعدة البيانات. */
  migrationSources() {
    return this.order.map((name) => ({ plugin: name, dir: path.join(this.plugins.get(name).dir, "migrations") }));
  }

  /** مصادر الأوامر لسجل الأوامر. */
  commandSources() {
    return this.order.map((name) => {
      const p = this.plugins.get(name);
      return { name, dir: path.join(p.dir, "commands"), feature: p.manifest.feature || name, plugin: name };
    });
  }

  /** مصادر معالجات التفاعل للموجّه. */
  interactionSources() {
    // interactions.js، وأي ملفات إضافية داخل interactions/ (لكل ملف بادئة مستقلة)
    return this.order.flatMap((name) => {
      const p = this.plugins.get(name);
      const base = { name, feature: p.manifest.feature || name, plugin: name };
      const extraDir = path.join(p.dir, "interactions");
      const extra = fs.existsSync(extraDir) ? fs.readdirSync(extraDir).filter((f) => f.endsWith(".js")).sort().map((f) => ({ ...base, file: path.join(extraDir, f) })) : [];
      return [{ ...base, file: path.join(p.dir, "interactions.js") }, ...extra];
    });
  }

  /** يحمّل index.js لكل إضافة وينفّذ register — بعد تهيئة الخدمات الأساسية. */
  register() {
    const versions = this.app.platform.getState(VERSIONS_KEY, {}) || {};
    let changed = false;

    for (const name of this.order) {
      const plugin = this.plugins.get(name);
      const { manifest } = plugin;
      this.app.features.register(manifest.feature || name, {
        defaultEnabled: manifest.defaultEnabled !== false,
        label: manifest.label || manifest.description || name,
        source: "plugin"
      });

      try {
        const entry = path.join(plugin.dir, "index.js");
        plugin.module = fs.existsSync(entry) ? require(entry) : {};
        if (typeof plugin.module.register === "function") plugin.module.register(this.app, plugin);
        plugin.status = "loaded";
      } catch (error) {
        plugin.status = "failed";
        plugin.error = error.message;
        this.app.errors.capture(error, { system: `plugins/${name}` });
        continue;
      }

      const previous = versions[name];
      if (previous !== manifest.version) {
        if (previous) this.app.logger.info(`ترقية الإضافة ${name}: ${previous} ← ${manifest.version}`);
        if (typeof plugin.module.upgrade === "function") {
          try {
            plugin.module.upgrade(this.app, previous || null, manifest.version);
          } catch (error) {
            this.app.errors.capture(error, { system: `plugins/${name}/upgrade` });
          }
        }
        versions[name] = manifest.version;
        changed = true;
      }
    }
    if (changed) this.app.platform.setState(VERSIONS_KEY, versions);
    this._events = null;
    this.app.logger.info(`تم تحميل ${this.loaded().length} إضافة: ${this.loaded().join(", ") || "—"}`);
  }

  loaded() {
    return this.order.filter((n) => this.plugins.get(n).status === "loaded");
  }

  get(name) {
    return this.plugins.get(name) || null;
  }

  /** معالجات أحداث ديسكورد من كل الإضافات المحمّلة: eventName -> [{ plugin, feature, handler }] */
  eventHandlers() {
    if (this._events) return this._events;
    const out = {};
    for (const name of this.loaded()) {
      const p = this.plugins.get(name);
      for (const [event, handler] of Object.entries(p.module.events || {})) {
        if (typeof handler !== "function") continue;
        (out[event] ||= []).push({ plugin: name, feature: p.manifest.feature || name, handler });
      }
    }
    this._events = out;
    return out;
  }

  /** يستخرج السيرفر من وسائط حدث ديسكورد أيًا كان شكله. */
  static guildOf(args) {
    for (const arg of args) {
      if (!arg || typeof arg !== "object") continue;
      const guild = arg.guild || arg.message?.guild || (arg.members && arg.channels && arg.id ? arg : null);
      if (guild?.id) return guild;
    }
    return null;
  }

  /** يمرّر الحدث لكل إضافة مفعّلة في هذا السيرفر، مع عزل فشل كل إضافة عن غيرها. */
  async dispatch(event, args) {
    const handlers = this.eventHandlers()[event];
    if (!handlers) return;
    const guild = PluginManager.guildOf(args);
    for (const { plugin, feature, handler } of handlers) {
      if (!this.app.features.globallyEnabled(feature)) continue;
      if (guild && !this.app.features.isEnabled(guild.id, feature)) continue;
      try {
        await handler(this.app, ...args);
      } catch (error) {
        this.app.errors.capture(error, { system: `plugins/${plugin}/${event}`, guildId: guild?.id });
      }
    }
  }

  async start() {
    for (const name of this.loaded()) {
      const mod = this.plugins.get(name).module;
      if (typeof mod.start !== "function") continue;
      try {
        await mod.start(this.app);
      } catch (error) {
        this.app.errors.capture(error, { system: `plugins/${name}/start` });
      }
    }
  }

  stop() {
    for (const name of [...this.loaded()].reverse()) {
      const mod = this.plugins.get(name).module;
      if (typeof mod.stop !== "function") continue;
      try {
        mod.stop(this.app);
      } catch (error) {
        this.app.logger.error(`فشل إيقاف الإضافة ${name}: ${error.message}`);
      }
    }
  }

  /** فحص صحة كل إضافة — يُعرض في مركز الاختبار. */
  async health() {
    const out = [];
    for (const [name, p] of this.plugins) {
      const row = { name, version: p.manifest.version, status: p.status, error: p.error, ok: p.status === "loaded" };
      if (row.ok && typeof p.module?.health === "function") {
        try {
          const result = await p.module.health(this.app);
          row.ok = result?.ok !== false;
          row.details = result?.details || null;
        } catch (error) {
          row.ok = false;
          row.error = error.message;
        }
      }
      out.push(row);
    }
    return out;
  }

  list() {
    return [...this.plugins.entries()].map(([name, p]) => ({
      name,
      version: p.manifest.version,
      description: p.manifest.description || "",
      feature: p.manifest.feature || name,
      dependencies: p.manifest.dependencies || [],
      status: p.status,
      error: p.error,
      globallyEnabled: this.app.features ? this.app.features.globallyEnabled(p.manifest.feature || name) : true
    }));
  }
}

module.exports = PluginManager;
