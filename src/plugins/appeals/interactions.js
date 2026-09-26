const { safeReply, safeUpdate, safeModal } = require("../../core/interactions/interactionSafe");
const { formatDuration } = require("../../core/utils/common");

/**
 * appeal:open:<guildId>:<type>        زر في رسالة العقوبة الخاصة (يعمل في الخاص)
 * appeal:submit:<guildId>:<caseNumber> نافذة سبب الاستئناف
 * appeal:accept|reject:<id>            أزرار المراجعة في قناة الإدارة
 */
module.exports = {
  prefix: "appeal",
  dmAllowed: true,

  async handle(interaction, app) {
    const [, action, a, b] = interaction.customId.split(":");
    const svc = app.appeals;
    const guildId = interaction.guild?.id || a;
    const t = app.i18n.forGuild(/^\d{17,20}$/.test(String(guildId)) ? guildId : null);
    const fail = (reason, vars = {}) => safeReply(interaction, { content: `${app.config.emoji("error")} ${t(`apl.err.${reason}`, vars)}`, flags: 64 });

    if (action === "open") {
      if (!/^\d{17,20}$/.test(a) || !app.client.guilds?.cache?.get(a)) return fail("disabled");
      const record = svc.latestCase(a, interaction.user.id, b);
      const check = svc.eligibility(a, interaction.user.id, record);
      if (!check.ok) return fail(check.reason, { time: check.wait ? formatDuration(check.wait) : "" });
      return safeModal(interaction, svc.modal(a, record.case_number));
    }

    if (action === "submit") {
      if (!interaction.isModalSubmit?.()) return fail("disabled");
      const caseNumber = parseInt(b, 10);
      if (!/^\d{17,20}$/.test(a) || !Number.isInteger(caseNumber)) return fail("disabled");
      const res = await svc.submit(a, interaction.user, caseNumber, interaction.fields.getTextInputValue("reason"));
      if (!res.ok) return fail(res.reason, { time: res.wait ? formatDuration(res.wait) : "" });
      return safeReply(interaction, { content: `✅ ${t("apl.submitted", { id: res.appeal.id })}`, flags: 64 });
    }

    if (action === "accept" || action === "reject") {
      if (!interaction.guild) return fail("disabled");
      const res = await svc.decide(interaction.member, parseInt(a, 10), action === "accept");
      if (!res.ok) return fail(res.reason);
      const record = app.cases.getByNumber(interaction.guild.id, res.appeal.case_number);
      return safeUpdate(interaction, svc.reviewPayload(interaction.guild.id, res.appeal, record, { decided: true }));
    }

    return fail("disabled");
  }
};
