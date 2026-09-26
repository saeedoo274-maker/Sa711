const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { truncate, formatDuration } = require("../../core/utils/common");

/**
 * الاستئنافات: العضو يطلب مراجعة عقوبة مسجّلة كقضية (حظر/إسكات/تحذير).
 * القرار ذرّي (مراجع واحد فقط ينجح)، وتنفيذ القبول يمر عبر ModerationService
 * الموجود (فك الحظر/الإسكات يُنشئ قضية جديدة كالمعتاد) أو يغلق التحذير.
 */
class AppealService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  config(guildId) {
    return { channelId: null, types: ["ban", "timeout", "warn"], cooldownMs: 604_800_000, maxPerCase: 2, minReasonLength: 20, ...(this.app.guildConfig.value(guildId, "appeals") || {}) };
  }

  enabled(guildId) {
    return this.app.features.isEnabled(guildId, "appeals") && !!this.config(guildId).channelId;
  }

  t(guildId) {
    return this.app.i18n.forGuild(guildId);
  }

  /** زر الاستئناف الذي يُرفق برسالة العقوبة الخاصة (إن كان النظام مفعّلًا لهذا النوع). */
  dmComponents(guild, type) {
    if (!this.enabled(guild.id) || !this.config(guild.id).types.includes(type)) return [];
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`appeal:open:${guild.id}:${type}`).setLabel(this.t(guild.id)("apl.button")).setEmoji("📨").setStyle(ButtonStyle.Secondary)
    )];
  }

  latestCase(guildId, userId, type) {
    return this.app.cases.listByTarget(guildId, userId, { type, activeOnly: true, limit: 1 })[0] || null;
  }

  /** فحص الأهلية: القضية للعضو، فعّالة، نوعها مسموح، لا استئناف معلّق، ضمن الحد والتبريد. */
  eligibility(guildId, userId, record) {
    const cfg = this.config(guildId);
    if (!this.enabled(guildId)) return { ok: false, reason: "disabled" };
    if (!record || record.target_id !== userId) return { ok: false, reason: "noCase" };
    if (!record.active) return { ok: false, reason: "inactive" };
    if (!cfg.types.includes(record.type)) return { ok: false, reason: "type" };
    const previous = this.repo.forCase(guildId, record.case_number);
    if (previous.some((a) => a.status === "pending")) return { ok: false, reason: "pending" };
    if (previous.length >= cfg.maxPerCase) return { ok: false, reason: "max" };
    const last = this.repo.lastRejected(guildId, record.case_number);
    if (last && Date.now() - last.reviewed_at < cfg.cooldownMs) return { ok: false, reason: "cooldown", wait: cfg.cooldownMs - (Date.now() - last.reviewed_at) };
    return { ok: true };
  }

  modal(guildId, caseNumber) {
    const t = this.t(guildId);
    return new ModalBuilder()
      .setCustomId(`appeal:submit:${guildId}:${caseNumber}`)
      .setTitle(t("apl.modalTitle", { number: caseNumber }).slice(0, 45))
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("reason").setLabel(t("apl.reasonLabel").slice(0, 45)).setStyle(TextInputStyle.Paragraph)
          .setMinLength(Math.min(1000, this.config(guildId).minReasonLength)).setMaxLength(1000).setRequired(true)
      ));
  }

  async submit(guildId, user, caseNumber, reason) {
    const record = this.app.cases.getByNumber(guildId, caseNumber);
    const check = this.eligibility(guildId, user.id, record);
    if (!check.ok) return check;
    const text = String(reason || "").trim();
    if (text.length < this.config(guildId).minReasonLength) return { ok: false, reason: "short" };
    const appeal = this.repo.create({ guildId, caseNumber, userId: user.id, type: record.type, reason: text.slice(0, 1000) });
    if (!appeal) return { ok: false, reason: "pending" };
    this.app.caseworkRepo?.addNote({ guildId, scope: "case", ref: caseNumber, authorId: user.id, kind: "appeal", content: `#${appeal.id} pending` });

    const channel = await this.app.client.channels.fetch(this.config(guildId).channelId).catch(() => null);
    if (channel?.send) {
      const msg = await channel.send(this.reviewPayload(guildId, appeal, record)).catch((err) => {
        this.app.logger.warn(`تعذر نشر الاستئناف #${appeal.id}: ${err.message}`);
        return null;
      });
      if (msg) this.repo.setMessage(appeal.id, channel.id, msg.id);
    }
    this.app.bus.emitSafe("appeal:created", { guildId, guild: this.app.client.guilds?.cache?.get(guildId), appeal });
    return { ok: true, appeal };
  }

  reviewPayload(guildId, appeal, record, { decided = false } = {}) {
    const t = this.t(guildId);
    const color = appeal.status === "accepted" ? "success" : appeal.status === "rejected" ? "danger" : "warning";
    return {
      embeds: [this.app.theme.embed(guildId, {
        title: `📨 ${t("apl.reviewTitle", { id: appeal.id })}`,
        color,
        fields: [
          { name: t("apl.user"), value: `<@${appeal.user_id}> \`${appeal.user_id}\``, inline: true },
          { name: t("apl.case"), value: `#${appeal.case_number} (\`${appeal.type}\`)`, inline: true },
          { name: t("apl.status"), value: `\`${appeal.status}\`${appeal.reviewer_id ? ` — <@${appeal.reviewer_id}>` : ""}`, inline: true },
          { name: t("apl.caseReason"), value: truncate(record?.reason || "—", 1024) },
          ...(record?.duration_ms ? [{ name: t("apl.duration"), value: formatDuration(record.duration_ms), inline: true }] : []),
          { name: t("apl.appealReason"), value: truncate(appeal.reason, 1024) }
        ]
      })],
      components: decided || appeal.status !== "pending" ? [] : [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`appeal:accept:${appeal.id}`).setLabel(t("apl.accept")).setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`appeal:reject:${appeal.id}`).setLabel(t("apl.reject")).setEmoji("✖️").setStyle(ButtonStyle.Danger)
      )],
      allowedMentions: { parse: [] }
    };
  }

  /** قرار المراجع. يُرجع { ok, appeal, executed } */
  async decide(member, id, accept, note = null) {
    const appeal = this.repo.get(id);
    if (!appeal || appeal.guild_id !== member.guild.id) return { ok: false, reason: "notFound" };
    if (this.app.permissions.resolveLevel(member) < Level.MODERATOR) return { ok: false, reason: "noPermission" };
    if (appeal.user_id === member.id) return { ok: false, reason: "self" };
    if (!this.repo.decide(id, accept ? "accepted" : "rejected", member.id, note)) return { ok: false, reason: "decided" };
    const guild = member.guild;
    let executed = null;
    if (accept) {
      // القرار محفوظ بالفعل؛ فشل التنفيذ (صلاحيات/هرمية) يُسجَّل ويُبلَّغ دون التراجع عن القرار
      executed = await this._lift(guild, member, appeal).catch((err) => {
        this.app.errors.capture(err, { system: "appeals/lift", guildId: guild.id });
        return null;
      });
    }
    this.app.caseworkRepo?.addNote({ guildId: guild.id, scope: "case", ref: appeal.case_number, authorId: member.id, kind: "appeal", content: `#${appeal.id} ${accept ? "accepted" : "rejected"}` });

    const t = this.t(guild.id);
    await this.app.notifications.notify({
      guildId: guild.id, userId: appeal.user_id, category: "appeals", targets: ["dm"], force: true,
      payload: { content: `📨 ${t(accept ? "apl.dmAccepted" : "apl.dmRejected", { number: appeal.case_number, server: guild.name })}${note ? `\n> ${truncate(note, 300)}` : ""}` }
    });
    this.app.bus.emitSafe("appeal:decided", { guildId: guild.id, guild, appeal: this.repo.get(id), accepted: accept, reviewerId: member.id });
    return { ok: true, appeal: this.repo.get(id), executed };
  }

  async _lift(guild, executor, appeal) {
    const reason = `استئناف #${appeal.id} مقبول`;
    if (appeal.type === "warn") return this.app.cases.deactivate(guild.id, appeal.case_number) ? "warnRemoved" : null;
    if (appeal.type === "ban") {
      const user = await this.app.client.users.fetch(appeal.user_id).catch(() => null);
      if (!user) return null;
      const res = await this.app.moderation.punish({ type: "unban", guild, executor, targetUser: user, reason });
      if (res.ok) this.app.cases.deactivate(guild.id, appeal.case_number);
      return res.ok ? "unbanned" : null;
    }
    if (appeal.type === "timeout") {
      const target = await guild.members.fetch(appeal.user_id).catch(() => null);
      this.app.cases.deactivate(guild.id, appeal.case_number);
      if (!target) return "caseClosed";
      const res = await this.app.moderation.punish({ type: "untimeout", guild, executor, target, reason });
      return res.ok ? "untimedOut" : "caseClosed";
    }
    return null;
  }

  pendingPayload(guild) {
    const t = this.t(guild.id);
    const rows = this.repo.pending(guild.id);
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `📨 ${t("apl.pendingTitle")}`,
        color: "warning",
        description: rows.map((a) => `\`#${a.id}\` <@${a.user_id}> — #${a.case_number} \`${a.type}\` <t:${Math.floor(a.created_at / 1000)}:R>`).join("\n") || t("ui.empty")
      })],
      allowedMentions: { parse: [] }
    };
  }
}

module.exports = AppealService;
