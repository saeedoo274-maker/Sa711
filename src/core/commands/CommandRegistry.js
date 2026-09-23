const fs = require("fs");
const path = require("path");

const MODULES_DIR = path.join(__dirname, "..", "..", "modules");

/**
 * سجل الأوامر.
 * كل أمر يعرّف بياناته الوصفية بنفسه (وصف، استخدام، أمثلة، صلاحية)،
 * ونظام /help يُولَّد من هذه البيانات بدل تكرارها يدويًا.
 */
class CommandRegistry {
  constructor(logger) {
    this.logger = logger;
    this.commands = new Map(); // name -> command
    this.aliases = new Map(); // alias -> name
    this.modules = new Map(); // moduleName -> [commandNames]
  }

  load() {
    this.commands.clear();
    this.aliases.clear();
    this.modules.clear();

    if (!fs.existsSync(MODULES_DIR)) return 0;

    for (const moduleName of fs.readdirSync(MODULES_DIR)) {
      const commandsDir = path.join(MODULES_DIR, moduleName, "commands");
      if (!fs.existsSync(commandsDir)) continue;

      const names = [];
      for (const file of fs.readdirSync(commandsDir)) {
        if (!file.endsWith(".js")) continue;
        const full = path.join(commandsDir, file);
        try {
          delete require.cache[require.resolve(full)];
          const exported = require(full);
          const list = Array.isArray(exported) ? [...exported] : [exported];
          // بعض ملفات الأوامر تُصدّر أيضًا قائمة سياق (Context Menu) كخاصية منفصلة
          if (exported && exported.contextMenu) list.push(exported.contextMenu);

          for (const command of list) {
            if (!this._validate(command, file)) continue;
            command.module = moduleName;
            this.commands.set(command.name, command);
            for (const alias of command.aliases || []) this.aliases.set(alias, command.name);
            names.push(command.name);
          }
        } catch (err) {
          this.logger.error(`فشل تحميل ملف الأوامر ${moduleName}/${file}: ${err.message}`);
        }
      }
      if (names.length) this.modules.set(moduleName, names);
    }

    this.logger.info(`تم تحميل ${this.commands.size} أمر من ${this.modules.size} نظام.`);
    return this.commands.size;
  }

  _validate(command, file) {
    if (!command || typeof command !== "object") {
      this.logger.warn(`تجاهل تصدير غير صالح في ${file}`);
      return false;
    }
    // قوائم السياق (Context Menu) بلا وصف نصي، فحقل description ليس مطلوبًا لها
    const required = command.isContextMenu ? ["name", "execute"] : ["name", "description", "execute"];
    for (const field of required) {
      if (!command[field]) {
        this.logger.warn(`الأمر في ${file} ينقصه الحقل المطلوب: ${field}`);
        return false;
      }
    }
    if (this.commands.has(command.name)) {
      this.logger.warn(`اسم أمر مكرر: ${command.name} (في ${file})`);
      return false;
    }
    return true;
  }

  get(nameOrAlias) {
    const key = String(nameOrAlias).toLowerCase();
    if (this.commands.has(key)) return this.commands.get(key);
    const resolved = this.aliases.get(key);
    return resolved ? this.commands.get(resolved) : null;
  }

  all() {
    return [...this.commands.values()];
  }

  byModule(moduleName) {
    return (this.modules.get(moduleName) || []).map((n) => this.commands.get(n)).filter(Boolean);
  }

  /** بيانات أوامر السلاش الجاهزة للنشر على ديسكورد. */
  slashData() {
    return this.all()
      .filter((c) => c.slash)
      .map((c) => (typeof c.slash.toJSON === "function" ? c.slash.toJSON() : c.slash));
  }
}

module.exports = CommandRegistry;
