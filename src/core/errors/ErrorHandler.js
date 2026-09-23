const crypto = require("crypto");
const { EmbedBuilder } = require("discord.js");
const { Events } = require("../events/EventBus");

/**
 * معالج الأخطاء المركزي.
 * لا يُسمح لأي خطأ بإسقاط العملية، ولا بتسريب Stack Trace للمستخدم العادي.
 */
class ErrorHandler {
  constructor({ logger, errorRepo, config, i18n, guildConfig, bus, client }) {
    this.logger = logger;
    this.errorRepo = errorRepo;
    this.config = config;
    this.i18n = i18n;
    this.guildConfig = guildConfig;
    this.bus = bus;
    this.client = client;
  }

  static newId() {
    return crypto.randomBytes(4).toString("hex").toUpperCase();
  }

  /** يسجّل الخطأ ويُرجع نصًا آمنًا لعرضه للمستخدم. */
  capture(error, context = {}) {
    const errorId = ErrorHandler.newId();
    const message = error?.message || String(error);

    this.logger.error(`[${errorId}] ${context.system || "core"} :: ${message}`, error?.stack);

    try {
      this.errorRepo.create({
        errorId,
        guildId: context.guildId,
        userId: context.userId,
        system: context.system,
        command: context.command,
        message,
        stack: error?.stack
      });
    } catch (dbErr) {
      // فشل تسجيل الخطأ لا يجوز أن يتسبب في خطأ آخر
      this.logger.error(`تعذّر حفظ الخطأ في قاعدة البيانات: ${dbErr.message}`);
    }

    this._sendToLogChannel(errorId, message, error, context).catch(() => {});
    if (this.bus) this.bus.emitSafe(Events.ERROR_CAPTURED, { errorId, message, context });

    return {
      errorId,
      userMessage: this.i18n.t("errors.generic", { emoji: this.config.emoji("error"), errorId })
    };
  }

  async _sendToLogChannel(errorId, message, error, context) {
    if (!context.guildId || !this.client) return;
    const channelId = this.guildConfig.value(context.guildId, "logs.errors");
    if (!channelId) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(`${this.config.emoji("error")} ${this.i18n.t("logs.errorTitle")}`)
      .setColor(this.config.color("danger"))
      .addFields(
        { name: this.i18n.t("logs.errorId"), value: `\`${errorId}\``, inline: true },
        { name: this.i18n.t("logs.system"), value: `\`${context.system || "core"}\``, inline: true },
        { name: this.i18n.t("logs.command"), value: `\`${context.command || "—"}\``, inline: true },
        { name: this.i18n.t("logs.user"), value: context.userId ? `<@${context.userId}>` : "—", inline: true }
      )
      .setDescription(`\`\`\`\n${String(message).slice(0, 1000)}\n\`\`\``)
      .setTimestamp();

    // Stack Trace يذهب لقناة أخطاء خاصة بالإدارة فقط، وليس لرد المستخدم
    if (error?.stack) {
      embed.addFields({ name: "Stack", value: `\`\`\`\n${error.stack.slice(0, 900)}\n\`\`\`` });
    }

    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  /** يربط المعالجات العامة حتى لا يتوقف البوت بسبب استثناء غير ملتقط. */
  installGlobalHandlers() {
    process.on("unhandledRejection", (reason) => {
      this.capture(reason instanceof Error ? reason : new Error(String(reason)), { system: "unhandledRejection" });
    });
    process.on("uncaughtException", (err) => {
      this.capture(err, { system: "uncaughtException" });
    });
  }
}

module.exports = ErrorHandler;
