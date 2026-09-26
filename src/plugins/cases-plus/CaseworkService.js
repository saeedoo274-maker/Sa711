const { AttachmentBuilder } = require("discord.js");
const { validateUrl } = require("../../core/utils/safeFetch");
const { truncate, formatDuration } = require("../../core/utils/common");

const PRIORITIES = ["low", "normal", "high", "urgent"];
const KIND_EMOJI = { note: "🗒️", evidence: "📎", status: "🔁", link: "🔗", assign: "👤", priority: "⚡", escalate: "🚨", sla: "⏰", created: "📁", appeal: "📨" };

/**
 * إدارة القضايا والبلاغات. تعمل فوق جدولي cases وadmin_reports الموجودين
 * (لا نسخ للبيانات): الملاحظات والأدلة والروابط في جداول جانبية، والخط الزمني
 * يُجمَّع عند العرض من كل المصادر (القضية، الملاحظات، سجل الأدلة، الاستئنافات).
 */
class CaseworkService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  static get PRIORITIES() {
    return PRIORITIES;
  }

  config(guildId) {
    return { reportSlaHours: 24, maxNotesPerCase: 100, ...(this.app.guildConfig.value(guildId, "casework") || {}) };
  }

  _roomFor(guildId, scope, ref) {
    return this.repo.countNotes(guildId, scope, ref) < this.config(guildId).maxNotesPerCase;
  }

  // ---------------- القضايا ----------------

  addNote(guildId, caseNumber, authorId, text) {
    const content = String(text || "").trim().slice(0, 1000);
    if (!content) return { ok: false, reason: "empty" };
    if (!this._roomFor(guildId, "case", caseNumber)) return { ok: false, reason: "full" };
    this.repo.addNote({ guildId, scope: "case", ref: caseNumber, authorId, kind: "note", content });
    return { ok: true };
  }

  addEvidence(guildId, caseNumber, authorId, urls) {
    const list = [...new Set(urls)].filter((u) => validateUrl(u).ok).slice(0, 10);
    if (!list.length) return { ok: false, reason: "noLinks" };
    if (!this._roomFor(guildId, "case", caseNumber)) return { ok: false, reason: "full" };
    this.repo.addNote({ guildId, scope: "case", ref: caseNumber, authorId, kind: "evidence", content: JSON.stringify(list) });
    return { ok: true, count: list.length };
  }

  link(guildId, a, b, userId) {
    if (a === b) return { ok: false, reason: "self" };
    if (!this.app.cases.getByNumber(guildId, b)) return { ok: false, reason: "notFound" };
    if (!this.repo.link(guildId, a, b, userId)) return { ok: false, reason: "exists" };
    this.repo.addNote({ guildId, scope: "case", ref: a, authorId: userId, kind: "link", content: `+#${b}` });
    this.repo.addNote({ guildId, scope: "case", ref: b, authorId: userId, kind: "link", content: `+#${a}` });
    return { ok: true };
  }

  unlink(guildId, a, b, userId) {
    if (!this.repo.unlink(guildId, a, b)) return { ok: false, reason: "notLinked" };
    this.repo.addNote({ guildId, scope: "case", ref: a, authorId: userId, kind: "link", content: `-#${b}` });
    return { ok: true };
  }

  setStatus(guildId, caseNumber, userId, active) {
    const changed = active ? this.repo.reopen(guildId, caseNumber) : this.app.cases.deactivate(guildId, caseNumber);
    if (!changed) return { ok: false, reason: active ? "alreadyActive" : "alreadyClosed" };
    this.repo.addNote({ guildId, scope: "case", ref: caseNumber, authorId: userId, kind: "status", content: active ? "reopened" : "closed" });
    return { ok: true };
  }

  /** الخط الزمني الموحّد للقضية. */
  timeline(guildId, record) {
    const events = [{ at: record.created_at, kind: "created", actor: record.moderator_id, text: `${record.type}${record.reason ? ` — ${record.reason}` : ""}` }];
    for (const n of this.repo.notes(guildId, "case", record.case_number)) {
      let text = n.content;
      if (n.kind === "evidence") {
        try {
          text = JSON.parse(n.content).map((u, i) => `[${i + 1}](${u})`).join(" ");
        } catch {
          text = n.content;
        }
      }
      events.push({ at: n.created_at, kind: n.kind, actor: n.author_id, text });
    }
    for (const e of this.repo.evidenceForCase(guildId, record.case_number)) {
      events.push({ at: e.created_at, kind: "evidence", actor: e.officer_id, text: `سجل أدلة #${e.number}` });
    }
    for (const a of this.app.appealsRepo ? this.app.appealsRepo.forCase(guildId, record.case_number) : []) {
      events.push({ at: a.created_at, kind: "appeal", actor: a.user_id, text: `#${a.id} ${a.status}` });
    }
    return events.sort((x, y) => x.at - y.at);
  }

  casePayload(guild, record) {
    const t = this.app.i18n.forGuild(guild.id);
    const links = this.repo.links(guild.id, record.case_number);
    const lines = this.timeline(guild.id, record).slice(-15).map((e) =>
      `${KIND_EMOJI[e.kind] || "•"} <t:${Math.floor(e.at / 1000)}:d> ${e.actor ? `<@${e.actor}> ` : ""}${truncate(String(e.text || ""), 160)}`
    );
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `📁 ${t("cw.caseTitle", { number: record.case_number })}`,
        color: record.active ? "warning" : "neutral",
        fields: [
          { name: t("cw.type"), value: `\`${record.type}\``, inline: true },
          { name: t("cw.status"), value: record.active ? `🟢 ${t("cw.active")}` : `⚪ ${t("cw.closed")}`, inline: true },
          { name: t("cw.target"), value: `<@${record.target_id}>`, inline: true },
          { name: t("cw.moderator"), value: `<@${record.moderator_id}>`, inline: true },
          { name: t("cw.duration"), value: record.duration_ms ? formatDuration(record.duration_ms) : "—", inline: true },
          { name: t("cw.related"), value: links.map((n) => `\`#${n}\``).join(" ") || "—", inline: true },
          { name: t("cw.timeline"), value: lines.join("\n").slice(0, 1024) || "—" }
        ]
      })],
      allowedMentions: { parse: [] }
    };
  }

  exportCase(guildId, record) {
    const data = {
      format: "case-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      case: record,
      related: this.repo.links(guildId, record.case_number),
      timeline: this.timeline(guildId, record).map((e) => ({ ...e, at: new Date(e.at).toISOString() }))
    };
    return new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2), "utf8"), { name: `case-${record.case_number}.json` });
  }

  // ---------------- البلاغات ----------------

  onReportCreated({ guild, record }) {
    if (!guild || !record) return;
    const hours = Number(this.config(guild.id).reportSlaHours) || 0;
    this.repo.addNote({ guildId: guild.id, scope: "report", ref: record.number, authorId: record.reporter_id, kind: "created", content: null });
    if (!hours) return;
    const due = record.created_at + hours * 3_600_000;
    this.repo.updateReport(record.id, { sla_due_at: due });
    this.app.scheduler.schedule({ type: "report:sla", guildId: guild.id, uniqueKey: `report-sla:${record.id}`, runAt: due, payload: { id: record.id } });
  }

  async reportSla(id) {
    const report = this.repo.reportById(id);
    if (!report || report.status !== "pending") return;
    if (!this.repo.markReportBreached(id)) return;
    this.repo.addNote({ guildId: report.guild_id, scope: "report", ref: report.number, kind: "sla", content: "breached" });
    const t = this.app.i18n.forGuild(report.guild_id);
    await this.app.notifications.notify({
      guildId: report.guild_id,
      targets: ["staff"],
      payload: { content: `⏰ ${t("cw.reportSla", { number: report.number })}${report.assignee_id ? ` <@${report.assignee_id}>` : ""}` }
    });
  }

  assignReport(guild, report, actor, member) {
    if (report.status !== "pending") return { ok: false, reason: "decided" };
    if (member.id === report.target_id) return { ok: false, reason: "conflict" };
    if (this.app.permissions.resolveLevel(member) < 2) return { ok: false, reason: "notStaff" };
    this.repo.updateReport(report.id, { assignee_id: member.id });
    this.repo.addNote({ guildId: guild.id, scope: "report", ref: report.number, authorId: actor.id, kind: "assign", content: member.id });
    return { ok: true };
  }

  setReportPriority(guild, report, actor, priority) {
    if (!PRIORITIES.includes(priority)) return { ok: false, reason: "invalid" };
    if (report.status !== "pending") return { ok: false, reason: "decided" };
    this.repo.updateReport(report.id, { priority });
    this.repo.addNote({ guildId: guild.id, scope: "report", ref: report.number, authorId: actor.id, kind: "priority", content: priority });
    return { ok: true };
  }

  noteReport(guild, report, actor, text) {
    const content = String(text || "").trim().slice(0, 1000);
    if (!content) return { ok: false, reason: "empty" };
    if (!this._roomFor(guild.id, "report", report.number)) return { ok: false, reason: "full" };
    this.repo.addNote({ guildId: guild.id, scope: "report", ref: report.number, authorId: actor.id, kind: "note", content });
    return { ok: true };
  }

  async escalateReport(guild, report, actor, reason) {
    if (!this.repo.escalateReport(report.id)) return { ok: false, reason: report.status !== "pending" ? "decided" : "alreadyEscalated" };
    this.repo.addNote({ guildId: guild.id, scope: "report", ref: report.number, authorId: actor.id, kind: "escalate", content: reason || null });
    const cfg = this.app.lifecycleService.config(guild.id, "report");
    const channelId = cfg.upperChannelId || this.app.guildConfig.value(guild.id, "notifications.adminChannelId");
    const t = this.app.i18n.forGuild(guild.id);
    if (channelId) {
      await this.app.notifications.notify({
        guildId: guild.id, targets: ["channel"], channelId,
        payload: { content: `🚨 ${t("cw.reportEscalated", { number: report.number, user: `<@${actor.id}>` })}${reason ? `\n> ${truncate(reason, 300)}` : ""}`, allowedMentions: { parse: [] } }
      });
    }
    return { ok: true };
  }

  reportPayload(guild, report) {
    const t = this.app.i18n.forGuild(guild.id);
    const notes = this.repo.notes(guild.id, "report", report.number).slice(-12).map((n) =>
      `${KIND_EMOJI[n.kind] || "•"} <t:${Math.floor(n.created_at / 1000)}:R> ${n.author_id ? `<@${n.author_id}> ` : ""}${n.kind === "assign" ? `→ <@${n.content}>` : truncate(n.content || n.kind, 150)}`
    );
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `🚨 ${t("cw.reportTitle", { number: report.number })}`,
        color: report.status === "pending" ? (report.priority === "urgent" ? "danger" : "warning") : "neutral",
        fields: [
          { name: t("cw.status"), value: `\`${report.status}\``, inline: true },
          { name: t("cw.priority"), value: `\`${report.priority}\``, inline: true },
          { name: t("cw.assignee"), value: report.assignee_id ? `<@${report.assignee_id}>` : "—", inline: true },
          { name: t("cw.reporter"), value: `<@${report.reporter_id}>`, inline: true },
          { name: t("cw.target"), value: `<@${report.target_id}>`, inline: true },
          { name: "SLA", value: report.sla_due_at ? `${report.sla_breached ? "⛔" : "⏳"} <t:${Math.floor(report.sla_due_at / 1000)}:R>` : "—", inline: true },
          { name: t("cw.reason"), value: truncate(report.reason, 1024) },
          { name: t("cw.timeline"), value: notes.join("\n").slice(0, 1024) || "—" }
        ]
      })],
      allowedMentions: { parse: [] }
    };
  }
}

module.exports = CaseworkService;
