const { buildEmbed } = require("../../core/utils/helpers");
const { Level } = require("../../core/permissions/PermissionService");
const { pending } = require("./commands/broadcast");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

const DELAY_MS = 1200; // فاصل بين الرسائل لاحترام حدود ديسكورد

module.exports = {
  prefix: "broadcast",

  async handle(interaction, app) {
    const [, action, ...rest] = interaction.customId.split(":");
    const jobId = rest.join(":");
    const job = pending.get(jobId);

    // إعادة فحص الصلاحية عند الضغط، لا الاكتفاء بفحصها وقت إنشاء الأمر
    if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
      return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
    }
    if (!job || job.userId !== interaction.user.id) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} انتهت صلاحية هذه العملية أو أنها ليست لك.`, flags: 64 });
    }

    pending.delete(jobId);

    if (action === "cancel") {
      return safeUpdate(interaction, {
        embeds: [buildEmbed({ description: `${app.config.emoji("success")} تم إلغاء الإرسال.`, color: app.config.color("neutral") })],
        components: []
      });
    }

    await safeUpdate(interaction, {
      embeds: [buildEmbed({ description: "⏳ جارٍ الإرسال...", color: app.config.color("info") })],
      components: []
    });

    let sent = 0;
    let failed = 0;

    for (const userId of job.targetIds) {
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) {
        failed++;
        continue;
      }
      try {
        await member.send(job.payload);
        sent++;
      } catch {
        // معظم الفشل سببه إغلاق الخاص، وهو أمر طبيعي ولا يوقف العملية
        failed++;
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    app.bus.emitSafe("broadcast:finished", {
      guild: interaction.guild,
      executor: interaction.member,
      details: `تم الإرسال إلى ${sent} عضو، وفشل ${failed}.`
    });

    await safeUpdate(interaction, {
      embeds: [
        buildEmbed({
          title: `${app.config.emoji("success")} اكتمل الإرسال الجماعي`,
          color: app.config.color("success"),
          fields: [
            { name: "نجح", value: `\`${sent}\``, inline: true },
            { name: "فشل", value: `\`${failed}\``, inline: true },
            { name: "الإجمالي", value: `\`${job.targetIds.length}\``, inline: true }
          ]
        })
      ]
    }).catch(() => {});
  }
};
