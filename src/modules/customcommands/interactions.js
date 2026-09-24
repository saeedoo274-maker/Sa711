const { safeReply } = require("../../core/interactions/interactionSafe");

/**
 * أزرار وقوائم الأوامر المخصصة (البادئة `cc:`).
 * cc:btn:<commandId>:<index>:<version>  |  cc:sel:<commandId>:<version>
 * النسخة (updated_at) تجعل الأزرار القديمة منتهية تلقائيًا عند تعديل الأمر.
 */
module.exports = {
  prefix: "cc",
  feature: "builder",

  async handle(interaction, app) {
    const [, kind, idRaw, a, b] = interaction.customId.split(":");
    const id = parseInt(idRaw, 10);
    const expired = () => safeReply(interaction, { content: app.i18n.tg(interaction.guild.id, "ui.expired", { emoji: app.config.emoji("warning") }), flags: 64 });
    if (!Number.isInteger(id) || !["btn", "sel"].includes(kind)) return expired();

    const index = kind === "sel" ? parseInt(interaction.values?.[0], 10) : parseInt(a, 10);
    const version = kind === "sel" ? a : b;
    if (!Number.isInteger(index) || index < 0) return expired();

    const res = await app.customCommandService.componentResponse(interaction, id, index, version);
    if (!res.ok) {
      if (res.reason === "roles") {
        return safeReply(interaction, { content: `${app.config.emoji("error")} يحتاج إحدى الرتب: ${res.roles.map((r) => `<@&${r}>`).join(" ")}`, flags: 64, allowedMentions: { parse: [] } });
      }
      return expired();
    }
    return safeReply(interaction, { content: res.content || "​", flags: 64, allowedMentions: { parse: [] } });
  }
};
