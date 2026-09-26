const { Events } = require("../../core/events/EventBus");
const { formatDuration, truncate } = require("../../core/utils/common");

const NAME_RE = /^[\p{L}\p{N} _-]{2,32}$/u;
const DAY = 86_400_000;

/**
 * إدارة الطاقم المتقدمة. تبني على الأنظمة الموجودة بدل تكرارها:
 * السلم الإداري (StaffService) للرتب، staff_activity والحضور اليومي (staff_checkins)
 * للنشاط، وإحصاءات التذاكر من tickets-plus — وتضيف الأقسام والمناوبات والتقييمات والسجل.
 */
class StaffPlusService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  config(guildId) {
    return { maxShiftHours: 12, maxDepartments: 20, ...(this.app.guildConfig.value(guildId, "staffPlus") || {}) };
  }

  isStaff(member) {
    return this.app.permissions.resolveLevel(member) >= 1;
  }

  onRankEvent(direction, { guild, executor, target, details }) {
    if (!guild || !target) return;
    this.repo.recordRank(guild.id, target.id, executor?.id || null, direction, details || null);
  }

  // ---------------- الأقسام ----------------

  async createDepartment(guild, actor, { name, role = null, lead = null }) {
    const clean = String(name || "").trim();
    if (!NAME_RE.test(clean)) return { ok: false, reason: "badName" };
    if (this.repo.countDepartments(guild.id) >= this.config(guild.id).maxDepartments) return { ok: false, reason: "maxDepartments" };
    if (role && (role.managed || role.position >= guild.members.me.roles.highest.position)) return { ok: false, reason: "roleHierarchy" };
    const dept = this.repo.createDepartment(guild.id, clean, role?.id || null, lead?.id || null);
    if (!dept) return { ok: false, reason: "exists" };
    this.app.bus.emitSafe("staff:department", { guild, actorId: actor.id, details: `+ ${clean}` });
    return { ok: true, department: dept };
  }

  /** نقل إداري لقسم (أو إخراجه) مع مزامنة رتبة القسم إن وُجدت. */
  async assignDepartment(guild, actor, member, name) {
    if (!this.isStaff(member)) return { ok: false, reason: "notStaff" };
    const dept = name ? this.repo.department(guild.id, name) : null;
    if (name && !dept) return { ok: false, reason: "notFound" };
    const prev = this.repo.setMemberDepartment(guild.id, member.id, dept?.id ?? null);
    const me = guild.members.me;
    const manage = (roleId) => {
      const role = roleId ? guild.roles.cache.get(roleId) : null;
      return role && !role.managed && role.position < me.roles.highest.position ? role : null;
    };
    const oldRole = manage(prev?.role_id);
    const newRole = manage(dept?.role_id);
    if (oldRole && oldRole.id !== newRole?.id) await member.roles.remove(oldRole, "تغيير قسم").catch(() => {});
    if (newRole) await member.roles.add(newRole, "تغيير قسم").catch(() => {});
    this.app.bus.emitSafe("staff:department", { guild, target: member, actorId: actor.id, details: `${prev?.name || "—"} ← ${dept?.name || "—"}` });
    return { ok: true, from: prev, to: dept };
  }

  // ---------------- المناوبات ----------------

  startShift(guild, member) {
    if (!this.isStaff(member)) return { ok: false, reason: "notStaff" };
    const shift = this.repo.startShift(guild.id, member.id);
    if (!shift) return { ok: false, reason: "alreadyOnShift" };
    const maxMs = this.config(guild.id).maxShiftHours * 3_600_000;
    this.app.scheduler.schedule({ type: "staff:shiftTimeout", guildId: guild.id, uniqueKey: `shift:${shift.id}`, runAt: shift.started_at + maxMs, payload: { id: shift.id } });
    this.app.bus.emitSafe("staff:shift", { guild, target: member, actorId: member.id, details: "▶️ بدء مناوبة" });
    return { ok: true, shift };
  }

  toggleBreak(guild, member) {
    const shift = this.repo.openShift(guild.id, member.id);
    if (!shift) return { ok: false, reason: "noShift" };
    if (shift.status === "active") return this.repo.startBreak(shift.id) ? { ok: true, onBreak: true } : { ok: false, reason: "changed" };
    return this.repo.endBreak(shift.id) ? { ok: true, onBreak: false } : { ok: false, reason: "changed" };
  }

  endShift(guild, member, endedBy = null) {
    const shift = this.repo.openShift(guild.id, member.id);
    if (!shift) return { ok: false, reason: "noShift" };
    if (!this.repo.endShift(shift.id, endedBy || member.id)) return { ok: false, reason: "changed" };
    this.app.scheduler.cancelByKey(`shift:${shift.id}`);
    const done = this.repo.shift(shift.id);
    const worked = done.ended_at - done.started_at - done.break_ms;
    this.app.bus.emitSafe("staff:shift", { guild, target: member, actorId: endedBy || member.id, details: `⏹️ ${formatDuration(worked)} (استراحة ${formatDuration(done.break_ms)})` });
    return { ok: true, shift: done, workedMs: worked };
  }

  /** مهمة المجدول: إنهاء مناوبة نُسي إغلاقها. */
  timeoutShift(id) {
    const shift = this.repo.shift(id);
    if (!shift || shift.status === "ended") return;
    if (this.repo.endShift(id, "auto")) {
      const guild = this.app.client.guilds?.cache?.get(shift.guild_id);
      this.app.bus.emitSafe("staff:shift", { guild, userId: shift.user_id, details: "⏹️ إنهاء تلقائي (تجاوز الحد)" });
    }
  }

  // ---------------- التقييمات ----------------

  evaluate(guild, evaluator, member, score, notes) {
    if (!this.isStaff(member)) return { ok: false, reason: "notStaff" };
    if (member.id === evaluator.id) return { ok: false, reason: "self" };
    if (!Number.isInteger(score) || score < 1 || score > 10) return { ok: false, reason: "badScore" };
    const last = this.repo.lastEvaluationBy(guild.id, member.id, evaluator.id);
    if (Date.now() - last < DAY) return { ok: false, reason: "tooSoon" };
    this.repo.addEvaluation(guild.id, member.id, evaluator.id, score, notes ? String(notes).slice(0, 500) : null);
    this.app.bus.emitSafe("staff:evaluation", { guild, target: member, actorId: evaluator.id, details: `${score}/10${notes ? ` — ${truncate(notes, 200)}` : ""}` });
    return { ok: true };
  }

  // ---------------- مؤشرات الأداء ----------------

  kpis(guildId, userId, days = 30) {
    const since = Date.now() - days * DAY;
    const weights = this.app.guildConfig.value(guildId, "staff.points") || {};
    const points = this.app.activity.points(guildId, userId, days, weights);
    const activity = this.app.activity.summary(guildId, userId, days);
    const shifts = this.repo.shiftStats(guildId, userId, since);
    const evals = this.repo.evaluationStats(guildId, userId, since);
    const attendance = this.app.activity.checkInCount(guildId, userId, days);
    const tickets = this.app.ticketsPlusRepo ? this.app.ticketsPlusRepo.staffStats(guildId, since, userId)[0] || null : null;
    return {
      days,
      points: points.total,
      messages: activity.messages,
      voiceSeconds: activity.voice_seconds,
      attendanceDays: attendance,
      attendanceRate: Math.round((attendance / days) * 100),
      shifts: shifts.shifts,
      workedMs: shifts.workedMs,
      breakMs: shifts.breakMs,
      evaluations: evals.count,
      evaluationAvg: evals.avg ? Math.round(evals.avg * 10) / 10 : null,
      ticketsClosed: tickets?.closed ?? activity.tickets_closed,
      avgResponseMs: tickets?.avgResponse ?? null,
      rating: tickets?.rating ? Math.round(tickets.rating * 10) / 10 : null
    };
  }

  profilePayload(guild, member, days = 30) {
    const t = this.app.i18n.forGuild(guild.id);
    const k = this.kpis(guild.id, member.id, days);
    const rank = this.app.staffService.currentRank(member);
    const dept = this.repo.memberDepartment(guild.id, member.id);
    const open = this.repo.openShift(guild.id, member.id);
    const history = this.repo.rankHistory(guild.id, member.id, 5).map((h) => `${h.direction === "promote" ? "⬆️" : "⬇️"} <t:${Math.floor(h.created_at / 1000)}:d> ${truncate(h.details || "", 80)}${h.actor_id ? ` — <@${h.actor_id}>` : ""}`);
    const evals = this.repo.evaluations(guild.id, member.id, 3).map((e) => `⭐ ${e.score}/10 — <@${e.evaluator_id}>${e.notes ? `: ${truncate(e.notes, 80)}` : ""}`);
    const f = (ms) => (ms ? formatDuration(ms) : "—");
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `👥 ${t("stf.profileTitle", { user: member.displayName || member.user.username })}`,
        color: "primary",
        fields: [
          { name: t("stf.rank"), value: rank ? `**${rank.name}**` : "—", inline: true },
          { name: t("stf.department"), value: dept ? `**${dept.name}**` : "—", inline: true },
          { name: t("stf.shiftNow"), value: open ? `${open.status === "break" ? "☕" : "🟢"} <t:${Math.floor(open.started_at / 1000)}:R>` : "⚪", inline: true },
          { name: `📊 KPI (${days}d)`, value: [
            `⭐ ${t("stf.points")}: **${k.points}**`,
            `📅 ${t("stf.attendance")}: ${k.attendanceDays}/${days} (${k.attendanceRate}%)`,
            `⏱️ ${t("stf.worked")}: ${f(k.workedMs)} • ${k.shifts} ${t("stf.shifts")}`,
            `💬 ${k.messages} • 🔊 ${f(k.voiceSeconds * 1000)}`,
            `🎫 ${k.ticketsClosed} • ⚡ ${f(k.avgResponseMs)}${k.rating ? ` • ⭐ ${k.rating}` : ""}`,
            `📝 ${t("stf.evaluations")}: ${k.evaluations}${k.evaluationAvg ? ` (${k.evaluationAvg}/10)` : ""}`
          ].join("\n") },
          { name: t("stf.history"), value: history.join("\n").slice(0, 1024) || "—" },
          { name: t("stf.recentEvals"), value: evals.join("\n").slice(0, 1024) || "—" }
        ]
      })],
      allowedMentions: { parse: [] }
    };
  }

  departmentsPayload(guild) {
    const t = this.app.i18n.forGuild(guild.id);
    const onShift = new Set(this.repo.onShift(guild.id).map((s) => s.user_id));
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `🏢 ${t("stf.departmentsTitle")}`,
        color: "info",
        description: this.repo.departments(guild.id).map((d) => {
          const members = this.repo.departmentMembers(d.id, 50);
          const active = members.filter((u) => onShift.has(u)).length;
          return `**${d.name}**${d.role_id ? ` <@&${d.role_id}>` : ""}${d.lead_id ? ` — 👑 <@${d.lead_id}>` : ""}\n👥 ${d.members} • 🟢 ${active}`;
        }).join("\n\n") || t("ui.empty")
      })],
      allowedMentions: { parse: [] }
    };
  }

  onShiftPayload(guild) {
    const t = this.app.i18n.forGuild(guild.id);
    const rows = this.repo.onShift(guild.id);
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `🟢 ${t("stf.onShiftTitle", { count: rows.length })}`,
        color: "success",
        description: rows.map((s) => `${s.status === "break" ? "☕" : "🟢"} <@${s.user_id}> — <t:${Math.floor(s.started_at / 1000)}:R>`).join("\n") || t("ui.empty")
      })],
      allowedMentions: { parse: [] }
    };
  }
}

StaffPlusService.EVENTS = { promote: Events.STAFF_PROMOTED, demote: Events.STAFF_DEMOTED };

module.exports = StaffPlusService;
