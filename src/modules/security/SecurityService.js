const { AuditLogEvent, PermissionFlagsBits } = require("discord.js");
const { Events } = require("../../core/events/EventBus");
const { buildEmbed } = require("../../core/utils/helpers");
const { Level } = require("../../core/permissions/PermissionService");

/**
 * نظام الحماية.
 *
 * يعمل بمبدأ العدّاد الزمني: كل إجراء خطير يُنسب لمنفّذه عبر Audit Log،
 * وإذا تجاوز عدد إجراءاته الحد المسموح خلال النافذة الزمنية، يُنفَّذ الإجراء الوقائي.
 *
 * حدود واعية بها:
 *  - لا يمكن للبوت تجاوز تسلسل رتب ديسكورد، فالحماية لا تطال من رتبته أعلى من البوت.
 *  - مالك السيرفر والمطورون والقائمة البيضاء مستثنون دائمًا.
 */
class SecurityService {
  constructor(app) {
    this.app = app;
    this.counters = new Map(); // `${guildId}:${userId}:${rule}` -> [timestamps]
  }

  register() {
    const c = this.app.client;
    c.on("channelCreate", (ch) => this._audit(ch.guild, AuditLogEvent.ChannelCreate, "antiChannelCreate"));
    c.on("channelDelete", (ch) => this._audit(ch.guild, AuditLogEvent.ChannelDelete, "antiChannelDelete"));
    c.on("roleCreate", (r) => this._audit(r.guild, AuditLogEvent.RoleCreate, "antiRoleCreate"));
    c.on("roleDelete", (r) => this._audit(r.guild, AuditLogEvent.RoleDelete, "antiRoleDelete"));
    c.on("guildMemberUpdate", (oldM, newM) => this._roleGrant(oldM, newM).catch(() => {}));
    c.on("roleUpdate", (oldR, newR) => this._permissionEscalation(oldR, newR).catch(() => {}));
  }

  _enabled(guildId, rule) {
    const cfg = this.app.guildConfig.get(guildId);
    if (!cfg.security?.enabled) return null;
    const settings = cfg.security.rules?.[rule];
    return settings?.enabled ? { settings, cfg } : null;
  }

  _exempt(guild, userId, cfg) {
    if (!userId) return true;
    if (userId === guild.ownerId) return true;
    if (userId === this.app.client.user.id) return true;
    if (this.app.config.isDeveloper(userId)) return true;
    if ((cfg.security.whitelist || []).includes(userId)) return true;
    return false;
  }

  /** يزيد العدّاد ويُرجع true إذا تجاوز الحد داخل النافذة الزمنية. */
  _hit(guildId, userId, rule, threshold, windowMs) {
    const key = `${guildId}:${userId}:${rule}`;
    const now = Date.now();
    const hits = (this.counters.get(key) || []).filter((t) => now - t < windowMs);
    hits.push(now);
    this.counters.set(key, hits);
    // تنظيف دوري بسيط لتفادي تضخم الذاكرة
    if (this.counters.size > 5000) this.counters.clear();
    return hits.length >= threshold;
  }

  async _audit(guild, auditType, rule) {
    if (!guild) return;
    const check = this._enabled(guild.id, rule);
    if (!check) return;

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;

    // تأخير بسيط لأن Audit Log لا يُحدَّث فورًا
    await new Promise((r) => setTimeout(r, 1200));
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 }).catch(() => null);
    const entry = logs?.entries.first();
    if (!entry || Date.now() - entry.createdTimestamp > 15000) return;

    const executorId = entry.executor?.id;
    if (this._exempt(guild, executorId, check.cfg)) return;

    const { threshold, windowMs, action } = check.settings;
    if (!this._hit(guild.id, executorId, rule, threshold, windowMs)) return;

    await this._punish(guild, executorId, rule, action, `تجاوز ${threshold} إجراء خلال ${Math.round(windowMs / 1000)} ثانية`);
  }

  /** منع منح رتبة إدارية عالية بواسطة شخص غير مخوّل. */
  async _roleGrant(oldMember, newMember) {
    const guild = newMember.guild;
    const check = this._enabled(guild.id, "antiHighRoleGrant");
    if (!check) return;

    const gained = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    if (!gained.size) return;

    const dangerous = gained.filter((r) =>
      r.permissions.has(PermissionFlagsBits.Administrator) ||
      r.permissions.has(PermissionFlagsBits.ManageGuild) ||
      r.permissions.has(PermissionFlagsBits.ManageRoles) ||
      r.permissions.has(PermissionFlagsBits.BanMembers)
    );
    if (!dangerous.size) return;

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;

    await new Promise((r) => setTimeout(r, 1200));
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 1 }).catch(() => null);
    const entry = logs?.entries.first();
    if (!entry || entry.target?.id !== newMember.id) return;

    const executorId = entry.executor?.id;
    if (this._exempt(guild, executorId, check.cfg)) return;

    const executor = await guild.members.fetch(executorId).catch(() => null);
    if (executor && this.app.permissions.resolveLevel(executor) >= Level.ADMIN) return;

    // الإجراء الوقائي: سحب الرتب الخطيرة التي مُنحت بغير صلاحية
    for (const role of dangerous.values()) {
      if (role.position < me.roles.highest.position) {
        await newMember.roles.remove(role, "الحماية: منح رتبة إدارية بغير صلاحية").catch(() => {});
      }
    }

    await this._report(guild, executorId, "antiHighRoleGrant", "revert",
      `مُنحت <@${newMember.id}> رتبة إدارية بغير صلاحية، وتم سحبها.`);
  }

  /** رصد رفع صلاحيات رتبة قائمة إلى صلاحيات خطيرة. */
  async _permissionEscalation(oldRole, newRole) {
    const guild = newRole.guild;
    const check = this._enabled(guild.id, "antiPermissionEscalation");
    if (!check) return;

    const dangerousFlags = [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.BanMembers
    ];
    const gained = dangerousFlags.filter((f) => !oldRole.permissions.has(f) && newRole.permissions.has(f));
    if (!gained.length) return;

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;

    await new Promise((r) => setTimeout(r, 1200));
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 1 }).catch(() => null);
    const entry = logs?.entries.first();
    const executorId = entry?.executor?.id;
    if (this._exempt(guild, executorId, check.cfg)) return;

    const executor = await guild.members.fetch(executorId).catch(() => null);
    if (executor && this.app.permissions.resolveLevel(executor) >= Level.ADMIN) return;

    if (newRole.position < me.roles.highest.position) {
      await newRole.setPermissions(oldRole.permissions, "الحماية: تراجع عن تصعيد صلاحيات").catch(() => {});
    }

    await this._report(guild, executorId, "antiPermissionEscalation", "revert",
      `تم رفع صلاحيات <@&${newRole.id}> بغير صلاحية، وتمت إعادتها.`);
  }

  async _punish(guild, userId, rule, action, details) {
    const member = await guild.members.fetch(userId).catch(() => null);
    const me = guild.members.me;

    if (member && me) {
      // لا يمكن تجاوز تسلسل ديسكورد — هذا حد تقني لا التفاف عليه
      const canAct = member.roles.highest.position < me.roles.highest.position && member.id !== guild.ownerId;
      if (canAct) {
        try {
          if (action === "removeRoles") {
            const toRemove = member.roles.cache.filter(
              (r) => r.id !== guild.id && !r.managed && r.position < me.roles.highest.position &&
                r.permissions.any([PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild,
                  PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.BanMembers])
            );
            if (toRemove.size) await member.roles.remove(toRemove, `الحماية: ${rule}`);
          } else if (action === "kick" && member.kickable) {
            await member.kick(`الحماية: ${rule}`);
          } else if (action === "ban" && member.bannable) {
            await member.ban({ reason: `الحماية: ${rule}` });
          }
        } catch { /* الفشل يُسجَّل في التقرير أدناه */ }
      }
    }

    await this._report(guild, userId, rule, action, details);
  }

  async _report(guild, userId, rule, action, details) {
    this.app.bus.emitSafe(Events.SECURITY_TRIGGERED, { guild, userId, rule, action, details });

    const channelId = this.app.guildConfig.value(guild.id, "logs.security");
    if (!channelId) return;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    await channel.send({
      content: `<@${userId}>`,
      embeds: [
        buildEmbed({
          title: `${this.app.config.emoji("shield")} تنبيه حماية`,
          color: this.app.config.color("danger"),
          fields: [
            { name: "القاعدة", value: `\`${rule}\``, inline: true },
            { name: "الإجراء المتخذ", value: `\`${action}\``, inline: true },
            { name: "المنفّذ", value: `<@${userId}>`, inline: true },
            { name: "التفاصيل", value: details }
          ]
        })
      ]
    }).catch(() => {});
  }
}

module.exports = SecurityService;
