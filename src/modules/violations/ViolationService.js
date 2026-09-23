const { PermissionFlagsBits } = require("discord.js");
const { buildEmbed, timestamp } = require("../../core/utils/helpers");

/**
 * المخالفات المالية.
 * السداد يمر عبر EconomyService، فيُخصم المبلغ فعليًا من رصيد العضو
 * ولا تُعلَّم المخالفة كمدفوعة إلا بعد نجاح الخصم.
 */
class ViolationService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "violations") || {};
  }

  enabled(guildId) {
    return !!this.config(guildId).enabled;
  }

  async issue({ guild, officer, target, kind, amount, notes }) {
    const record = this.app.violations.issue({
      guildId: guild.id,
      targetId: target.id,
      officerId: officer.id,
      kind,
      amount,
      notes
    });

    await this._maybeSuspend(guild, target);
    await this._log(guild, record, "تسجيل مخالفة", officer.id);
    await this._notify(guild, target, record);

    return record;
  }

  /**
   * السداد.
   * الترتيب مقصود: يُخصم المال أولًا، ثم تُعلَّم المخالفة مدفوعة ذرّيًا.
   * لو فشل التعليم (سداد متزامن سبقنا) يُعاد المبلغ فورًا، فلا يُخصم مرتين.
   */
  async pay({ guild, member, number }) {
    const record = this.app.violations.getByNumber(guild.id, number);
    if (!record) return { ok: false, reason: "notFound" };
    if (record.status === "paid") return { ok: false, reason: "alreadyPaid" };
    if (record.status === "cancelled") return { ok: false, reason: "cancelled" };
    if (record.target_id !== member.id) return { ok: false, reason: "notYours" };

    const charge = this.app.economyService.charge(guild.id, member.id, record.amount, {
      reason: `سداد المخالفة رقم #${record.number}`,
      refType: "violation",
      refId: record.number
    });
    if (!charge.ok) {
      const account = this.app.economyService.account(guild.id, member.id);
      return { ok: false, reason: "insufficient", account, needed: record.amount };
    }

    const marked = this.app.violations.markPaid(guild.id, number);
    if (!marked) {
      this.app.economyService.add(guild.id, member.id, record.amount, {
        reason: `استرجاع سداد مكرر للمخالفة #${record.number}`
      });
      return { ok: false, reason: "alreadyPaid" };
    }

    await this._maybeUnsuspend(guild, member);
    await this._log(guild, this.app.violations.getByNumber(guild.id, number), "سداد مخالفة", member.id);

    return { ok: true, record, account: charge.account };
  }

  async cancel({ guild, actor, number }) {
    const record = this.app.violations.getByNumber(guild.id, number);
    if (!record) return { ok: false, reason: "notFound" };
    if (!this.app.violations.cancel(guild.id, number)) return { ok: false, reason: "notUnpaid" };

    const member = await guild.members.fetch(record.target_id).catch(() => null);
    if (member) await this._maybeUnsuspend(guild, member);
    await this._log(guild, this.app.violations.getByNumber(guild.id, number), "إلغاء مخالفة", actor.id);

    return { ok: true, record };
  }

  /** رتبة إيقاف الخدمات تُعطى تلقائيًا عند تجاوز حد المخالفات غير المسددة. */
  async _maybeSuspend(guild, target) {
    const cfg = this.config(guild.id);
    if (!cfg.suspendRoleId || !cfg.autoSuspendAfter) return;

    const unpaid = this.app.violations.unpaidCount(guild.id, target.id);
    if (unpaid < cfg.autoSuspendAfter) return;

    const role = guild.roles.cache.get(cfg.suspendRoleId);
    const me = guild.members.me;
    if (!role || !me?.permissions.has(PermissionFlagsBits.ManageRoles)) return;
    if (role.position >= me.roles.highest.position || role.managed) return;
    if (target.roles.cache.has(role.id)) return;

    await target.roles.add(role, "إيقاف خدمات: مخالفات غير مسددة").catch(() => {});
  }

  /** تُسحب رتبة الإيقاف تلقائيًا حين لا تبقى مخالفات غير مسددة. */
  async _maybeUnsuspend(guild, member) {
    const cfg = this.config(guild.id);
    if (!cfg.suspendRoleId) return;
    if (this.app.violations.unpaidCount(guild.id, member.id) > 0) return;

    const role = guild.roles.cache.get(cfg.suspendRoleId);
    const me = guild.members.me;
    if (!role || !me?.permissions.has(PermissionFlagsBits.ManageRoles)) return;
    if (role.position >= me.roles.highest.position) return;
    if (!member.roles.cache.has(role.id)) return;

    await member.roles.remove(role, "سداد كل المخالفات").catch(() => {});
  }

  async _notify(guild, target, record) {
    const user = target.user || target;
    if (typeof user.send !== "function") return;
    await user.send({
      embeds: [
        buildEmbed({
          title: "⚠️ مخالفة جديدة",
          description: `سُجّلت عليك مخالفة في سيرفر **${guild.name}**`,
          color: this.app.config.color("warning"),
          fields: [
            { name: "رقم المخالفة", value: `#${record.number}`, inline: true },
            { name: "النوع", value: record.kind, inline: true },
            { name: "المبلغ", value: this.app.economyService.format(guild.id, record.amount), inline: true },
            ...(record.notes ? [{ name: "ملاحظات", value: String(record.notes).slice(0, 1000) }] : [])
          ],
          footer: "سدّدها من لوحة تسديد المخالفات"
        })
      ]
    }).catch(() => {});
  }

  async _log(guild, record, title, actorId) {
    const channelId = this.app.guildConfig.value(guild.id, "logs.violations");
    if (!channelId) return;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const colors = { unpaid: "danger", paid: "success", cancelled: "neutral" };
    const statusLabel = { unpaid: "غير مسددة", paid: "مسددة", cancelled: "ملغاة" };

    await channel.send({
      embeds: [
        buildEmbed({
          title: `⚠️ ${title}`,
          color: this.app.config.color(colors[record.status] || "warning"),
          fields: [
            { name: "الرقم", value: `#${record.number}`, inline: true },
            { name: "العضو", value: `<@${record.target_id}>`, inline: true },
            { name: "المبلغ", value: this.app.economyService.format(guild.id, record.amount), inline: true },
            { name: "النوع", value: record.kind, inline: true },
            { name: "الحالة", value: statusLabel[record.status] || record.status, inline: true },
            { name: "المنفّذ", value: `<@${actorId}>`, inline: true },
            ...(record.notes ? [{ name: "ملاحظات", value: String(record.notes).slice(0, 1000) }] : [])
          ]
        })
      ]
    }).catch(() => {});
  }

  listEmbed(guild, user, rows) {
    if (!rows.length) {
      return buildEmbed({ description: "✅ لا توجد مخالفات على هذا العضو.", color: this.app.config.color("success") });
    }
    const icons = { unpaid: "🔴", paid: "🟢", cancelled: "⚪" };
    const lines = rows.map(
      (v) =>
        `${icons[v.status] || "•"} **#${v.number}** • ${v.kind} • ${this.app.economyService.format(guild.id, v.amount)}\n` +
        `  المسجّل: <@${v.officer_id}> • ${timestamp(v.created_at, "R")}` +
        (v.notes ? `\n  ↳ ${String(v.notes).slice(0, 150)}` : "")
    );
    const outstanding = this.app.violations.unpaidTotal(guild.id, user.id);

    return buildEmbed({
      title: `⚠️ مخالفات ${user.username || user.id}`,
      description: lines.join("\n\n"),
      color: this.app.config.color(outstanding > 0 ? "danger" : "success"),
      fields: [
        { name: "غير مسددة", value: String(this.app.violations.unpaidCount(guild.id, user.id)), inline: true },
        { name: "الإجمالي المستحق", value: this.app.economyService.format(guild.id, outstanding), inline: true }
      ]
    });
  }
}

module.exports = ViolationService;
