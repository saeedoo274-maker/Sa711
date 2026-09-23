/**
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");
 * تشغيل مكوّنات الإمبيدات المنشورة.
 *
 * `customId` يحمل معرّف الإمبيد ورقم المكوّن فقط — لا يحمل الإجراء نفسه.
 * الإجراء يُقرأ من قاعدة البيانات وقت الضغط، فلا يمكن تزوير التفاعل
 * للحصول على رتبة أو إمبيد غير مُعرَّف في اللوحة أصلًا.
 */
module.exports = {
  prefix: "ce",

  async handle(interaction, app) {
    const [, kind, embedId, indexRaw, optionRaw] = interaction.customId.split(":");

    const record = app.embeds.get(embedId);
    if (!record || record.guild_id !== interaction.guild.id) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذه اللوحة لم تعد موجودة.`, flags: 64 });
    }

    const index = parseInt(indexRaw, 10);
    const component = (record.components || [])[index];
    if (!component) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} هذا العنصر لم يعد فعّالًا.`, flags: 64 });
    }

    if (kind === "btn") {
      return app.embedService.runAction(interaction, component.action);
    }

    if (kind === "sel") {
      const chosen = parseInt(interaction.values?.[0] ?? optionRaw, 10);
      const option = (component.options || [])[chosen];
      if (!option) {
        return safeReply(interaction, { content: `${app.config.emoji("warning")} هذا الخيار لم يعد متاحًا.`, flags: 64 });
      }
      return app.embedService.runAction(interaction, option.action);
    }
  }
};
