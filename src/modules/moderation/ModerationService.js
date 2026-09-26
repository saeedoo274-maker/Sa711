const { Events } = require("../../core/events/EventBus");
const { buildEmbed, formatDuration } = require("../../core/utils/helpers");

/**
 * كل إجراء عقابي يمر من هنا:
 * فحص الهرمية → تنفيذ إجراء ديسكورد → إنشاء قضية مرقّمة → إشعار العضو → بث الحدث.
 * الأوامر والأزرار تستدعي هذه الدالة، فلا يتكرر منطق العقوبة في مكانين.
 */
class ModerationService {
  constructor(app) {
    this.app = app;
  }

  /**
   * @returns {{ok:boolean, reason?:string, case?:object, details?:string}}
   */
  async punish({ type, guild, executor, target, targetUser, reason, durationMs, extra = {} }) {
    const subject = target || targetUser;
    if (!subject) return { ok: false, reason: "memberNotFound" };

    // فحص الهرمية للأعضاء الموجودين داخل السيرفر فقط
    if (target) {
      const allowed = this.app.permissions.canActOn(executor, target);
      if (!allowed.ok) return { ok: false, reason: allowed.reason };
    }

    const finalReason = (reason || "").trim().slice(0, this.app.config.bot.limits.maxReasonLength) || null;
    const auditReason = `${executor.user.tag} :: ${finalReason || "بدون سبب"}`;

    // الإشعار الخاص يُرسل قبل الطرد/الحظر، وإلا لن يصل العضو
    if (["ban", "kick", "timeout", "warn"].includes(type)) {
      await this._notify(type, guild, subject, finalReason, durationMs).catch(() => {});
    }

    try {
      switch (type) {
        case "ban":
          await guild.members.ban(subject.id, { reason: auditReason, deleteMessageSeconds: extra.deleteSeconds || 0 });
          break;
        case "unban":
          await guild.bans.remove(subject.id, auditReason);
          break;
        case "kick":
          await target.kick(auditReason);
          break;
        case "timeout":
          await target.timeout(durationMs, auditReason);
          break;
        case "untimeout":
          await target.timeout(null, auditReason);
          break;
        case "warn":
          break; // التحذير سجلّي بحت، لا إجراء على ديسكورد
        default:
          return { ok: false, reason: "actionFailed", details: `نوع غير معروف: ${type}` };
      }
    } catch (err) {
      return { ok: false, reason: "actionFailed", details: err.message };
    }

    const record = this.app.cases.create({
      guildId: guild.id,
      type,
      targetId: subject.id,
      targetTag: (subject.user || subject).tag || (subject.user || subject).username,
      moderatorId: executor.id,
      moderatorTag: executor.user.tag,
      reason: finalReason,
      durationMs: durationMs || null
    });

    const eventMap = {
      ban: Events.MEMBER_BANNED,
      unban: Events.MEMBER_UNBANNED,
      kick: Events.MEMBER_KICKED,
      timeout: Events.MEMBER_TIMEOUT,
      untimeout: Events.MEMBER_UNTIMEOUT,
      warn: Events.MEMBER_WARNED
    };
    this.app.bus.emitSafe(eventMap[type] || Events.CASE_CREATED, { guild, case: record, executor, target: subject });

    return { ok: true, case: record };
  }

  async _notify(type, guild, subject, reason, durationMs) {
    if (!this.app.guildConfig.value(guild.id, "moderation.dmOnPunish")) return;
    const user = subject.user || subject;
    if (!user || typeof user.send !== "function") return;

    const key = `moderation.${type}.dm`;
    const text = this.app.i18n.t(key, { guild: guild.name, duration: formatDuration(durationMs) });
    if (text === key) return; // لا توجد رسالة معرّفة لهذا النوع

    const fields = [];
    if (reason) fields.push({ name: this.app.i18n.t("common.reason"), value: reason });
    if (durationMs) fields.push({ name: this.app.i18n.t("common.duration"), value: formatDuration(durationMs) });

    // زر الاستئناف (إن كانت إضافة الاستئنافات مفعّلة ومضبوطة لهذا النوع)
    const components = this.app.appeals ? this.app.appeals.dmComponents(guild, type) : [];
    await user.send({
      embeds: [buildEmbed({ description: text, color: this.app.config.color("danger"), fields })],
      components
    });
  }
}

module.exports = ModerationService;
