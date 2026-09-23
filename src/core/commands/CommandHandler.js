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

    const ctx = new CommandContext({ app: this.app, source, message, args, commandName: command.name });
    await this._run(command, ctx);
  }

  // ---------------- سلسلة التنفيذ ----------------
  async _run(command, ctx) {
    try {
      // 1) وضع الصيانة: المطورون فقط
      if (this.app.maintenance && !this.app.permissions.isDeveloper(ctx.user.id)) {
        return ctx.reply(
          { content: ctx.tr("developer.maintenanceActive", "warning") },
          { ephemeral: true }
        );
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

      // 4) النظام نفسه معطّل
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
    return 0;
  }
}

module.exports = CommandHandler;
