const { AuditLogEvent, PermissionFlagsBits } = require("discord.js");
const { Events } = require("../events/EventBus");
const { buildEmbed, formatDuration, truncate } = require("../utils/helpers");

const TYPE_LABELS = {
  ban: "حظر",
  unban: "فك حظر",
  kick: "طرد",
  timeout: "إسكات",
  untimeout: "فك إسكات",
  warn: "تحذير"
};

/**
 * كل أنواع السجلات القابلة للتشغيل والإيقاف بشكل مستقل.
 * category = مفتاح القناة في `logs.<category>` (نفس المفاتيح القديمة حيث وُجدت).
 * التفعيل لكل سيرفر: `logEvents.<key>` (الافتراضي مفعّل — ما دامت القناة محددة).
 */
const LOG_EVENTS = {
  moderation: { category: "moderation", label: "إجراءات البوت الإدارية" },
  messageDelete: { category: "messages", label: "حذف رسالة" },
  messageEdit: { category: "messages", label: "تعديل رسالة" },
  messageBulkDelete: { category: "messages", label: "حذف جماعي" },
  memberJoin: { category: "members", label: "دخول عضو" },
  memberLeave: { category: "members", label: "خروج عضو" },
  nicknameChange: { category: "members", label: "تغيير اللقب" },
  usernameChange: { category: "members", label: "تغيير اسم المستخدم" },
  memberRoles: { category: "roles", label: "تغيير رتب عضو" },
  ban: { category: "moderation", label: "حظر (خارج البوت)" },
  unban: { category: "moderation", label: "فك حظر (خارج البوت)" },
  kick: { category: "moderation", label: "طرد (خارج البوت)" },
  timeout: { category: "moderation", label: "إسكات (خارج البوت)" },
  roleCreate: { category: "roles", label: "إنشاء رتبة" },
  roleDelete: { category: "roles", label: "حذف رتبة" },
  roleUpdate: { category: "roles", label: "تعديل رتبة" },
  channelCreate: { category: "channels", label: "إنشاء قناة" },
  channelDelete: { category: "channels", label: "حذف قناة" },
  channelUpdate: { category: "channels", label: "تعديل قناة" },
  serverUpdate: { category: "server", label: "تعديل السيرفر" },
  voiceJoin: { category: "voice", label: "دخول صوت" },
  voiceLeave: { category: "voice", label: "خروج صوت" },
  voiceMove: { category: "voice", label: "تنقل صوت" },
  threadCreate: { category: "threads", label: "إنشاء سلسلة" },
  threadDelete: { category: "threads", label: "حذف سلسلة" },
  threadUpdate: { category: "threads", label: "تعديل سلسلة" },
  tickets: { category: "tickets", label: "أحداث التذاكر" },
  economy: { category: "economy", label: "أحداث الاقتصاد" },
  applications: { category: "applications", label: "أحداث التقديمات" },
  giveaways: { category: "giveaways", label: "أحداث السحوبات" },
  suggestions: { category: "suggestions", label: "أحداث الاقتراحات" },
  staff: { category: "staff", label: "أحداث الطاقم" },
  verification: { category: "verification", label: "التحقق" }
};

const RECENT_TTL_MS = 15_000;

/**
 * نظام السجلات.
 * يستمع لأحداث EventBus بدل أن يُستدعى من داخل كل نظام،
 * فيبقى كل نظام مستقلًا ولا يعرف بوجود السجلات أصلًا.
 *
 * التوسعة: أحداث ديسكورد المباشرة (حذف/تعديل الرسائل، الرتب، القنوات، الصوت،
 * السلاسل، الأسماء...) + أحداث الأنظمة على الناقل (التذاكر، التقديمات، السحوبات،
 * الاقتراحات، الطاقم). كل نوع يُفعّل ويُعطّل لكل سيرفر على حدة.
 */
class LogService {
  constructor(app) {
    this.app = app;
    // إجراءات نفّذها البوت نفسه: لا نسجّلها مرة ثانية حين يصل حدث ديسكورد المقابل
    this.recent = new Map(); // `${guild}:${user}:${type}` -> ts
  }

  static get EVENTS() {
    return LOG_EVENTS;
  }

  register() {
    const moderationEvents = [
      [Events.MEMBER_BANNED, "ban"],
      [Events.MEMBER_UNBANNED, "unban"],
      [Events.MEMBER_KICKED, "kick"],
      [Events.MEMBER_TIMEOUT, "timeout"],
      [Events.MEMBER_UNTIMEOUT, "untimeout"],
      [Events.MEMBER_WARNED, "warn"]
    ];
    for (const [event, type] of moderationEvents) {
      this.app.bus.on(event, (payload) => {
        const targetId = payload?.case?.target_id || payload?.target?.id;
        if (payload?.guild && targetId) this._markRecent(payload.guild.id, targetId, type);
        return this.logModeration(payload);
      });
    }

    this.app.bus.on(Events.WARN_REMOVED, (p) => this.logSimple("moderation", "حذف تحذير", p));
    this.app.bus.on(Events.MESSAGES_CLEARED, (p) => this.logSimple("messages", "حذف رسائل", p));
    this.app.bus.on(Events.CHANNEL_LOCKED, (p) => this.logSimple("channels", "قفل قناة", p));
    this.app.bus.on(Events.CHANNEL_UNLOCKED, (p) => this.logSimple("channels", "فتح قناة", p));
    this.app.bus.on(Events.SLOWMODE_SET, (p) => this.logSimple("channels", "وضع بطيء", p));
    this.app.bus.on(Events.ROLE_ADDED, (p) => {
      if (p?.guild && p?.target && p?.role) this._markRecent(p.guild.id, p.target.id, `role:${p.role.id}`);
      return this.logSimple("roles", "إضافة رتبة", p);
    });
    this.app.bus.on(Events.ROLE_REMOVED, (p) => {
      if (p?.guild && p?.target && p?.role) this._markRecent(p.guild.id, p.target.id, `role:${p.role.id}`);
      return this.logSimple("roles", "إزالة رتبة", p);
    });
    this.app.bus.on(Events.NICKNAME_CHANGED, (p) => {
      if (p?.guild && p?.target) this._markRecent(p.guild.id, p.target.id, "nick");
      return this.logSimple("members", "تغيير اسم", p);
    });
    this.app.bus.on(Events.VOICE_ACTION, (p) => this.logSimple("voice", p.action || "إجراء صوتي", p));

    this._registerSystemEvents();
  }

  // ---------------- البنية المشتركة ----------------

  isEnabled(guildId, key) {
    return this.app.guildConfig.value(guildId, `logEvents.${key}`) !== false;
  }

  setEnabled(guildId, key, enabled) {
    if (!LOG_EVENTS[key]) return false;
    this.app.guildConfig.set(guildId, `logEvents.${key}`, !!enabled);
    return true;
  }

  overview(guildId) {
    return Object.entries(LOG_EVENTS).map(([key, meta]) => ({
      key,
      ...meta,
      enabled: this.isEnabled(guildId, key),
      channelId: this.app.guildConfig.value(guildId, `logs.${meta.category}`) || null
    }));
  }

  _markRecent(guildId, userId, type) {
    if (this.recent.size > 5000) {
      const now = Date.now();
      for (const [k, at] of this.recent) if (now - at > RECENT_TTL_MS) this.recent.delete(k);
    }
    this.recent.set(`${guildId}:${userId}:${type}`, Date.now());
  }

  _wasRecent(guildId, userId, type) {
    const at = this.recent.get(`${guildId}:${userId}:${type}`);
    return !!at && Date.now() - at < RECENT_TTL_MS;
  }

  async _channel(guildId, logType) {
    const channelId = this.app.guildConfig.value(guildId, `logs.${logType}`);
    if (!channelId) return null;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;
    return channel;
  }

  /** يرسل سجلًا لنوع حدث محدد إن كان مفعّلًا وله قناة. */
  async emit(guild, key, { title, description = null, fields = [], color = "info", thumbnail = null, footer = null }) {
    if (!guild || !LOG_EVENTS[key] || !this.isEnabled(guild.id, key)) return false;
    const channel = await this._channel(guild.id, LOG_EVENTS[key].category);
    if (!channel) return false;
    const embed = this.app.theme
      ? this.app.theme.embed(guild.id, { title, description, fields, color, thumbnail, footer })
      : buildEmbed({ title, description, fields, color: this.app.config.color(color), thumbnail, footer });
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((err) =>
      this.app.logger.debug(`تعذّر إرسال سجل ${key} في ${guild.id}: ${err.message}`)
    );
    return true;
  }

  /** منفّذ الإجراء من سجل التدقيق (أفضل جهد — يحتاج صلاحية View Audit Log). */
  async _executor(guild, type, targetId) {
    try {
      const me = guild.members?.me;
      if (!me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return null;
      const logs = await guild.fetchAuditLogs({ type, limit: 5 });
      const entry = logs.entries.find((e) => e.target?.id === targetId && Date.now() - e.createdTimestamp < 10_000);
      return entry ? { executor: entry.executor, reason: entry.reason } : null;
    } catch (error) {
      this.app.logger.debug(`تعذّر قراءة سجل التدقيق: ${error.message}`);
      return null;
    }
  }

  // ---------------- السجلات القديمة (كما هي، مع احترام التفعيل) ----------------

  async logModeration({ guild, case: record }) {
    if (!this.isEnabled(guild.id, "moderation")) return;
    const channel = await this._channel(guild.id, "moderation");
    if (!channel) return;

    const fields = [
      { name: this.app.i18n.t("common.caseNumber"), value: `#${record.case_number}`, inline: true },
      { name: this.app.i18n.t("common.target"), value: `<@${record.target_id}>\n\`${record.target_tag || record.target_id}\``, inline: true },
      { name: this.app.i18n.t("common.moderator"), value: `<@${record.moderator_id}>`, inline: true },
      { name: this.app.i18n.t("common.reason"), value: truncate(record.reason || this.app.i18n.t("common.noReason")) }
    ];
    if (record.duration_ms) {
      fields.push({ name: this.app.i18n.t("common.duration"), value: formatDuration(record.duration_ms), inline: true });
    }

    const embed = buildEmbed({
      title: `${this.app.config.emoji("shield")} ${TYPE_LABELS[record.type] || record.type}`,
      color: this.app.config.color(record.type === "unban" || record.type === "untimeout" ? "success" : "danger"),
      fields,
      footer: `${this.app.i18n.t("logs.moderationTitle")} • #${record.case_number}`
    });

    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  async logSimple(logType, title, payload = {}) {
    const guild = payload.guild;
    if (!guild) return;
    // كل ما يمر هنا إجراءات نفّذها البوت نفسه بأوامر الإدارة
    if (!this.isEnabled(guild.id, "moderation")) return;
    const channel = await this._channel(guild.id, logType);
    if (!channel) return;

    const fields = [];
    if (payload.executor) fields.push({ name: this.app.i18n.t("common.moderator"), value: `<@${payload.executor.id}>`, inline: true });
    if (payload.target) fields.push({ name: this.app.i18n.t("common.target"), value: `<@${payload.target.id}>`, inline: true });
    if (payload.channel) fields.push({ name: "القناة", value: `<#${payload.channel.id}>`, inline: true });
    if (payload.role) fields.push({ name: "الرتبة", value: `<@&${payload.role.id}>`, inline: true });
    if (payload.details) fields.push({ name: "التفاصيل", value: truncate(payload.details) });
    if (payload.reason) fields.push({ name: this.app.i18n.t("common.reason"), value: truncate(payload.reason) });

    const embed = buildEmbed({
      title: `${this.app.config.emoji("logs")} ${title}`,
      color: this.app.config.color("info"),
      fields
    });
    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  // ---------------- أحداث ديسكورد ----------------

  async messageDelete(message) {
    if (!message.guild || message.author?.bot) return;
    const content = message.partial ? "_(الرسالة غير محفوظة في الذاكرة — المحتوى غير متاح)_" : truncate(message.content || "—", 1000);
    const files = message.attachments?.size ? [...message.attachments.values()].map((a) => a.name).join(", ") : null;
    await this.emit(message.guild, "messageDelete", {
      title: "🗑️ حذف رسالة",
      color: "danger",
      fields: [
        { name: "الكاتب", value: message.author ? `<@${message.author.id}>` : "—", inline: true },
        { name: "القناة", value: `<#${message.channel.id}>`, inline: true },
        { name: "المحتوى", value: content },
        ...(files ? [{ name: "المرفقات", value: truncate(files, 500) }] : [])
      ],
      footer: `ID: ${message.id}`
    });
  }

  async messageUpdate(oldMessage, newMessage) {
    const guild = newMessage.guild;
    if (!guild || newMessage.author?.bot) return;
    if (!oldMessage.partial && oldMessage.content === newMessage.content) return; // تحديث تضمين رابط فقط
    await this.emit(guild, "messageEdit", {
      title: "✏️ تعديل رسالة",
      color: "warning",
      description: `[الانتقال للرسالة](https://discord.com/channels/${guild.id}/${newMessage.channel.id}/${newMessage.id})`,
      fields: [
        { name: "الكاتب", value: newMessage.author ? `<@${newMessage.author.id}>` : "—", inline: true },
        { name: "القناة", value: `<#${newMessage.channel.id}>`, inline: true },
        { name: "قبل", value: oldMessage.partial ? "_(غير متاح)_" : truncate(oldMessage.content || "—", 1000) },
        { name: "بعد", value: truncate(newMessage.content || "—", 1000) }
      ]
    });
  }

  async messageDeleteBulk(messages, channel) {
    const guild = channel?.guild;
    if (!guild) return;
    await this.emit(guild, "messageBulkDelete", {
      title: "🧹 حذف جماعي",
      color: "danger",
      fields: [
        { name: "القناة", value: `<#${channel.id}>`, inline: true },
        { name: "العدد", value: `\`${messages.size}\``, inline: true }
      ]
    });
  }

  async memberJoin(member) {
    const created = member.user.createdTimestamp;
    await this.emit(member.guild, "memberJoin", {
      title: "📥 دخول عضو",
      color: "success",
      thumbnail: member.user.displayAvatarURL?.(),
      fields: [
        { name: "العضو", value: `<@${member.id}>\n\`${member.user.tag || member.user.username}\``, inline: true },
        { name: "عمر الحساب", value: created ? `<t:${Math.floor(created / 1000)}:R>` : "—", inline: true },
        { name: "عدد الأعضاء", value: `\`${member.guild.memberCount}\``, inline: true }
      ],
      footer: `ID: ${member.id}`
    });
  }

  async memberLeave(member) {
    // هل كان طردًا؟ (من سجل التدقيق، ما لم يكن البوت هو المنفّذ)
    if (!this._wasRecent(member.guild.id, member.id, "kick")) {
      const kick = await this._executor(member.guild, AuditLogEvent.MemberKick, member.id);
      if (kick) {
        await this.emit(member.guild, "kick", {
          title: "👢 طرد (خارج البوت)",
          color: "danger",
          fields: [
            { name: "العضو", value: `<@${member.id}>`, inline: true },
            { name: "المنفّذ", value: kick.executor ? `<@${kick.executor.id}>` : "—", inline: true },
            { name: "السبب", value: truncate(kick.reason || "—") }
          ]
        });
      }
    }
    const roles = member.roles?.cache ? [...member.roles.cache.values()].filter((r) => r.id !== member.guild.id).map((r) => `<@&${r.id}>`) : [];
    await this.emit(member.guild, "memberLeave", {
      title: "📤 خروج عضو",
      color: "neutral",
      thumbnail: member.user?.displayAvatarURL?.(),
      fields: [
        { name: "العضو", value: `<@${member.id}>\n\`${member.user?.tag || member.user?.username || member.id}\``, inline: true },
        { name: "انضم", value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "—", inline: true },
        { name: "الرتب", value: truncate(roles.join(" ") || "—", 1000) }
      ],
      footer: `ID: ${member.id}`
    });
  }

  async banAdd(ban) {
    if (this._wasRecent(ban.guild.id, ban.user.id, "ban")) return;
    const info = await this._executor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    await this.emit(ban.guild, "ban", {
      title: "🔨 حظر (خارج البوت)",
      color: "danger",
      fields: [
        { name: "العضو", value: `<@${ban.user.id}>\n\`${ban.user.tag || ban.user.username}\``, inline: true },
        { name: "المنفّذ", value: info?.executor ? `<@${info.executor.id}>` : "—", inline: true },
        { name: "السبب", value: truncate(ban.reason || info?.reason || "—") }
      ]
    });
  }

  async banRemove(ban) {
    if (this._wasRecent(ban.guild.id, ban.user.id, "unban")) return;
    const info = await this._executor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    await this.emit(ban.guild, "unban", {
      title: "🔓 فك حظر (خارج البوت)",
      color: "success",
      fields: [
        { name: "العضو", value: `<@${ban.user.id}>`, inline: true },
        { name: "المنفّذ", value: info?.executor ? `<@${info.executor.id}>` : "—", inline: true }
      ]
    });
  }

  async memberUpdate(oldMember, newMember) {
    const guild = newMember.guild;
    if (oldMember.partial) return;

    if (oldMember.nickname !== newMember.nickname && !this._wasRecent(guild.id, newMember.id, "nick")) {
      await this.emit(guild, "nicknameChange", {
        title: "🏷️ تغيير اللقب",
        color: "info",
        fields: [
          { name: "العضو", value: `<@${newMember.id}>`, inline: true },
          { name: "قبل", value: oldMember.nickname || "—", inline: true },
          { name: "بعد", value: newMember.nickname || "—", inline: true }
        ]
      });
    }

    const was = oldMember.communicationDisabledUntilTimestamp || 0;
    const now = newMember.communicationDisabledUntilTimestamp || 0;
    if (now > Date.now() && now !== was && !this._wasRecent(guild.id, newMember.id, "timeout")) {
      const info = await this._executor(guild, AuditLogEvent.MemberUpdate, newMember.id);
      await this.emit(guild, "timeout", {
        title: "🔇 إسكات (خارج البوت)",
        color: "warning",
        fields: [
          { name: "العضو", value: `<@${newMember.id}>`, inline: true },
          { name: "حتى", value: `<t:${Math.floor(now / 1000)}:f>`, inline: true },
          { name: "المنفّذ", value: info?.executor ? `<@${info.executor.id}>` : "—", inline: true }
        ]
      });
    }

    const oldRoles = oldMember.roles?.cache;
    const newRoles = newMember.roles?.cache;
    if (oldRoles && newRoles) {
      const added = [...newRoles.keys()].filter((id) => !oldRoles.has(id) && !this._wasRecent(guild.id, newMember.id, `role:${id}`));
      const removed = [...oldRoles.keys()].filter((id) => !newRoles.has(id) && !this._wasRecent(guild.id, newMember.id, `role:${id}`));
      if (added.length || removed.length) {
        await this.emit(guild, "memberRoles", {
          title: "🎭 تغيير رتب عضو",
          color: "info",
          fields: [
            { name: "العضو", value: `<@${newMember.id}>`, inline: true },
            ...(added.length ? [{ name: "أُضيفت", value: added.map((r) => `<@&${r}>`).join(" "), inline: true }] : []),
            ...(removed.length ? [{ name: "أُزيلت", value: removed.map((r) => `<@&${r}>`).join(" "), inline: true }] : [])
          ]
        });
      }
    }
  }

  async userUpdate(oldUser, newUser) {
    if (oldUser.partial || oldUser.username === newUser.username) return;
    for (const guild of this.app.client.guilds.cache.values()) {
      if (!guild.members.cache.has(newUser.id)) continue;
      await this.emit(guild, "usernameChange", {
        title: "👤 تغيير اسم المستخدم",
        color: "info",
        fields: [
          { name: "العضو", value: `<@${newUser.id}>`, inline: true },
          { name: "قبل", value: oldUser.username, inline: true },
          { name: "بعد", value: newUser.username, inline: true }
        ]
      });
    }
  }

  async role(kind, role, oldRole = null) {
    const type = { create: AuditLogEvent.RoleCreate, delete: AuditLogEvent.RoleDelete, update: AuditLogEvent.RoleUpdate }[kind];
    const info = await this._executor(role.guild, type, role.id);
    const fields = [
      { name: "الرتبة", value: kind === "delete" ? `\`${role.name}\`` : `<@&${role.id}> \`${role.name}\``, inline: true },
      { name: "المنفّذ", value: info?.executor ? `<@${info.executor.id}>` : "—", inline: true }
    ];
    if (kind === "update" && oldRole) {
      const changes = [];
      if (oldRole.name !== role.name) changes.push(`الاسم: \`${oldRole.name}\` ← \`${role.name}\``);
      if (oldRole.color !== role.color) changes.push(`اللون: \`${oldRole.hexColor}\` ← \`${role.hexColor}\``);
      if (oldRole.permissions?.bitfield !== role.permissions?.bitfield) changes.push("الصلاحيات تغيّرت");
      if (oldRole.hoist !== role.hoist) changes.push(`الظهور المنفصل: ${role.hoist ? "✅" : "❌"}`);
      if (oldRole.mentionable !== role.mentionable) changes.push(`قابلة للمنشن: ${role.mentionable ? "✅" : "❌"}`);
      if (!changes.length) return; // تغيّر الترتيب فقط
      fields.push({ name: "التغييرات", value: changes.join("\n") });
    }
    const key = { create: "roleCreate", delete: "roleDelete", update: "roleUpdate" }[kind];
    await this.emit(role.guild, key, {
      title: { create: "➕ إنشاء رتبة", delete: "➖ حذف رتبة", update: "✏️ تعديل رتبة" }[kind],
      color: kind === "delete" ? "danger" : kind === "create" ? "success" : "warning",
      fields
    });
  }

  async channel(kind, channel, oldChannel = null) {
    if (!channel.guild) return;
    const type = { create: AuditLogEvent.ChannelCreate, delete: AuditLogEvent.ChannelDelete, update: AuditLogEvent.ChannelUpdate }[kind];
    const fields = [{ name: "القناة", value: kind === "delete" ? `\`#${channel.name}\`` : `<#${channel.id}> \`${channel.name}\``, inline: true }];
    if (kind === "update" && oldChannel) {
      const changes = [];
      if (oldChannel.name !== channel.name) changes.push(`الاسم: \`${oldChannel.name}\` ← \`${channel.name}\``);
      if ((oldChannel.topic || "") !== (channel.topic || "")) changes.push("الوصف تغيّر");
      if (oldChannel.parentId !== channel.parentId) changes.push("التصنيف تغيّر");
      if (oldChannel.rateLimitPerUser !== channel.rateLimitPerUser) changes.push(`الوضع البطيء: ${channel.rateLimitPerUser || 0}s`);
      if (oldChannel.nsfw !== channel.nsfw) changes.push(`NSFW: ${channel.nsfw ? "✅" : "❌"}`);
      const permsChanged = oldChannel.permissionOverwrites?.cache?.size !== channel.permissionOverwrites?.cache?.size;
      if (permsChanged) changes.push("صلاحيات القناة تغيّرت");
      if (!changes.length) return;
      fields.push({ name: "التغييرات", value: changes.join("\n") });
    }
    const info = await this._executor(channel.guild, type, channel.id);
    fields.push({ name: "المنفّذ", value: info?.executor ? `<@${info.executor.id}>` : "—", inline: true });
    await this.emit(channel.guild, { create: "channelCreate", delete: "channelDelete", update: "channelUpdate" }[kind], {
      title: { create: "📁 إنشاء قناة", delete: "🗑️ حذف قناة", update: "✏️ تعديل قناة" }[kind],
      color: kind === "delete" ? "danger" : kind === "create" ? "success" : "warning",
      fields
    });
  }

  async guildUpdate(oldGuild, newGuild) {
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push(`الاسم: \`${oldGuild.name}\` ← \`${newGuild.name}\``);
    if (oldGuild.icon !== newGuild.icon) changes.push("الأيقونة تغيّرت");
    if (oldGuild.banner !== newGuild.banner) changes.push("البانر تغيّر");
    if (oldGuild.ownerId !== newGuild.ownerId) changes.push(`المالك: <@${oldGuild.ownerId}> ← <@${newGuild.ownerId}>`);
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) changes.push("مستوى التحقق تغيّر");
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) changes.push(`الرابط المخصص: ${newGuild.vanityURLCode || "—"}`);
    if (!changes.length) return;
    await this.emit(newGuild, "serverUpdate", { title: "🏠 تعديل السيرفر", color: "warning", description: changes.join("\n") });
  }

  async voiceState(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const member = newState.member || oldState.member;
    if (!guild || !member || member.user?.bot) return;
    if (!oldState.channelId && newState.channelId) {
      await this.emit(guild, "voiceJoin", { title: "🔊 دخول صوت", color: "success", fields: [{ name: "العضو", value: `<@${member.id}>`, inline: true }, { name: "الروم", value: `<#${newState.channelId}>`, inline: true }] });
    } else if (oldState.channelId && !newState.channelId) {
      await this.emit(guild, "voiceLeave", { title: "🔈 خروج صوت", color: "neutral", fields: [{ name: "العضو", value: `<@${member.id}>`, inline: true }, { name: "الروم", value: `<#${oldState.channelId}>`, inline: true }] });
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      await this.emit(guild, "voiceMove", { title: "🔀 تنقل صوت", color: "info", fields: [{ name: "العضو", value: `<@${member.id}>`, inline: true }, { name: "من", value: `<#${oldState.channelId}>`, inline: true }, { name: "إلى", value: `<#${newState.channelId}>`, inline: true }] });
    }
  }

  async thread(kind, thread, oldThread = null) {
    if (!thread.guild) return;
    const fields = [
      { name: "السلسلة", value: kind === "delete" ? `\`${thread.name}\`` : `<#${thread.id}> \`${thread.name}\``, inline: true },
      { name: "القناة الأم", value: thread.parentId ? `<#${thread.parentId}>` : "—", inline: true }
    ];
    if (kind === "create" && thread.ownerId) fields.push({ name: "المنشئ", value: `<@${thread.ownerId}>`, inline: true });
    if (kind === "update" && oldThread) {
      const changes = [];
      if (oldThread.name !== thread.name) changes.push(`الاسم: \`${oldThread.name}\` ← \`${thread.name}\``);
      if (oldThread.archived !== thread.archived) changes.push(thread.archived ? "أُرشفت" : "أُعيد فتحها");
      if (oldThread.locked !== thread.locked) changes.push(thread.locked ? "قُفلت" : "فُتحت");
      if (!changes.length) return;
      fields.push({ name: "التغييرات", value: changes.join("\n") });
    }
    await this.emit(thread.guild, { create: "threadCreate", delete: "threadDelete", update: "threadUpdate" }[kind], {
      title: { create: "🧵 إنشاء سلسلة", delete: "🧵 حذف سلسلة", update: "🧵 تعديل سلسلة" }[kind],
      color: kind === "delete" ? "danger" : "info",
      fields
    });
  }

  // ---------------- أحداث الأنظمة على الناقل ----------------

  _registerSystemEvents() {
    const bus = this.app.bus;
    const guildOf = (p) => p?.guild || (p?.guildId ? this.app.client.guilds?.cache?.get(p.guildId) : null);
    const on = (event, fn) => bus.on(event, (p) => {
      const guild = guildOf(p);
      if (!guild) return null;
      return fn(guild, p);
    });

    const ticket = (label, color) => (guild, p) => this.emit(guild, "tickets", {
      title: `🎫 ${label}`,
      color,
      fields: [
        { name: "التذكرة", value: p.ticket?.channel_id ? `<#${p.ticket.channel_id}> (#${p.ticket.number ?? p.ticket.id})` : "—", inline: true },
        { name: "صاحبها", value: (p.ticket?.owner_id || p.ticket?.user_id) ? `<@${p.ticket.owner_id || p.ticket.user_id}>` : "—", inline: true },
        { name: "بواسطة", value: p.member ? `<@${p.member.id}>` : p.staffId ? `<@${p.staffId}>` : "—", inline: true }
      ]
    });
    on("ticket:created", ticket("فتح تذكرة", "success"));
    on("ticket:closed", ticket("إغلاق تذكرة", "danger"));
    on("ticket:claimed", ticket("استلام تذكرة", "info"));
    on("ticket:unclaimed", ticket("إلغاء استلام", "neutral"));
    on("ticket:reopened", ticket("إعادة فتح تذكرة", "warning"));
    on("ticket:deleted", ticket("حذف تذكرة", "danger"));
    on("ticket:transferred", ticket("نقل تذكرة", "info"));
    on("ticket:priority", ticket("تغيير أولوية تذكرة", "warning"));
    on("ticket:escalated", ticket("تصعيد تذكرة", "danger"));

    const application = (label, color) => (guild, p) => this.emit(guild, "applications", {
      title: `📝 ${label}`,
      color,
      fields: [
        { name: "المتقدّم", value: p.record?.user_id ? `<@${p.record.user_id}>` : p.user ? `<@${p.user.id}>` : "—", inline: true },
        { name: "النوع", value: p.type?.name || p.type?.label || "—", inline: true },
        { name: "الرقم", value: p.record?.number ? `#${p.record.number}` : "—", inline: true },
        ...(p.reviewer ? [{ name: "المراجع", value: `<@${p.reviewer.id}>`, inline: true }] : [])
      ]
    });
    on("application:submitted", application("تقديم جديد", "info"));
    on("application:accepted", application("قبول تقديم", "success"));
    on("application:rejected", application("رفض تقديم", "danger"));

    on("giveaway:ended", (guild, p) => this.emit(guild, "giveaways", {
      title: p.rerolledBy ? "🎉 إعادة سحب" : "🎉 انتهاء سحب",
      color: "success",
      fields: [
        { name: "الجائزة", value: truncate(p.giveaway?.prize || "—", 200), inline: true },
        { name: "الفائزون", value: (p.winners || []).map((w) => `<@${w.user_id || w}>`).join(" ") || "—", inline: true }
      ]
    }));
    on("giveaway:created", (guild, p) => this.emit(guild, "giveaways", {
      title: "🎉 بدء سحب",
      color: "info",
      fields: [{ name: "الجائزة", value: truncate(p.giveaway?.prize || "—", 200), inline: true }, { name: "بواسطة", value: p.hostId ? `<@${p.hostId}>` : "—", inline: true }]
    }));

    on("suggestion:created", (guild, p) => this.emit(guild, "suggestions", {
      title: `💡 اقتراح جديد #${p.suggestion.number}`,
      color: "info",
      description: truncate(p.suggestion.content, 500),
      fields: [{ name: "صاحبه", value: `<@${p.suggestion.author_id}>${p.suggestion.anonymous ? " (مجهول للعامة)" : ""}`, inline: true }]
    }));
    on("suggestion:decided", (guild, p) => this.emit(guild, "suggestions", {
      title: `💡 قرار اقتراح #${p.suggestion.number}: ${p.status}`,
      color: p.status === "accepted" ? "success" : p.status === "rejected" ? "danger" : "warning",
      fields: [{ name: "الطاقم", value: `<@${p.staffId}>`, inline: true }, { name: "السبب", value: truncate(p.reason || "—", 500) }]
    }));
    on("suggestion:deleted", (guild, p) => this.emit(guild, "suggestions", {
      title: `💡 حذف اقتراح #${p.suggestion.number}`,
      color: "danger",
      fields: [{ name: "الطاقم", value: `<@${p.staffId}>`, inline: true }]
    }));

    const staff = (label) => (guild, p) => this.emit(guild, "staff", {
      title: `👥 ${label}`,
      color: "info",
      fields: [
        { name: "العضو", value: p.target ? `<@${p.target.id}>` : p.userId ? `<@${p.userId}>` : "—", inline: true },
        { name: "بواسطة", value: p.executor ? `<@${p.executor.id}>` : p.actorId ? `<@${p.actorId}>` : "—", inline: true },
        ...(p.from || p.to ? [{ name: "الرتبة", value: `${p.from?.name || "—"} ← ${p.to?.name || "—"}`, inline: true }] : []),
        ...(p.details ? [{ name: "التفاصيل", value: truncate(p.details, 500) }] : [])
      ]
    });
    on(Events.STAFF_PROMOTED, staff("ترقية إداري"));
    on(Events.STAFF_DEMOTED, staff("تنزيل إداري"));
    on("staff:shift", staff("مناوبة"));
    on("staff:evaluation", staff("تقييم إداري"));
    on("staff:department", staff("تغيير قسم"));
    on("levels:admin", (guild, p) => this.emit(guild, "staff", {
      title: `✨ تعديل XP (${p.action})`,
      color: "neutral",
      fields: [
        { name: "العضو", value: p.userId ? `<@${p.userId}>` : "الكل", inline: true },
        { name: "بواسطة", value: `<@${p.actorId}>`, inline: true },
        ...(p.amount != null ? [{ name: "القيمة", value: `\`${p.amount}\``, inline: true }] : [])
      ]
    }));

    on("verification:verified", (guild, p) => this.emit(guild, "verification", {
      title: "✅ تحقق عضو",
      color: "success",
      fields: [{ name: "العضو", value: `<@${p.userId}>`, inline: true }, { name: "عمر الحساب", value: p.accountAgeDays != null ? `${p.accountAgeDays} يوم` : "—", inline: true }]
    }));
  }
}

module.exports = LogService;
