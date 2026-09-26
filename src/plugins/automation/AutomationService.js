const crypto = require("node:crypto");
const { PermissionFlagsBits } = require("discord.js");
const { truncate } = require("../../core/utils/common");

const TRIGGERS = ["member_join", "member_leave", "message_keyword", "role_added", "voice_join", "level_up", "ticket_created", "ticket_closed", "suggestion_created", "giveaway_ended", "schedule_daily", "schedule_interval"];
const CONDITIONS = ["has_role", "missing_role", "in_channel", "min_account_days", "min_level", "chance"];
const ACTIONS = ["message", "dm", "add_role", "remove_role", "add_xp", "add_money", "react", "wait"];
// رتب تحمل هذه الصلاحيات لا تُمنح تلقائيًا أبدًا
const DANGEROUS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ModerateMembers
];
const NAME_RE = /^[\p{L}\p{N}_-]{2,32}$/u;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * منشئ الأتمتة.
 *
 * الحماية من الحلقات والإغراق:
 *  - رسائل البوتات لا تُشغِّل شيئًا
 *  - حد تشغيل لكل سيرفر في الدقيقة، وتبريد لكل أتمتة ولكل عضو
 *  - حد أقصى لعدد الخطوات، والانتظار عبر المجدول (لا مؤقتات في الذاكرة)
 *  - لا إجراءات عقابية (ليس نظام حماية/مراقبة تلقائية)، ولا منح رتب خطرة
 */
class AutomationService {
  constructor(app) {
    this.app = app;
    this.cache = new Map(); // guildId -> automations[]
    this.budget = new Map(); // guildId -> { windowStart, count }
    this.memberCooldown = new Map(); // `${id}:${userId}` -> until
  }

  static get TRIGGERS() { return TRIGGERS; }
  static get CONDITIONS() { return CONDITIONS; }
  static get ACTIONS() { return ACTIONS; }

  config(guildId) {
    return { maxAutomations: 25, maxSteps: 10, runsPerMinute: 60, ...(this.app.guildConfig.value(guildId, "automation") || {}) };
  }

  _row(r) {
    if (!r) return null;
    const p = (v, d) => {
      try {
        return JSON.parse(v);
      } catch {
        return d;
      }
    };
    return { ...r, trigger: p(r.trigger, {}), conditions: p(r.conditions, []), actions: p(r.actions, []) };
  }

  list(guildId) {
    if (!this.cache.has(guildId)) this.cache.set(guildId, this.app.db.prepare("SELECT * FROM automations WHERE guild_id = ? ORDER BY id").all(guildId).map((r) => this._row(r)));
    return this.cache.get(guildId);
  }

  get(guildId, id) {
    return this._row(this.app.db.prepare("SELECT * FROM automations WHERE guild_id = ? AND id = ?").get(guildId, id));
  }

  invalidate(guildId) {
    this.cache.delete(guildId);
  }

  // ---------------- البناء ----------------

  create(guild, member, { name, trigger, value = null, channelId = null, cooldownMs = 0 }) {
    if (!NAME_RE.test(String(name || ""))) return { ok: false, reason: "badName" };
    if (!TRIGGERS.includes(trigger)) return { ok: false, reason: "badTrigger" };
    const t = { type: trigger };
    if (trigger === "message_keyword") {
      const kw = String(value || "").trim().toLowerCase();
      if (kw.length < 2 || kw.length > 100) return { ok: false, reason: "badKeyword" };
      t.value = kw;
    } else if (trigger === "schedule_daily") {
      if (!TIME_RE.test(String(value || ""))) return { ok: false, reason: "badTime" };
      t.value = value;
      if (!channelId) return { ok: false, reason: "needChannel" };
    } else if (trigger === "schedule_interval") {
      const minutes = parseInt(value, 10);
      if (!Number.isInteger(minutes) || minutes < 10 || minutes > 10_080) return { ok: false, reason: "badInterval" };
      t.value = minutes;
      if (!channelId) return { ok: false, reason: "needChannel" };
    } else if (["role_added", "voice_join"].includes(trigger) && value) {
      t.value = String(value).match(/\d{17,20}/)?.[0] || null;
    }
    if (channelId) t.channelId = channelId;
    if (this.list(guild.id).length >= this.config(guild.id).maxAutomations) return { ok: false, reason: "max" };
    const info = this.app.db
      .prepare("INSERT OR IGNORE INTO automations (guild_id, name, trigger, cooldown_ms, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(guild.id, name, JSON.stringify(t), Math.max(0, Math.min(86_400_000, cooldownMs || 0)), member.id, Date.now());
    if (!info.changes) return { ok: false, reason: "exists" };
    this.invalidate(guild.id);
    const id = Number(info.lastInsertRowid);
    this._syncSchedule(guild.id, this.get(guild.id, id));
    return { ok: true, id };
  }

  _save(auto) {
    this.app.db.prepare("UPDATE automations SET conditions = ?, actions = ? WHERE id = ?").run(JSON.stringify(auto.conditions), JSON.stringify(auto.actions), auto.id);
    this.invalidate(auto.guild_id);
  }

  addCondition(guild, auto, { type, value = null, roleId = null, channelId = null }) {
    if (!CONDITIONS.includes(type)) return { ok: false, reason: "badCondition" };
    if (auto.conditions.length >= 10) return { ok: false, reason: "maxSteps" };
    const c = { type };
    if (type === "has_role" || type === "missing_role") {
      if (!roleId) return { ok: false, reason: "needRole" };
      c.roleId = roleId;
    } else if (type === "in_channel") {
      if (!channelId) return { ok: false, reason: "needChannel" };
      c.channelId = channelId;
    } else {
      const n = parseInt(value, 10);
      const max = type === "chance" ? 100 : type === "min_level" ? 1000 : 3650;
      if (!Number.isInteger(n) || n < 1 || n > max) return { ok: false, reason: "badValue" };
      c.value = n;
    }
    auto.conditions.push(c);
    this._save(auto);
    return { ok: true };
  }

  addAction(guild, auto, { type, value = null, role = null, channelId = null }) {
    if (!ACTIONS.includes(type)) return { ok: false, reason: "badAction" };
    if (auto.actions.length >= this.config(guild.id).maxSteps) return { ok: false, reason: "maxSteps" };
    const a = { type };
    if (type === "message" || type === "dm") {
      const text = String(value || "").trim();
      if (!text) return { ok: false, reason: "needText" };
      a.text = text.slice(0, 1800);
      if (type === "message" && channelId) a.channelId = channelId;
      if (type === "message" && !channelId && ["schedule_daily", "schedule_interval"].includes(auto.trigger.type) && !auto.trigger.channelId) return { ok: false, reason: "needChannel" };
    } else if (type === "add_role" || type === "remove_role") {
      if (!role) return { ok: false, reason: "needRole" };
      const me = guild.members.me;
      if (role.managed || role.position >= me.roles.highest.position) return { ok: false, reason: "roleHierarchy" };
      if (type === "add_role" && DANGEROUS.some((p) => role.permissions?.has?.(p))) return { ok: false, reason: "dangerousRole" };
      a.roleId = role.id;
    } else if (type === "add_xp" || type === "add_money") {
      const n = parseInt(value, 10);
      if (!Number.isInteger(n) || n < 1 || n > (type === "add_xp" ? 10_000 : 1_000_000)) return { ok: false, reason: "badValue" };
      a.amount = n;
    } else if (type === "react") {
      if (auto.trigger.type !== "message_keyword") return { ok: false, reason: "reactNeedsMessage" };
      const emoji = String(value || "").trim();
      if (!emoji || emoji.length > 64) return { ok: false, reason: "badValue" };
      a.emoji = emoji;
    } else if (type === "wait") {
      const minutes = parseInt(value, 10);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return { ok: false, reason: "badValue" };
      a.minutes = minutes;
    }
    auto.actions.push(a);
    this._save(auto);
    return { ok: true };
  }

  removeStep(auto, kind, index) {
    const list = kind === "condition" ? auto.conditions : auto.actions;
    if (index < 1 || index > list.length) return { ok: false, reason: "badValue" };
    list.splice(index - 1, 1);
    this._save(auto);
    return { ok: true };
  }

  toggle(guildId, id) {
    const auto = this.get(guildId, id);
    if (!auto) return null;
    this.app.db.prepare("UPDATE automations SET enabled = ? WHERE id = ?").run(auto.enabled ? 0 : 1, id);
    this.invalidate(guildId);
    this._syncSchedule(guildId, this.get(guildId, id));
    return !auto.enabled;
  }

  delete(guildId, id) {
    const ok = this.app.db.prepare("DELETE FROM automations WHERE guild_id = ? AND id = ?").run(guildId, id).changes === 1;
    this.app.scheduler.cancelByKey(`automation:${id}`);
    this.invalidate(guildId);
    return ok;
  }

  _syncSchedule(guildId, auto) {
    const key = `automation:${auto.id}`;
    this.app.scheduler.cancelByKey(key);
    if (!auto.enabled) return;
    if (auto.trigger.type === "schedule_daily") {
      this.app.scheduler.ensureRecurring("automation:scheduled", key, { kind: "daily", time: auto.trigger.value, tz: "UTC" }, { guildId, id: auto.id });
    } else if (auto.trigger.type === "schedule_interval") {
      this.app.scheduler.ensureRecurring("automation:scheduled", key, { kind: "interval", everyMs: auto.trigger.value * 60_000 }, { guildId, id: auto.id });
    }
  }

  // ---------------- التشغيل ----------------

  _allowRun(guildId) {
    const now = Date.now();
    const b = this.budget.get(guildId);
    if (!b || now - b.windowStart > 60_000) {
      if (this.budget.size > 5000) this.budget.clear();
      this.budget.set(guildId, { windowStart: now, count: 1 });
      return true;
    }
    if (b.count >= this.config(guildId).runsPerMinute) return false;
    b.count++;
    return true;
  }

  /** نقطة الدخول لكل المُشغِّلات. ctx: { guild, member?, user?, channel?, message?, roleId?, channelId? } */
  async fire(type, ctx) {
    const guild = ctx.guild;
    if (!guild || !this.app.features.isEnabled(guild.id, "automation")) return 0;
    const autos = this.list(guild.id).filter((a) => a.enabled && a.trigger.type === type);
    if (!autos.length) return 0;
    let ran = 0;
    for (const auto of autos) {
      if (!this._matchesTrigger(auto, ctx)) continue;
      if (!this._checkConditions(auto, ctx)) continue;
      if (!this._cooldownOk(auto, ctx)) continue;
      if (!this._allowRun(guild.id)) break;
      await this.execute(auto, ctx, 0).catch((err) => this._error(auto, err));
      ran++;
    }
    return ran;
  }

  _matchesTrigger(auto, ctx) {
    const t = auto.trigger;
    if (t.type === "message_keyword") return String(ctx.message?.content || "").toLowerCase().includes(t.value);
    if ((t.type === "role_added" || t.type === "voice_join") && t.value) return ctx.roleId === t.value || ctx.channelId === t.value;
    if (t.channelId && ["message_keyword"].includes(t.type)) return ctx.channel?.id === t.channelId;
    return true;
  }

  _checkConditions(auto, ctx) {
    const m = ctx.member;
    for (const c of auto.conditions) {
      if (c.type === "chance") {
        if (crypto.randomInt(0, 100) >= c.value) return false;
        continue;
      }
      if (c.type === "in_channel") {
        if (!ctx.channel || (ctx.channel.id !== c.channelId && ctx.channel.parentId !== c.channelId)) return false;
        continue;
      }
      if (!m) return false;
      if (c.type === "has_role" && !m.roles.cache.has(c.roleId)) return false;
      if (c.type === "missing_role" && m.roles.cache.has(c.roleId)) return false;
      if (c.type === "min_account_days" && Date.now() - (m.user.createdTimestamp || 0) < c.value * 86_400_000) return false;
      if (c.type === "min_level") {
        const level = this.app.levels && this.app.features.isEnabled(ctx.guild.id, "levels") ? this.app.levels.profile(ctx.guild.id, m.id).level : 0;
        if (level < c.value) return false;
      }
    }
    return true;
  }

  _cooldownOk(auto, ctx) {
    const now = Date.now();
    if (auto.cooldown_ms && auto.last_run_at && now - auto.last_run_at < auto.cooldown_ms) return false;
    if (auto.trigger.type === "message_keyword" && ctx.member) {
      const key = `${auto.id}:${ctx.member.id}`;
      if ((this.memberCooldown.get(key) || 0) > now) return false;
      if (this.memberCooldown.size > 20_000) this.memberCooldown.clear();
      this.memberCooldown.set(key, now + 30_000);
    }
    return true;
  }

  _error(auto, err) {
    this.app.db.prepare("UPDATE automations SET last_error = ? WHERE id = ?").run(truncate(String(err?.message || err), 300), auto.id);
    this.app.logger.debug(`أتمتة #${auto.id} فشلت: ${err?.message}`);
  }

  /** ينفّذ الإجراءات من فهرس معيّن؛ الانتظار يُكمل عبر المجدول. */
  async execute(auto, ctx, from = 0) {
    const guild = ctx.guild;
    const member = ctx.member || null;
    const vars = { member, guild, channel: ctx.channel || null };
    for (let i = from; i < auto.actions.length; i++) {
      const a = auto.actions[i];
      if (a.type === "wait") {
        this.app.scheduler.schedule({
          type: "automation:continue", guildId: guild.id, runAt: Date.now() + a.minutes * 60_000,
          payload: { guildId: guild.id, id: auto.id, from: i + 1, memberId: member?.id || null, channelId: ctx.channel?.id || null }
        });
        break;
      }
      await this._action(a, auto, ctx, vars);
    }
    if (from === 0) {
      this.app.db.prepare("UPDATE automations SET runs = runs + 1, last_run_at = ?, last_error = NULL WHERE id = ?").run(Date.now(), auto.id);
      auto.last_run_at = Date.now();
      this.app.bus.emitSafe("automation:ran", { guildId: guild.id, guild, id: auto.id, name: auto.name, userId: member?.id || null });
    }
  }

  async _action(a, auto, ctx, vars) {
    const { guild } = ctx;
    const member = ctx.member;
    const fill = (text) => truncate(this.app.embedService.replaceVariables(text, vars), 2000);
    switch (a.type) {
      case "message": {
        const channelId = a.channelId || auto.trigger.channelId || ctx.channel?.id;
        const channel = channelId ? guild.channels.cache.get(channelId) || (await this.app.client.channels.fetch(channelId).catch(() => null)) : null;
        if (channel?.send) await channel.send({ content: fill(a.text), allowedMentions: { parse: ["users"] } });
        break;
      }
      case "dm":
        if (member) await member.send({ content: fill(a.text), allowedMentions: { parse: [] } }).catch(() => {});
        break;
      case "add_role":
      case "remove_role": {
        const role = guild.roles.cache.get(a.roleId);
        const me = guild.members.me;
        if (!member || !role || role.managed || role.position >= me.roles.highest.position) break;
        if (a.type === "add_role" && DANGEROUS.some((p) => role.permissions?.has?.(p))) break;
        if (a.type === "add_role" && !member.roles.cache.has(role.id)) await member.roles.add(role, `أتمتة: ${auto.name}`);
        if (a.type === "remove_role" && member.roles.cache.has(role.id)) await member.roles.remove(role, `أتمتة: ${auto.name}`);
        break;
      }
      case "add_xp":
        if (member && this.app.levels && this.app.features.isEnabled(guild.id, "levels")) this.app.levels.addXp(guild.id, member.id, a.amount, { reason: `automation:${auto.id}` });
        break;
      case "add_money":
        if (member && this.app.guildConfig.value(guild.id, "economy.enabled") !== false) {
          this.app.economyService.account(guild.id, member.id);
          this.app.economy.adjustWallet({ guildId: guild.id, userId: member.id, delta: a.amount, type: "automation", reason: auto.name, refType: "automation", refId: String(auto.id) });
        }
        break;
      case "react":
        if (ctx.message?.react) await ctx.message.react(a.emoji).catch(() => {});
        break;
      default:
        break;
    }
  }

  async continueJob({ guildId, id, from, memberId, channelId }) {
    const guild = this.app.client.guilds?.cache?.get(guildId);
    const auto = guild ? this.get(guildId, id) : null;
    if (!auto || !auto.enabled) return;
    const member = memberId ? await guild.members.fetch(memberId).catch(() => null) : null;
    const channel = channelId ? guild.channels.cache.get(channelId) : null;
    await this.execute(auto, { guild, member, user: member?.user, channel }, from).catch((err) => this._error(auto, err));
  }

  async scheduledJob({ guildId, id }) {
    const guild = this.app.client.guilds?.cache?.get(guildId);
    const auto = guild ? this.get(guildId, id) : null;
    if (!auto || !auto.enabled || !this.app.features.isEnabled(guildId, "automation")) return;
    const channel = auto.trigger.channelId ? guild.channels.cache.get(auto.trigger.channelId) : null;
    if (!this._allowRun(guildId)) return;
    await this.execute(auto, { guild, channel }, 0).catch((err) => this._error(auto, err));
  }

  describe(auto, t) {
    const trig = `${t(`auto.trigger.${auto.trigger.type}`)}${auto.trigger.value !== undefined && auto.trigger.value !== null ? ` \`${auto.trigger.value}\`` : ""}${auto.trigger.channelId ? ` <#${auto.trigger.channelId}>` : ""}`;
    const cond = auto.conditions.map((c, i) => `${i + 1}. ${t(`auto.cond.${c.type}`)} ${c.roleId ? `<@&${c.roleId}>` : c.channelId ? `<#${c.channelId}>` : `\`${c.value}\``}`);
    const acts = auto.actions.map((a, i) => `${i + 1}. ${t(`auto.act.${a.type}`)} ${a.text ? `“${truncate(a.text, 60)}”` : a.roleId ? `<@&${a.roleId}>` : a.amount ?? a.emoji ?? (a.minutes ? `${a.minutes}m` : "")}${a.channelId ? ` → <#${a.channelId}>` : ""}`);
    return { trig, cond, acts };
  }
}

module.exports = AutomationService;
