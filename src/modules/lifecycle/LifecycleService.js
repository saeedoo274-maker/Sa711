const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { buildEmbed, timestamp, truncate, formatDuration } = require("../../core/utils/helpers");

const KINDS = {
  leave: { label: "إجازة", emoji: "🌴", cfg: "leave", log: "leave" },
  resign: { label: "استقالة", emoji: "📤", cfg: "resign", log: "resign" },
  report: { label: "بلاغ على إداري", emoji: "🚨", cfg: "reports", log: "reports" }
};

const STATUS = {
  pending: { label: "بانتظار المراجعة", color: "warning", icon: "⏳" },
  active: { label: "الإجازة سارية", color: "success", icon: "🌴" },
  accepted: { label: "تم القبول", color: "success", icon: "✅" },
  ended: { label: "انتهت الإجازة", color: "neutral", icon: "🔚" },
  rejected: { label: "تم الرفض", color: "danger", icon: "❌" }
};

/**
 * دورة حياة الطاقم.
 *
 * القاعدة المشتركة: الطلب يُنشر للمراجعة، والقرار **ذرّي** في قاعدة البيانات،
 * فلا يُقبل ويُرفض نفس الطلب معًا مهما تزامن الإداريان.
 *
 * الرتب المسحوبة عند الإجازة والاستقالة **تُحفظ** في السجل،
 * فتُستعاد بدقة عند العودة بدل تخمينها.
 */
class LifecycleService {
  constructor(app) {
    this.app = app;
    this.timer = null;
  }

  start() {
    // فحص دوري واحد لكل الإجازات، بدل مؤقّت لكل إجازة
    this.timer = setInterval(() => this.tick().catch(() => {}), 60_000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** يُنهي الإجازات المستحقة ويُعيد الرتب تلقائيًا. */
  async tick() {
    for (const record of this.app.lifecycle.dueLeaves()) {
      const guild = this.app.client.guilds.cache.get(record.guild_id);
      if (!guild) continue;
      await this.endLeave({ guild, record, actorId: null, auto: true }).catch((err) =>
        this.app.errors.capture(err, { system: "lifecycle/autoEnd", guildId: record.guild_id })
      );
    }
  }

  config(guildId, kind) {
    return this.app.guildConfig.value(guildId, KINDS[kind].cfg) || {};
  }

  enabled(guildId, kind) {
    return !!this.config(guildId, kind).enabled;
  }

  // ---------------- بناء العرض ----------------

  buildEmbed(guild, kind, record, user) {
    const meta = KINDS[kind];
    const state = STATUS[record.status] || STATUS.pending;
    const fields = [];

    if (kind === "report") {
      fields.push(
        { name: "🚨 المُبلِّغ", value: `<@${record.reporter_id}>`, inline: true },
        { name: "👤 الإداري", value: `<@${record.target_id}>`, inline: true },
        { name: "📝 السبب", value: truncate(record.reason, 1024) }
      );
      if (record.incident_at) fields.push({ name: "🕐 متى", value: truncate(record.incident_at, 256), inline: true });
      if (record.place) fields.push({ name: "📍 المكان", value: truncate(record.place, 256), inline: true });
      if (record.witnesses) fields.push({ name: "👥 الشهود", value: truncate(record.witnesses, 512) });
      if (record.evidence?.length) {
        fields.push({
          name: `📎 الأدلة (${record.evidence.length})`,
          value: truncate(record.evidence.map((e, i) => `[دليل ${i + 1}](${e})`).join(" • "), 1024)
        });
      }
      if (record.warning_level) {
        fields.push({ name: "⚠️ درجة التحذير", value: `التحذير رقم **${record.warning_level}**`, inline: true });
      }
    } else {
      fields.push({ name: "👤 العضو", value: `<@${record.user_id}>`, inline: true });
      if (record.duration_ms) fields.push({ name: "⏳ المدة", value: formatDuration(record.duration_ms), inline: true });
      if (record.ends_at) fields.push({ name: "🔚 تنتهي", value: timestamp(record.ends_at, "R"), inline: true });
      fields.push({ name: "📝 السبب", value: truncate(record.reason || "لم يُذكر", 1024) });
      if (record.saved_roles?.length) {
        fields.push({
          name: `🎖️ الرتب المسحوبة (${record.saved_roles.length})`,
          value: truncate(record.saved_roles.map((r) => `<@&${r}>`).join(" "), 1024)
        });
      }
    }

    fields.push({
      name: "الحالة",
      value:
        `${state.icon} ${state.label}` +
        (record.reviewer_id ? `\n<@${record.reviewer_id}> • ${timestamp(record.reviewed_at, "f")}` : "") +
        (record.note ? `\n📝 ${truncate(record.note, 500)}` : "")
    });

    return buildEmbed({
      title: `${meta.emoji} طلب ${meta.label}`,
      color: this.app.config.color(state.color),
      fields,
      thumbnail: user?.displayAvatarURL?.() || undefined,
      footer: `${meta.label} رقم #${record.number}`
    });
  }

  buttons(kind, record) {
    if (record.status !== "pending") return [];
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lc:ok:${kind}:${record.id}`).setLabel("قبول").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`lc:no:${kind}:${record.id}`).setLabel("رفض").setEmoji("❌").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`lc:note:${kind}:${record.id}`).setLabel("رفض بسبب").setEmoji("📝").setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  /** ينشر الطلب في قناة المراجعة المحددة لهذا النوع. */
  async publish(guild, kind, record, user) {
    const cfg = this.config(guild.id, kind);
    const channelId = cfg.requestChannelId || cfg.channelId;
    if (!channelId) return null;

    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return null;

    const ping = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : undefined;
    const message = await channel
      .send({
        content: ping,
        embeds: [this.buildEmbed(guild, kind, record, user)],
        components: this.buttons(kind, record),
        allowedMentions: { parse: ["roles"] }
      })
      .catch(() => null);

    if (message) this.app.lifecycle.setMessage(kind, record.id, channel.id, message.id);
    return message;
  }

  async refresh(guild, kind, record) {
    if (!record.message_id || !record.channel_id) return;
    const channel = await this.app.client.channels.fetch(record.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(record.message_id).catch(() => null);
    if (!message) return;

    const targetId = kind === "report" ? record.reporter_id : record.user_id;
    const user = await this.app.client.users.fetch(targetId).catch(() => null);
    await message
      .edit({ embeds: [this.buildEmbed(guild, kind, record, user)], components: this.buttons(kind, record) })
      .catch(() => {});
  }

  // ---------------- الرتب ----------------

  /**
   * يحدد الرتب التي ستُسحب فعليًا.
   * يستثني الرتب المعفاة، والرتب المُدارة، وأي رتبة أعلى من رتبة البوت.
   */
  removableRoles(guild, member, cfg) {
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return { roles: [], blocked: "البوت يفتقد صلاحية إدارة الرتب." };

    const exempt = new Set(cfg.exemptedRoles || []);
    const wanted = cfg.rolesToRemove || [];
    const source = wanted.length
      ? wanted.filter((id) => member.roles.cache.has(id))
      : [...member.roles.cache.keys()].filter((id) => id !== guild.id);

    const roles = source.filter((id) => {
      if (exempt.has(id)) return false;
      const role = guild.roles.cache.get(id);
      return role && !role.managed && role.position < me.roles.highest.position;
    });

    return { roles, blocked: null };
  }

  async applyLeave({ guild, member, record, reviewerId }) {
    const cfg = this.config(guild.id, "leave");
    const { roles, blocked } = this.removableRoles(guild, member, cfg);
    if (blocked) return { ok: false, reason: "actionFailed", details: blocked };

    const endsAt = record.duration_ms ? Date.now() + record.duration_ms : null;
    if (!this.app.lifecycle.activateLeave(record.id, { reviewerId, savedRoles: roles, endsAt })) {
      return { ok: false, reason: "alreadyDecided" };
    }

    for (const roleId of roles) {
      await member.roles.remove(roleId, "بدء إجازة").catch(() => {});
    }
    if (cfg.leaveRoleId) {
      const role = guild.roles.cache.get(cfg.leaveRoleId);
      if (role && role.position < guild.members.me.roles.highest.position) {
        await member.roles.add(role, "بدء إجازة").catch(() => {});
      }
    }

    const fresh = this.app.lifecycle.getById("leave", guild.id, record.id);
    await this.refresh(guild, "leave", fresh);
    await this._notify(guild, member.id, "leave", fresh, "accepted");
    await this._log(guild, "leave", fresh, "بدء إجازة", reviewerId);

    return { ok: true, record: fresh, roles };
  }

  /** إنهاء الإجازة واستعادة الرتب المحفوظة بدقة. */
  async endLeave({ guild, record, actorId, auto = false }) {
    if (!this.app.lifecycle.endLeave(record.id)) return { ok: false, reason: "notActive" };

    const member = await guild.members.fetch(record.user_id).catch(() => null);
    const cfg = this.config(guild.id, "leave");

    if (member) {
      const me = guild.members.me;
      for (const roleId of record.saved_roles || []) {
        const role = guild.roles.cache.get(roleId);
        if (role && !role.managed && role.position < me.roles.highest.position) {
          await member.roles.add(role, "انتهاء إجازة").catch(() => {});
        }
      }
      if (cfg.leaveRoleId && member.roles.cache.has(cfg.leaveRoleId)) {
        await member.roles.remove(cfg.leaveRoleId, "انتهاء إجازة").catch(() => {});
      }
    }

    const fresh = this.app.lifecycle.getById("leave", guild.id, record.id);
    await this.refresh(guild, "leave", fresh);
    await this._log(guild, "leave", fresh, auto ? "انتهاء إجازة تلقائيًا" : "إنهاء إجازة", actorId);

    if (member) {
      await member.user
        .send({
          embeds: [
            buildEmbed({
              title: "🌴 انتهت إجازتك",
              description: `انتهت إجازتك في **${guild.name}** واستُعيدت رتبك.`,
              color: this.app.config.color("success"),
              fields: [{ name: "الرتب المستعادة", value: `\`${(record.saved_roles || []).length}\`` }]
            })
          ]
        })
        .catch(() => {});
    }

    return { ok: true, record: fresh, restored: (record.saved_roles || []).length };
  }

  async applyResignation({ guild, member, record, reviewerId }) {
    const cfg = this.config(guild.id, "resign");
    const { roles, blocked } = this.removableRoles(guild, member, cfg);
    if (blocked) return { ok: false, reason: "actionFailed", details: blocked };

    if (!this.app.lifecycle.completeResignation(record.id, { reviewerId, savedRoles: roles })) {
      return { ok: false, reason: "alreadyDecided" };
    }

    for (const roleId of roles) {
      await member.roles.remove(roleId, "قبول استقالة").catch(() => {});
    }
    if (cfg.resignRoleId) {
      const role = guild.roles.cache.get(cfg.resignRoleId);
      if (role && role.position < guild.members.me.roles.highest.position) {
        await member.roles.add(role, "قبول استقالة").catch(() => {});
      }
    }

    const fresh = this.app.lifecycle.getById("resign", guild.id, record.id);
    await this.refresh(guild, "resign", fresh);
    await this._notify(guild, member.id, "resign", fresh, "accepted");
    await this._log(guild, "resign", fresh, "قبول استقالة", reviewerId);

    return { ok: true, record: fresh, roles };
  }

  /**
   * قبول بلاغ على إداري.
   * درجة التحذير تُحسب من عدد البلاغات المقبولة سابقًا، وتُعطى الرتبة المقابلة.
   */
  async acceptReport({ guild, record, reviewerId, note }) {
    const cfg = this.config(guild.id, "report");
    const previous = this.app.lifecycle.acceptedAgainst(guild.id, record.target_id);
    const level = Math.min(previous + 1, (cfg.warningRoleIds || []).length || 3);

    if (!this.app.lifecycle.acceptReport(record.id, { reviewerId, note, warningLevel: level })) {
      return { ok: false, reason: "alreadyDecided" };
    }

    const member = await guild.members.fetch(record.target_id).catch(() => null);
    const roleId = (cfg.warningRoleIds || [])[level - 1];
    let roleNote = null;

    if (member && roleId) {
      const role = guild.roles.cache.get(roleId);
      const me = guild.members.me;
      if (!role) roleNote = "رتبة التحذير محذوفة.";
      else if (role.position >= me.roles.highest.position) roleNote = `رتبة البوت أقل من <@&${roleId}>.`;
      else await member.roles.add(role, `تحذير إداري رقم ${level}`).catch(() => {});
    }

    const fresh = this.app.lifecycle.getById("report", guild.id, record.id);
    await this.refresh(guild, "report", fresh);
    await this._log(guild, "report", fresh, `قبول بلاغ — التحذير ${level}`, reviewerId);

    // عند الوصول للدرجة الأخيرة تُبلَّغ الإدارة العليا في قناتها
    if (level >= ((cfg.warningRoleIds || []).length || 3)) {
      await this._notifyUpperManagement(guild, fresh, level, cfg);
    }

    if (member) {
      await member.user
        .send({
          embeds: [
            buildEmbed({
              title: "⚠️ تحذير إداري",
              description: `تم قبول بلاغ ضدك في **${guild.name}**.`,
              color: this.app.config.color("danger"),
              fields: [
                { name: "درجة التحذير", value: `**${level}**`, inline: true },
                { name: "رقم البلاغ", value: `#${fresh.number}`, inline: true },
                ...(note ? [{ name: "ملاحظة الإدارة", value: truncate(note, 1000) }] : [])
              ]
            })
          ]
        })
        .catch(() => {});
    }

    return { ok: true, record: fresh, level, roleNote };
  }

  async _notifyUpperManagement(guild, record, level, cfg) {
    const channelId = cfg.upperChannelId || this.app.guildConfig.value(guild.id, "logs.reports");
    if (!channelId) return;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    await channel
      .send({
        content: cfg.upperManagementRoleId ? `<@&${cfg.upperManagementRoleId}>` : undefined,
        embeds: [
          buildEmbed({
            title: "🚨 وصول إداري للحد الأقصى من التحذيرات",
            description: `<@${record.target_id}> وصل للتحذير رقم **${level}** ويحتاج قرارًا من الإدارة العليا.`,
            color: this.app.config.color("danger"),
            fields: [
              { name: "رقم البلاغ", value: `#${record.number}`, inline: true },
              { name: "إجمالي البلاغات المقبولة", value: `\`${this.app.lifecycle.acceptedAgainst(guild.id, record.target_id)}\``, inline: true }
            ]
          })
        ],
        allowedMentions: { parse: ["roles"] }
      })
      .catch(() => {});
  }

  async _notify(guild, userId, kind, record, status) {
    const meta = KINDS[kind];
    const user = await this.app.client.users.fetch(userId).catch(() => null);
    if (!user) return;

    const accepted = status === "accepted";
    const fields = [{ name: "رقم الطلب", value: `#${record.number}`, inline: true }];
    if (record.reviewer_id) fields.push({ name: "المراجع", value: `<@${record.reviewer_id}>`, inline: true });
    if (record.ends_at) fields.push({ name: "تنتهي", value: timestamp(record.ends_at, "F"), inline: true });
    if (record.note) fields.push({ name: "السبب", value: truncate(record.note, 1000) });

    await user
      .send({
        embeds: [
          buildEmbed({
            title: `${meta.emoji} ${accepted ? "تم قبول" : "تم رفض"} طلب ${meta.label}`,
            description: `في سيرفر **${guild.name}**`,
            color: this.app.config.color(accepted ? "success" : "danger"),
            fields
          })
        ]
      })
      .catch(() => {});
  }

  async _log(guild, kind, record, title, actorId) {
    const channelId = this.app.guildConfig.value(guild.id, `logs.${KINDS[kind].log}`);
    if (!channelId) return;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const subject = kind === "report" ? record.target_id : record.user_id;
    await channel
      .send({
        embeds: [
          buildEmbed({
            title: `${KINDS[kind].emoji} ${title}`,
            color: this.app.config.color("info"),
            fields: [
              { name: "الرقم", value: `#${record.number}`, inline: true },
              { name: "العضو", value: `<@${subject}>`, inline: true },
              ...(actorId ? [{ name: "المنفّذ", value: `<@${actorId}>`, inline: true }] : [])
            ]
          })
        ]
      })
      .catch(() => {});
  }
}

module.exports = LifecycleService;
module.exports.KINDS = KINDS;
module.exports.STATUS = STATUS;
