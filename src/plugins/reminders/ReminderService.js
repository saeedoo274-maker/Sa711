const { PermissionFlagsBits } = require("discord.js");
const { isValidTimezone, nextOccurrence, parseDateTime } = require("../../core/utils/time");
const { parseDuration, truncate } = require("../../core/utils/common");

const MAX_AHEAD_MS = 2 * 365 * 86_400_000;

/**
 * التذكيرات.
 * كل تذكير = صف في `reminders` + مهمة في المجدول المركزي بمفتاح `reminder:<id>`.
 * المجدول يحفظ الموعد ويعيد الجدولة للتكرار، فلا يضيع أي تذكير عند إعادة التشغيل.
 */
class ReminderService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "reminders") || {};
  }

  timezoneFor(guildId, userId) {
    const own = this.app.platform.userTimezone(userId);
    if (isValidTimezone(own)) return own;
    const def = this.config(guildId).defaultTimezone;
    return isValidTimezone(def) ? def : "UTC";
  }

  setTimezone(userId, tz) {
    if (!isValidTimezone(tz)) return false;
    this.app.platform.setUserTimezone(userId, tz);
    return true;
  }

  /**
   * يحسب موعد التذكير من أحد المدخلات:
   *  in: "10m" | at: "2026-10-01 18:30" أو "18:30" | repeat: { kind, time, weekday, dayOfMonth }
   */
  resolveWhen({ inText = null, atText = null, repeat = null, tz = "UTC", now = Date.now() }) {
    if (repeat) {
      const full = { ...repeat, tz };
      const runAt = nextOccurrence(full, now);
      return runAt ? { runAt, repeat: full } : { error: "invalidRepeat" };
    }
    if (inText) {
      const ms = parseDuration(inText);
      if (!ms || ms < 60_000) return { error: "invalidDuration" };
      return { runAt: now + ms };
    }
    if (atText) {
      const runAt = parseDateTime(atText, tz, now);
      if (!runAt) return { error: "invalidDate" };
      if (runAt <= now) return { error: "past" };
      return { runAt };
    }
    return { error: "noTime" };
  }

  async create(member, { content, inText, atText, repeat, target = "dm", channel = null, staff = false, mentionRole = null }) {
    const guildId = member.guild.id;
    const cfg = this.config(guildId);
    const text = String(content || "").trim();
    if (!text) return { ok: false, reason: "empty" };
    if (!staff && this.repo.countActive(guildId, member.id) >= (cfg.maxPerUser ?? 25)) return { ok: false, reason: "limit", max: cfg.maxPerUser ?? 25 };

    const tz = this.timezoneFor(guildId, member.id);
    const when = this.resolveWhen({ inText, atText, repeat, tz });
    if (when.error) return { ok: false, reason: when.error };
    if (when.runAt - Date.now() > MAX_AHEAD_MS) return { ok: false, reason: "tooFar" };

    if (target === "channel" || staff) {
      if (!staff && cfg.allowChannelTarget === false) return { ok: false, reason: "channelDisabled" };
      if (!channel?.isTextBased?.()) return { ok: false, reason: "noChannel" };
      // لا يُسمح بتذكير في قناة لا يستطيع العضو الكتابة فيها (منع الإزعاج عبر البوت)
      const perms = channel.permissionsFor?.(member);
      if (perms && !perms.has(PermissionFlagsBits.SendMessages)) return { ok: false, reason: "noAccess" };
    }

    const reminder = this.repo.create({
      guildId, userId: member.id, target: staff ? "channel" : target, channelId: channel?.id || null,
      mentionRoleId: staff ? mentionRole?.id || null : null, staff, content: truncate(text, 1500),
      runAt: when.runAt, repeat: when.repeat || null, timezone: tz
    });
    this._schedule(reminder);
    this.app.bus.emitSafe("reminder:created", { guildId, reminder, userId: member.id });
    return { ok: true, reminder };
  }

  _schedule(reminder) {
    this.app.scheduler.schedule({
      type: "reminder:fire",
      guildId: reminder.guild_id,
      uniqueKey: `reminder:${reminder.id}`,
      runAt: reminder.run_at,
      repeat: reminder.repeat,
      payload: { id: reminder.id },
      createdBy: reminder.user_id
    });
  }

  canManage(member, reminder) {
    if (!reminder || reminder.guild_id !== member.guild.id) return false;
    if (reminder.user_id === member.id) return true;
    return !!reminder.staff && this.app.permissions.resolveLevel(member) >= (this.config(member.guild.id).staffLevel ?? 1);
  }

  delete(member, id) {
    const reminder = this.repo.get(id);
    if (!reminder?.active || !this.canManage(member, reminder)) return { ok: false, reason: "notFound" };
    this.repo.deactivate(id);
    this.app.scheduler.cancelByKey(`reminder:${id}`);
    return { ok: true, reminder };
  }

  edit(member, id, { content = null, inText = null, atText = null }) {
    const reminder = this.repo.get(id);
    if (!reminder?.active || !this.canManage(member, reminder)) return { ok: false, reason: "notFound" };
    const fields = {};
    if (content) fields.content = truncate(content.trim(), 1500);
    if (inText || atText) {
      if (reminder.repeat) return { ok: false, reason: "repeatTime" };
      const when = this.resolveWhen({ inText, atText, tz: reminder.timezone });
      if (when.error) return { ok: false, reason: when.error };
      fields.runAt = when.runAt;
    }
    const updated = this.repo.update(id, fields);
    if (fields.runAt) this._schedule(updated);
    return { ok: true, reminder: updated };
  }

  /** ينفّذ التذكير (يُستدعى من المجدول). */
  async fire(id) {
    const reminder = this.repo.get(id);
    if (!reminder?.active) return { done: true };
    const t = this.app.i18n.forGuild(reminder.guild_id);
    const guild = this.app.client.guilds?.cache?.get(reminder.guild_id);
    const header = reminder.staff ? `📌 ${t("remind.staffHeader")}` : `⏰ ${t("remind.header")}`;
    const body = `${header}\n>>> ${reminder.content}`;

    if (reminder.target === "channel" && reminder.channel_id) {
      const mention = reminder.mention_role_id ? `<@&${reminder.mention_role_id}>` : reminder.staff ? null : `<@${reminder.user_id}>`;
      const report = await this.app.notifications.notify({
        guildId: reminder.guild_id, userId: reminder.staff ? null : reminder.user_id, category: "reminders",
        targets: ["channel"], channelId: reminder.channel_id, mention,
        payload: { content: body.slice(0, 1900) }
      });
      // القناة حُذفت: لا نفقد التذكير بصمت — يُرسل للخاص
      if (!report.sent.length && !reminder.staff) {
        await this.app.notifications.notify({ guildId: reminder.guild_id, userId: reminder.user_id, category: "reminders", force: true, payload: { content: body.slice(0, 1900) } });
      }
    } else {
      await this.app.notifications.notify({
        guildId: reminder.guild_id, userId: reminder.user_id, category: "reminders", force: true,
        payload: { content: `${body}\n-# ${guild?.name || ""} • #${reminder.id}`.slice(0, 2000) }
      });
    }

    const next = reminder.repeat ? nextOccurrence(reminder.repeat, Date.now()) : null;
    this.repo.markSent(id, { nextRunAt: next });
    this.app.bus.emitSafe("reminder:fired", { guildId: reminder.guild_id, reminder });
    return next ? {} : { done: true };
  }

  describe(reminder, t) {
    const when = `<t:${Math.floor(reminder.run_at / 1000)}:f> (<t:${Math.floor(reminder.run_at / 1000)}:R>)`;
    const repeat = reminder.repeat ? ` 🔁 ${t(`remind.kind.${reminder.repeat.kind}`)} ${reminder.repeat.time || ""}` : "";
    const where = reminder.target === "channel" ? ` → <#${reminder.channel_id}>` : " → DM";
    return `\`#${reminder.id}\` ${when}${repeat}${where}${reminder.staff ? " 📌" : ""}\n${truncate(reminder.content, 90)}`;
  }
}

module.exports = ReminderService;
