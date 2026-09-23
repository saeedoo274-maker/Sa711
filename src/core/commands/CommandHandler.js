const CommandContext = require("./CommandContext");
const { Level } = require("../permissions/PermissionService");

/**
 * نقطة التنفيذ الموحّدة للأوامر.
 * كل مسار (سلاش / بريفكس / بدون بريفكس) يمر بنفس سلسلة الفحوصات:
 * وضع الصيانة → تفعيل النظام → تعطيل الأمر → الصلاحيات → التبريد → التنفيذ.
 */
class CommandHandler {
  constructor(app) {
    this.app = app;
    this.cooldowns = new Map(); // `${userId}:${command}` -> timestamp
  }

  // ---------------- Slash ----------------
  async handleInteraction(interaction) {
    const command = this.app.registry.get(interaction.commandName);
    if (!command) return;

    const ctx = new CommandContext({
      app: this.app,
      source: "slash",
      interaction,
      commandName: command.name
    });
    await this._run(command, ctx);
  }

  // ---------------- Prefix / No-Prefix ----------------
  async handleMessage(message) {
    if (message.author.bot || !message.guild) return;

    const cfg = this.app.guildConfig.get(message.guild.id);
    const content = message.content.trim();
    if (!content) return;

    const prefix = cfg.prefix || this.app.config.bot.defaultPrefix;

    // الأوامر المخصصة تُفحص أولًا لأن لكل أمر بريفكس خاص قد يختلف عن بريفكس السيرفر
    const custom = this.app.customCommandService.match(message.guild.id, content, prefix);
    if (custom) {
      try {
        const handled = await this.app.customCommandService.run(message, custom.command);
        if (handled) return;
      } catch (error) {
        this.app.errors.capture(error, {
          system: "builder/customCommands",
          command: custom.command.name,
          guildId: message.guild.id,
          userId: message.author.id
        });
        return;
      }
    }

    let commandName = null;
    let args = [];
    let source = null;

    if (cfg.commands.prefixEnabled && content.startsWith(prefix)) {
      const parts = content.slice(prefix.length).trim().split(/\s+/);
      commandName = (parts.shift() || "").toLowerCase();
      args = parts;
      source = "prefix";
    } else if (cfg.commands.noPrefix?.enabled) {
      // نظام بدون بريفكس: مقيّد بقنوات محددة ومستوى صلاحية أدنى،
      // ولا يستجيب إلا لاسم أمر معروف حتى لا يتعارض مع المحادثة العادية.
      const parts = content.split(/\s+/);
      const candidate = (parts[0] || "").toLowerCase();
      const known = this.app.registry.get(candidate);
      if (!known) return;

      const allowed = cfg.commands.noPrefix.allowedChannels || [];
      if (allowed.length && !allowed.includes(message.channel.id)) return;

      const level = this.app.permissions.resolveLevel(message.member);
      if (level < (cfg.commands.noPrefix.minLevel ?? Level.ADMIN)) return;

      commandName = candidate;
      args = parts.slice(1);
      source = "noprefix";
    }

    if (!commandName) return;

    const command = this.app.registry.get(commandName);
    if (!command) return;
    if (command.slashOnly) return;

    const ctx = new CommandContext({ app: this.app, source, message, args, commandName: command.name, invokedAs: commandName });
    if (!this._routePrefixSubcommand(command, ctx)) return;
    await this._run(command, ctx);
  }

  // ---------------- سلسلة التنفيذ ----------------
  /**
   * يوجّه أوامر البريفكس ذات الأوامر الفرعية:
   *   !مستوى top      ← الوسيط الأول اسم أمر فرعي (أو اختصاره في subAliases)
   *   !rank           ← اختصار مربوط بأمر فرعي عبر aliasRoutes
   *   !اعداد theme set ← مجموعة ثم أمر فرعي
   * الأوامر بلا أوامر فرعية تمر كما هي بلا أي تغيير.
   * يُرجع false إذا عُرض خطأ للمستخدم ويجب التوقف.
   */
  _routePrefixSubcommand(command, ctx) {
    const tree = CommandHandler.subcommandTree(command);
    if (!tree) return true;

    const route = command.aliasRoutes?.[String(ctx.invokedAs).toLowerCase()];
    if (route) {
      ctx._group = route.group || null;
      ctx._sub = route.sub || null;
      return true;
    }

    const aliases = command.subAliases || {};
    const norm = (t) => {
      const token = String(t || "").toLowerCase();
      return aliases[token] || token;
    };
    const first = norm(ctx.args[0]);
    if (tree.groups[first]) {
      const second = norm(ctx.args[1]);
      if (tree.groups[first].includes(second)) {
        ctx._group = first;
        ctx._sub = second;
        ctx.args = ctx.args.slice(2);
        return true;
      }
    } else if (tree.subs.includes(first)) {
      ctx._sub = first;
      ctx.args = ctx.args.slice(1);
      return true;
    }

    if (command.defaultSubcommand) {
      ctx._sub = command.defaultSubcommand;
      return true;
    }

    const list = [...tree.subs, ...Object.entries(tree.groups).map(([g, subs]) => `${g} <${subs.join("|")}>`)];
    ctx.reply({ content: `${ctx.emoji("warning")} ${ctx.t("common.chooseSubcommand")}\n\`${list.join("` `")}\`` }).catch(() => {});
    return false;
  }

  /** شجرة الأوامر الفرعية من تعريف السلاش (تُحسب مرة وتُخزَّن على الأمر). */
  static subcommandTree(command) {
    if (command._subTree !== undefined) return command._subTree;
    let tree = null;
    try {
      const json = command.slash ? (typeof command.slash.toJSON === "function" ? command.slash.toJSON() : command.slash) : null;
      const options = json?.options || [];
      if (options.some((o) => o.type === 1 || o.type === 2)) {
        tree = { subs: [], groups: {} };
        for (const o of options) {
          if (o.type === 1) tree.subs.push(o.name);
          if (o.type === 2) tree.groups[o.name] = (o.options || []).map((x) => x.name);
        }
      }
    } catch {
      tree = null;
    }
    Object.defineProperty(command, "_subTree", { value: tree, enumerable: false, configurable: true });
    return tree;
  }

  async _run(command, ctx) {
    try {
      // 1) وضع الصيانة (عام / للنظام / للأمر) — المطورون يتجاوزونه
      const maintenance = this.app.maintenanceService
        ? this.app.maintenanceService.check({ module: command.module, command: command.name, userId: ctx.user.id })
        : { blocked: this.app.maintenance && !this.app.permissions.isDeveloper(ctx.user.id) };
      if (maintenance.blocked) {
        return ctx.reply(
          { content: maintenance.message ? `${ctx.emoji("warning")} ${maintenance.message}` : ctx.tr("developer.maintenanceActive", "warning") },
          { ephemeral: true }
        );
      }

      // إضافة فشل تحميلها: أوامرها موجودة في السجل لكن خدماتها غير جاهزة
      if (command.plugin) {
        const plugin = this.app.plugins?.get(command.plugin);
        if (!plugin || plugin.status !== "loaded") return ctx.fail("errors.systemDisabled", { system: command.plugin });
      }

      // 2) داخل السيرفرات فقط
      if (!ctx.guild || !ctx.member) return ctx.fail("errors.guildOnly");

      // 3) حماية البوت والاستضافة من إغراق الأوامر
      const guard = this.app.abuseGuard.check(ctx.guild, ctx.user.id);
      if (!guard.allowed) {
        if (guard.silent) return; // تجاهل صامت: الرد نفسه يستهلك موارد
        return ctx.fail("errors.cooldown", { seconds: 60 });
      }
      this.app.oversight.recordUsage(ctx.guild.id);

      const cfg = this.app.guildConfig.get(ctx.guild.id);

      // 3) الأمر معطّل في هذا السيرفر
      if ((cfg.commands.disabled || []).includes(command.name)) {
        return ctx.fail("errors.commandDisabled");
      }

      // 4) النظام نفسه معطّل — علم الميزة (عام أو للسيرفر) ثم العلم القديم الخاص بالنظام
      const feature = command.feature || command.module;
      if (this.app.features && feature && !this.app.features.isEnabled(ctx.guild.id, feature)) {
        return ctx.fail("errors.systemDisabled", { system: feature });
      }
      if (command.systemFlag) {
        const enabled = this.app.guildConfig.value(ctx.guild.id, command.systemFlag);
        if (enabled === false) return ctx.fail("errors.systemDisabled", { system: command.module });
      }

      // 5) الصلاحيات — تُفحص من الخادم دائمًا
      const permission = this.app.permissions.check(ctx.member, command.permissions || {});
      if (!permission.ok) return ctx.fail(`errors.${permission.reason}`);

      // 6) صلاحيات البوت نفسه
      if (command.botPermissions?.length) {
        const botCheck = this.app.permissions.botHas(ctx.guild, command.botPermissions);
        if (!botCheck.ok) {
          return ctx.fail("errors.missingBotPermission", { permission: botCheck.missing.join(", ") });
        }
      }

      // 7) التبريد — المطورون معفيّون
      if (!this.app.permissions.isDeveloper(ctx.user.id)) {
        const remaining = this._cooldown(ctx.user.id, command);
        if (remaining > 0) return ctx.fail("errors.cooldown", { seconds: remaining });
      }

      await command.execute(ctx);
    } catch (error) {
      const { userMessage } = this.app.errors.capture(error, {
        system: command.module || "commands",
        command: command.name,
        guildId: ctx.guild?.id,
        userId: ctx.user?.id
      });
      await ctx.reply({ content: userMessage }, { ephemeral: true }).catch(() => {});
    }
  }

  _cooldown(userId, command) {
    const ms = command.cooldown ?? this.app.config.bot.limits?.defaultCooldownMs ?? 3000;
    if (!ms) return 0;
    const key = `${userId}:${command.name}`;
    const last = this.cooldowns.get(key) || 0;
    const now = Date.now();
    if (now - last < ms) return Math.ceil((ms - (now - last)) / 1000);
    this.cooldowns.set(key, now);
    // الخريطة كانت تنمو بلا حد مع كل عضو وأمر — تنظيف دوري للمنتهي
    if (this.cooldowns.size > 5000) this._pruneCooldowns(now);
    return 0;
  }

  _pruneCooldowns(now = Date.now()) {
    // أطول تبريد معقول دقائق معدودة؛ ما مضى عليه ساعة لم يعد مؤثرًا قطعًا
    for (const [key, at] of this.cooldowns) {
      if (now - at > 3_600_000) this.cooldowns.delete(key);
    }
  }
}

module.exports = CommandHandler;
