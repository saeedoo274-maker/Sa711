const { extractId } = require("../utils/helpers");

/**
 * طبقة موحّدة تُخفي الفرق بين استدعاء الأمر عبر Slash أو Prefix أو بدون Prefix،
 * حتى يُكتب منطق الأمر مرة واحدة فقط ويعمل في الثلاثة.
 */
class CommandContext {
  constructor({ app, source, interaction = null, message = null, args = [], commandName = "", invokedAs = null }) {
    this.app = app;
    this.source = source; // "slash" | "prefix" | "noprefix"
    this.interaction = interaction;
    this.message = message;
    this.args = args;
    this.commandName = commandName;
    /** الاسم أو الاختصار الذي كتبه العضو فعلًا (بريفكس) — يُستخدم لتوجيه !rank إلى أمر فرعي. */
    this.invokedAs = invokedAs || commandName;
    /** الأمر الفرعي ومجموعته في وضع البريفكس — يضبطهما CommandHandler قبل التنفيذ. */
    this._sub = null;
    this._group = null;

    this.client = app.client;
    this.guild = interaction?.guild || message?.guild || null;
    this.channel = interaction?.channel || message?.channel || null;
    this.member = interaction?.member || message?.member || null;
    this.user = interaction?.user || message?.author || null;

    this._replied = false;
  }

  get isSlash() {
    return this.source === "slash";
  }

  /** لغة السيرفر الحالي (أو الافتراضية خارج السيرفرات). */
  get locale() {
    return this.app.i18n.localeFor ? this.app.i18n.localeFor(this.guild?.id) : this.app.i18n.defaultLocale;
  }

  t(key, vars = {}) {
    return this.app.i18n.t(key, { emoji: "", ...vars }, this.locale);
  }

  /** نص مترجم مع إيموجي جاهز. */
  tr(key, emojiName, vars = {}) {
    return this.app.i18n.t(key, { emoji: this.emoji(emojiName), ...vars }, this.locale);
  }

  /** لون من ثيم السيرفر إن وُجد، وإلا من الإعدادات العامة. */
  color(name) {
    if (this.app.theme && this.guild) return this.app.theme.color(this.guild.id, name);
    return this.app.config.color(name);
  }

  emoji(name) {
    if (this.app.theme && this.guild) return this.app.theme.emoji(this.guild.id, name);
    return this.app.config.emoji(name);
  }

  /** إمبيد بثيم السيرفر (اللون، التذييل، الشعار). */
  embed(opts = {}) {
    if (this.app.theme && this.guild) return this.app.theme.embed(this.guild.id, opts, this.guild);
    const { buildEmbed } = require("../utils/helpers");
    return buildEmbed({ ...opts, color: typeof opts.color === "string" ? this.app.config.color(opts.color) : opts.color });
  }

  // ---------- الأوامر الفرعية (سلاش وبريفكس) ----------

  subcommand() {
    if (this.isSlash) return this.interaction.options.getSubcommand(false);
    return this._sub;
  }

  subcommandGroup() {
    if (this.isSlash) return this.interaction.options.getSubcommandGroup(false);
    return this._group;
  }

  // ---------- قراءة المتغيرات ----------

  /** يقرأ نصًا: من خيار السلاش أو من موضع الوسيط في الرسالة. */
  getString(name, position = 0, rest = false) {
    if (this.isSlash) return this.interaction.options.getString(name);
    if (rest) return this.args.slice(position).join(" ") || null;
    return this.args[position] ?? null;
  }

  getNumber(name, position = 0) {
    if (this.isSlash) return this.interaction.options.getInteger(name);
    const value = parseInt(this.args[position], 10);
    return isNaN(value) ? null : value;
  }

  getInteger(name, position = 0) {
    return this.getNumber(name, position);
  }

  /** مرفق من خيار السلاش، أو أول مرفق في رسالة البريفكس. */
  getAttachment(name) {
    if (this.isSlash) return this.interaction.options.getAttachment(name);
    return this.message?.attachments?.first() || null;
  }

  getBoolean(name, position = 0) {
    if (this.isSlash) return this.interaction.options.getBoolean(name);
    const raw = (this.args[position] || "").toLowerCase();
    if (["نعم", "true", "yes", "1"].includes(raw)) return true;
    if (["لا", "false", "no", "0"].includes(raw)) return false;
    return null;
  }

  /** يُرجع GuildMember أو null. يقبل المنشن والآيدي الخام. */
  async getMember(name, position = 0) {
    if (this.isSlash) {
      const member = this.interaction.options.getMember(name);
      if (member) return member;
      const user = this.interaction.options.getUser(name);
      if (!user || !this.guild) return null;
      return this.guild.members.fetch(user.id).catch(() => null);
    }
    const mentioned = this.message.mentions.members?.first();
    if (mentioned) return mentioned;
    const id = extractId(this.args[position]);
    if (!id || !this.guild) return null;
    return this.guild.members.fetch(id).catch(() => null);
  }

  /** يُرجع User حتى لو كان خارج السيرفر (مطلوب لفك الحظر). */
  async getUser(name, position = 0) {
    if (this.isSlash) {
      const user = this.interaction.options.getUser(name);
      if (user) return user;
      const raw = this.interaction.options.getString(name);
      const id = extractId(raw);
      return id ? this.client.users.fetch(id).catch(() => null) : null;
    }
    const mentioned = this.message.mentions.users?.first();
    if (mentioned) return mentioned;
    const id = extractId(this.args[position]);
    return id ? this.client.users.fetch(id).catch(() => null) : null;
  }

  async getRole(name, position = 0) {
    if (this.isSlash) return this.interaction.options.getRole(name);
    const mentioned = this.message.mentions.roles?.first();
    if (mentioned) return mentioned;
    const id = extractId(this.args[position]);
    if (!id || !this.guild) return null;
    return this.guild.roles.cache.get(id) || this.guild.roles.fetch(id).catch(() => null);
  }

  async getChannel(name, position = 0) {
    if (this.isSlash) return this.interaction.options.getChannel(name);
    const mentioned = this.message.mentions.channels?.first();
    if (mentioned) return mentioned;
    const id = extractId(this.args[position]);
    if (!id || !this.guild) return null;
    return this.guild.channels.cache.get(id) || null;
  }

  // ---------- الرد ----------

  async reply(payload, { ephemeral = false } = {}) {
    const body = typeof payload === "string" ? { content: payload } : { ...payload };
    if (this.isSlash) {
      // تُدمج مع أعلام موجودة (مثل Components v2 = 32768) بدل استبدالها
      if (ephemeral) body.flags = (body.flags || 0) | 64; // MessageFlags.Ephemeral
      if (this.interaction.deferred || this.interaction.replied) {
        this._replied = true;
        return this.interaction.editReply(body).catch(() => null);
      }
      this._replied = true;
      return this.interaction.reply(body).catch(() => null);
    }
    this._replied = true;
    return this.message.reply({ ...body, allowedMentions: { repliedUser: false } }).catch(() => null);
  }

  async defer({ ephemeral = false } = {}) {
    if (this.isSlash && !this.interaction.deferred && !this.interaction.replied) {
      await this.interaction.deferReply(ephemeral ? { flags: 64 } : {}).catch(() => null);
    }
  }

  /** رد خطأ موحّد الشكل. */
  async fail(key, vars = {}) {
    return this.reply(
      { content: this.app.i18n.t(key, { emoji: this.emoji("error"), ...vars }, this.locale) },
      { ephemeral: true }
    );
  }

  async success(description, extra = {}) {
    const { buildEmbed } = require("../utils/helpers");
    return this.reply({
      embeds: [buildEmbed({ description: `${this.emoji("success")} ${description}`, color: this.color("success"), ...extra })]
    });
  }
}

module.exports = CommandContext;
