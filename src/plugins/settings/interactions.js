const { Level } = require("../../core/permissions/PermissionService");
const { safeReply } = require("../../core/interactions/interactionSafe");
const views = require("./views");

const URL_RE = /^https:\/\/\S{4,500}$/i;

/** حفظ نماذج /اعداد — الصلاحية تُفحص من جديد عند الإرسال. */
module.exports = {
  prefix: "cfg",

  async handle(interaction, app) {
    const guild = interaction.guild;
    const t = app.i18n.forGuild(guild.id);
    if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
      return safeReply(interaction, { content: t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
    }
    if (!interaction.isModalSubmit()) return safeReply(interaction, { content: t("ui.expired", { emoji: app.config.emoji("warning") }), flags: 64 });

    const [, kind, sub] = interaction.customId.split(":");
    const field = (id) => {
      try {
        return interaction.fields.getTextInputValue(id);
      } catch {
        return undefined; // الحقل غير موجود في هذا النموذج
      }
    };
    const url = (v) => (v === undefined ? undefined : v && (URL_RE.test(v) || /^\{[A-Z_]+\}$/i.test(v)) ? v : null);
    const updates = {};
    const set = (path, value) => {
      if (value !== undefined) updates[path] = value === "" ? null : value;
    };

    if (kind === "wel") {
      const base = sub === "goodbye" ? "welcome.goodbye" : "welcome";
      if (sub === "welcome" || sub === "goodbye") {
        set(`${base}.message`, field("message"));
        set(`${base}.embed.title`, field("title"));
        set(`${base}.embed.description`, field("description"));
        set(`${base}.embed.image`, url(field("image")));
        set(`${base}.embed.thumbnail`, url(field("thumbnail")));
      }
      if (sub === "dm") set("welcome.dm.message", field("dm"));
      if (sub === "image" || sub === "goodbye") {
        set(`${base}.image.title`, field("imgTitle"));
        set(`${base}.image.subtitle`, field("imgSubtitle"));
        if (sub === "image") set("welcome.image.backgroundUrl", url(field("imgBackground")));
      }
      app.guildConfig.setMany(guild.id, updates);
      return safeReply(interaction, { ...views.welcomePayload(app, guild), flags: 64 });
    }

    if (kind === "ver") {
      set("verification.title", field("title"));
      set("verification.description", field("description"));
      set("verification.buttonLabel", field("button"));
      app.guildConfig.setMany(guild.id, updates);
      // اللوحة المنشورة تُحدَّث فورًا بالنص الجديد
      const v = app.verification.config(guild.id);
      if (v.channelId && v.messageId) {
        const channel = await app.client.channels.fetch(v.channelId).catch(() => null);
        if (channel) await app.verification.publish(guild, channel).catch((err) => app.logger.debug(`تحديث لوحة التحقق فشل: ${err.message}`));
      }
      return safeReply(interaction, { ...views.verifyPayload(app, guild), flags: 64 });
    }

    return safeReply(interaction, { content: t("ui.expired", { emoji: app.config.emoji("warning") }), flags: 64 });
  }
};
