const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { formatDuration, truncate } = require("../../core/utils/common");

const PRIORITIES = ["low", "normal", "high", "urgent"];
const PRIORITY_EMOJI = { low: "🟢", normal: "🔵", high: "🟠", urgent: "🔴" };
const TAG_RE = /^[\p{L}\p{N}_-]{1,20}$/u;

/**
 * توسعة التذاكر: تعمل على نفس جدول tickets ونفس TicketService الموجود،
 * ولا تستبدل أي زر أو أمر قديم. كل إجراء يسجَّل في الخط الزمني للتذكرة.
 */
class TicketsPlusService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    this.awaiting = new Map(); // channelId -> { id, owner } تذاكر بانتظار أول رد من الطاقم
  }

  static get PRIORITIES() {
    return PRIORITIES;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "tickets") || {};
  }

  slaMinutes(guildId, priority) {
    const sla = { low: 1440, normal: 240, high: 60, urgent: 15, ...(this.config(guildId).sla || {}) };
    return Number(sla[priority]) || 0;
  }

  isStaff(member, ticket) {
    return this.app.ticketService.canManage(member, ticket);
  }

  loadAwaiting() {
    this.awaiting.clear();
    for (const t of this.repo.awaitingResponse()) this.awaiting.set(t.channel_id, { id: t.id, owner: t.owner_id });
  }

  // ---------------- SLA وأول رد ----------------

  onCreated({ guild, ticket }) {
    if (!guild || !ticket) return;
    const fresh = this.repo.byChannel(ticket.channel_id);
    if (!fresh) return;
    this.awaiting.set(fresh.channel_id, { id: fresh.id, owner: fresh.owner_id });
    this._scheduleSla(fresh, guild.id);
    this.repo.event(fresh, "created", fresh.owner_id);
  }

  _scheduleSla(ticket, guildId) {
    const minutes = this.slaMinutes(guildId, ticket.priority || "normal");
    if (!minutes) return;
    const due = ticket.created_at + minutes * 60_000;
    this.repo.setSla(ticket.id, due);
    if (ticket.first_response_at) return;
    this.app.scheduler.schedule({ type: "ticket:sla", guildId, uniqueKey: `ticket-sla:${ticket.id}`, runAt: Math.max(due, Date.now() + 1000), payload: { id: ticket.id } });
  }

  /** أول رسالة من الطاقم (غير صاحب التذكرة) تُسجَّل زمن الاستجابة. */
  onMessage(message) {
    if (!message.guild || message.author.bot) return;
    const pending = this.awaiting.get(message.channel.id);
    if (!pending || message.author.id === pending.owner) return;
    const ticket = this.repo.byId(pending.id);
    if (!ticket || ticket.status !== "open") {
      this.awaiting.delete(message.channel.id);
      return;
    }
    if (!this.isStaff(message.member, ticket)) return;
    if (this.repo.firstResponse(ticket.id, message.author.id, message.createdTimestamp || Date.now())) {
      this.awaiting.delete(message.channel.id);
      this.app.scheduler.cancelByKey(`ticket-sla:${ticket.id}`);
      this.repo.event(ticket, "firstResponse", message.author.id, { ms: (message.createdTimestamp || Date.now()) - ticket.created_at });
    }
  }

  async slaCheck(ticketId) {
    const ticket = this.repo.byId(ticketId);
    if (!ticket || ticket.status !== "open" || ticket.first_response_at) return;
    if (!this.repo.markBreached(ticket.id)) return;
    this.repo.event(ticket, "slaBreached");
    const guild = this.app.client.guilds?.cache?.get(ticket.guild_id);
    const t = this.app.i18n.forGuild(ticket.guild_id);
    await this.app.notifications.notify({
      guildId: ticket.guild_id,
      targets: ["staff"],
      payload: { content: `⏰ ${t("tk.slaBreached", { ticket: `<#${ticket.channel_id}>`, priority: t(`tk.priority.${ticket.priority}`) })}` }
    });
    this.app.bus.emitSafe("ticket:slaBreached", { guildId: ticket.guild_id, guild, ticket });
    if (this.config(ticket.guild_id).escalation?.autoOnBreach && guild) {
      await this.escalate(guild, ticket, guild.members.me, t("tk.autoEscalateReason"));
    }
  }

  // ---------------- الإجراءات ----------------

  async transfer(guild, ticket, actor, target) {
    if (target.user.bot) return { ok: false, reason: "invalidTarget" };
    if (!this.isStaff(target, ticket)) return { ok: false, reason: "targetNotStaff" };
    const actorLevel = this.app.permissions.resolveLevel(actor);
    if (ticket.claimed_by && ticket.claimed_by !== actor.id && actorLevel < Level.ADMIN) return { ok: false, reason: "notClaimer" };
    const maxClaims = this.config(guild.id).maxClaimsPerStaff || 0;
    if (maxClaims > 0 && this.app.tickets.activeClaims(guild.id, target.id) >= maxClaims) return { ok: false, reason: "targetBusy", max: maxClaims };
    if (!this.repo.transfer(ticket.id, ticket.claimed_by, target.id)) return { ok: false, reason: "changed" };
    const channel = guild.channels.cache.get(ticket.channel_id);
    await channel?.permissionOverwrites?.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
    this.repo.event(ticket, "transferred", actor.id, { from: ticket.claimed_by, to: target.id });
    this.app.bus.emitSafe("ticket:transferred", { guild, ticket, member: actor, staffId: target.id });
    return { ok: true };
  }

  setPriority(guild, ticket, actor, priority) {
    if (!PRIORITIES.includes(priority)) return { ok: false, reason: "invalid" };
    const minutes = this.slaMinutes(guild.id, priority);
    const due = !ticket.first_response_at && minutes ? ticket.created_at + minutes * 60_000 : null;
    this.repo.setPriority(ticket.id, priority, due);
    if (due) this.app.scheduler.schedule({ type: "ticket:sla", guildId: guild.id, uniqueKey: `ticket-sla:${ticket.id}`, runAt: Math.max(due, Date.now() + 1000), payload: { id: ticket.id } });
    this.repo.event(ticket, "priority", actor.id, { from: ticket.priority, to: priority });
    this.app.bus.emitSafe("ticket:priority", { guild, ticket, member: actor, priority });
    return { ok: true, due };
  }

  tag(ticket, actor, action, name) {
    const max = this.config(ticket.guild_id).maxTags || 10;
    const tag = String(name || "").trim().toLowerCase();
    if (!TAG_RE.test(tag)) return { ok: false, reason: "badTag" };
    const tags = new Set(ticket.tags);
    if (action === "add") {
      if (tags.size >= max && !tags.has(tag)) return { ok: false, reason: "maxTags", max };
      tags.add(tag);
    } else tags.delete(tag);
    this.repo.setTags(ticket.id, [...tags]);
    this.repo.event(ticket, action === "add" ? "tagAdded" : "tagRemoved", actor.id, { tag });
    return { ok: true, tags: [...tags] };
  }

  async assign(guild, ticket, actor, target, remove = false) {
    if (!remove && !this.isStaff(target, ticket)) return { ok: false, reason: "targetNotStaff" };
    const changed = remove ? this.repo.unassign(ticket.id, target.id) : this.repo.assign(ticket.id, target.id, actor.id);
    if (!changed) return { ok: false, reason: remove ? "notAssigned" : "alreadyAssigned" };
    const channel = guild.channels.cache.get(ticket.channel_id);
    if (channel?.permissionOverwrites) {
      if (remove && target.id !== ticket.claimed_by) await channel.permissionOverwrites.delete(target.id).catch(() => {});
      if (!remove) await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
    }
    this.repo.event(ticket, remove ? "unassigned" : "assigned", actor.id, { user: target.id });
    return { ok: true, assignees: this.repo.assignees(ticket.id) };
  }

  /** القفل يمنع صاحب التذكرة والأعضاء المضافين من الكتابة؛ الطاقم يبقى قادرًا. */
  async lock(guild, ticket, actor, locked) {
    if (!this.repo.setLocked(ticket.id, locked)) return { ok: false, reason: locked ? "alreadyLocked" : "notLocked" };
    const channel = guild.channels.cache.get(ticket.channel_id);
    const members = [ticket.owner_id, ...this.app.tickets.members(ticket.id).map((m) => m.user_id)];
    for (const id of members) {
      await channel?.permissionOverwrites?.edit(id, { SendMessages: !locked }).catch(() => {});
    }
    this.repo.event(ticket, locked ? "locked" : "unlocked", actor.id);
    return { ok: true };
  }

  /** إغلاق مؤجل مع زر إلغاء — الإغلاق الفعلي عبر المجدول (ينجو من إعادة التشغيل). */
  async scheduleClose(guild, channel, ticket, actor, delayMs, reason) {
    if (ticket.status !== "open") return { ok: false, reason: "notOpen" };
    const at = Date.now() + delayMs;
    this.repo.scheduleClose(ticket.id, at);
    this.app.scheduler.schedule({ type: "ticket:close", guildId: guild.id, uniqueKey: `ticket-close:${ticket.id}`, runAt: at, payload: { id: ticket.id, actorId: actor.id, reason } });
    this.repo.event(ticket, "closeScheduled", actor.id, { at, reason });
    const t = this.app.i18n.forGuild(guild.id);
    await channel.send({
      embeds: [this.app.theme.embed(guild.id, {
        description: `⏳ ${t("tk.closeScheduled", { time: `<t:${Math.floor(at / 1000)}:R>`, user: `<@${actor.id}>` })}${reason ? `\n> ${truncate(reason, 300)}` : ""}`,
        color: "warning"
      })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tkt:cancelclose:${ticket.id}`).setLabel(t("tk.cancelClose")).setEmoji("✋").setStyle(ButtonStyle.Secondary)
      )]
    }).catch(() => {});
    return { ok: true, at };
  }

  cancelClose(ticket, actor) {
    if (!ticket.close_scheduled_at) return { ok: false, reason: "noScheduledClose" };
    this.app.scheduler.cancelByKey(`ticket-close:${ticket.id}`);
    this.repo.scheduleClose(ticket.id, null);
    this.repo.event(ticket, "closeCancelled", actor.id);
    return { ok: true };
  }

  async runScheduledClose({ id, actorId, reason }) {
    const ticket = this.repo.byId(id);
    if (!ticket || ticket.status !== "open" || !ticket.close_scheduled_at) return;
    const guild = this.app.client.guilds?.cache?.get(ticket.guild_id);
    if (!guild) return;
    const channel = guild.channels.cache.get(ticket.channel_id) || (await this.app.client.channels.fetch(ticket.channel_id).catch(() => null));
    const actor = (await guild.members.fetch(actorId).catch(() => null)) || guild.members.me;
    const res = await this.app.ticketService.closeBy(guild, channel, ticket, actor);
    this.repo.scheduleClose(ticket.id, null);
    if (!res.ok) return;
    this.repo.event(ticket, "closed", actorId, { reason, scheduled: true });
    const t = this.app.i18n.forGuild(guild.id);
    if (channel?.send) await channel.send({ embeds: [this.app.theme.embed(guild.id, { description: `🔒 ${t("tk.closedScheduled")}`, color: "danger" })] }).catch(() => {});
    await this.app.ticketAutomation.requestRating(guild, res.ticket).catch(() => {});
  }

  async changeType(guild, ticket, actor, typeId) {
    const type = this.app.ticketTypes.get(typeId);
    if (!type || type.guild_id !== guild.id) return { ok: false, reason: "unknownType" };
    this.repo.setType(ticket.id, type.id);
    const channel = guild.channels.cache.get(ticket.channel_id);
    if (channel) {
      if (type.category_id) await channel.setParent(type.category_id, { lockPermissions: false }).catch(() => {});
      if (type.staff_role_id) await channel.permissionOverwrites?.edit(type.staff_role_id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
    }
    this.repo.event(ticket, "typeChanged", actor.id, { from: ticket.type_id, to: type.id });
    return { ok: true, type };
  }

  async escalate(guild, ticket, actor, reason) {
    if (!this.repo.escalate(ticket.id, actor.id)) return { ok: false, reason: "alreadyEscalated" };
    const cfg = this.config(guild.id).escalation || {};
    const t = this.app.i18n.forGuild(guild.id);
    const text = `🚨 ${t("tk.escalated", { ticket: `<#${ticket.channel_id}>`, user: `<@${actor.id}>` })}${reason ? `\n> ${truncate(reason, 300)}` : ""}`;
    const channelId = cfg.channelId || this.app.guildConfig.value(guild.id, "notifications.adminChannelId");
    if (channelId) {
      await this.app.notifications.notify({ guildId: guild.id, targets: ["channel"], channelId, mention: cfg.roleId ? `<@&${cfg.roleId}>` : null, payload: { content: text } });
    }
    const channel = guild.channels.cache.get(ticket.channel_id);
    if (cfg.roleId) await channel?.permissionOverwrites?.edit(cfg.roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
    this.repo.event(ticket, "escalated", actor.id, { reason });
    this.app.bus.emitSafe("ticket:escalated", { guild, ticket, member: actor, reason });
    return { ok: true };
  }

  infoPayload(guild, ticket) {
    const t = this.app.i18n.forGuild(guild.id);
    const ts = (ms, s = "R") => (ms ? `<t:${Math.floor(ms / 1000)}:${s}>` : "—");
    const type = ticket.type_id ? this.app.ticketTypes.get(ticket.type_id) : null;
    const assignees = this.repo.assignees(ticket.id);
    const timeline = this.repo.timeline(ticket.id, 10).map((e) => `${ts(e.created_at, "t")} \`${e.action}\`${e.actor_id ? ` <@${e.actor_id}>` : ""}`);
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `🎫 ${t("tk.infoTitle")} #${String(ticket.number || ticket.id).padStart(4, "0")}`,
        color: ticket.status === "open" ? "primary" : "neutral",
        fields: [
          { name: t("tk.owner"), value: `<@${ticket.owner_id}>`, inline: true },
          { name: t("tk.status"), value: `${ticket.status === "open" ? "🟢" : "🔴"} ${ticket.status}${ticket.locked ? " 🔒" : ""}`, inline: true },
          { name: t("tk.priorityLabel"), value: `${PRIORITY_EMOJI[ticket.priority]} ${t(`tk.priority.${ticket.priority}`)}`, inline: true },
          { name: t("tk.type"), value: type ? `${type.emoji || ""} ${type.label}` : "—", inline: true },
          { name: t("tk.claimer"), value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : "—", inline: true },
          { name: t("tk.assignees"), value: assignees.map((a) => `<@${a}>`).join(" ") || "—", inline: true },
          { name: t("tk.tags"), value: ticket.tags.map((x) => `\`${x}\``).join(" ") || "—", inline: true },
          { name: "SLA", value: ticket.first_response_at ? `✅ ${formatDuration(ticket.first_response_at - ticket.created_at)}` : ticket.sla_due_at ? `${ticket.sla_breached ? "⛔" : "⏳"} ${ts(ticket.sla_due_at)}` : "—", inline: true },
          { name: t("tk.escalatedLabel"), value: ticket.escalated_at ? `🚨 ${ts(ticket.escalated_at)}` : "—", inline: true },
          { name: t("tk.created"), value: ts(ticket.created_at, "f"), inline: true },
          { name: t("tk.closedLabel"), value: ticket.closed_at ? `${ts(ticket.closed_at, "f")} (${formatDuration(ticket.closed_at - ticket.created_at)})` : ticket.close_scheduled_at ? `⏳ ${ts(ticket.close_scheduled_at)}` : "—", inline: true },
          { name: t("tk.timeline"), value: timeline.join("\n").slice(0, 1024) || "—" }
        ]
      })],
      allowedMentions: { parse: [] }
    };
  }

  statsPayload(guild, userId = null, days = 30) {
    const t = this.app.i18n.forGuild(guild.id);
    const since = Date.now() - days * 86_400_000;
    const o = this.repo.overview(guild.id, since);
    const rows = this.repo.staffStats(guild.id, since, userId);
    const f = (ms) => (ms ? formatDuration(ms) : "—");
    const pr = this.repo.byPriority(guild.id).map((p) => `${PRIORITY_EMOJI[p.priority] || ""} ${p.c}`).join(" ") || "—";
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `📊 ${t("tk.statsTitle", { days })}`,
        color: "info",
        fields: [
          { name: t("tk.opened"), value: `\`${o.opened}\` (${t("tk.openNow")}: ${o.open})`, inline: true },
          { name: t("tk.avgResponse"), value: f(o.avgResponse), inline: true },
          { name: t("tk.avgClose"), value: f(o.avgClose), inline: true },
          { name: t("tk.breaches"), value: `\`${o.breaches}\` • 🚨 ${o.escalated}`, inline: true },
          { name: t("tk.openByPriority"), value: pr, inline: true },
          {
            name: t("tk.staffTable"),
            value: rows.map((r) => `<@${r.user_id}> — 🙋 ${r.claimed} • 🔒 ${r.closed} • ⏱️ ${f(r.avgResponse)} • ✅ ${f(r.avgClose)}${r.ratings ? ` • ⭐ ${Number(r.rating).toFixed(1)}` : ""}${r.breaches ? ` • ⛔ ${r.breaches}` : ""}`).join("\n").slice(0, 1024) || "—"
          }
        ]
      })],
      allowedMentions: { parse: [] }
    };
  }
}

module.exports = TicketsPlusService;
