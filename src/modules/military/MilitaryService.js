const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { buildEmbed, timestamp, formatDuration, truncate } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");

/** أنواع البلاغات المتاحة للمواطنين. */
const REPORT_KINDS = [
  { label: "سرقة", value: "سرقة", emoji: "💰" },
  { label: "خطف", value: "خطف", emoji: "🚨" },
  { label: "قتل", value: "قتل", emoji: "🔴" },
  { label: "اعتداء", value: "اعتداء", emoji: "⚠️" },
  { label: "مطاردة", value: "مطاردة", emoji: "🚔" },
  { label: "أخرى", value: "أخرى", emoji: "📋" }
];

/**
 * النظام العسكري: مركز العمليات (الدوام)، النقاط، والبلاغات.
 *
 * رتبة الدوام تُعطى عند تسجيل الدخول وتُسحب عند الخروج، فتكون حالة العسكري
 * مرئية في قائمة الأعضاء لا في قاعدة البيانات فقط.
 */
class MilitaryService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "military") || {};
  }

  enabled(guildId) {
    return !!this.config(guildId).enabled;
  }

  /** يتحقق أن العضو ضمن الرتبة العسكرية المحددة (أو أن السيرفر لم يحدّد رتبة بعد). */
  isMilitary(guildId, member) {
    const roleId = this.config(guildId).roleId;
    if (!roleId) return true;
    return member.roles.cache.has(roleId);
  }

  // ---------------- مركز العمليات ----------------

  operationsPanelPayload(guildId) {
    const active = this.app.military.activeShifts(guildId).length;

    return containerPayload({
      text:
        "## 🎖️ مركز العمليات\n\n" +
        "• لتسجيل الدخول يرجى ضغط زر **تسجيل دخول**\n" +
        "• لتسجيل الخروج يرجى ضغط زر **تسجيل خروج**\n" +
        "• لكشف المباشرين يرجى ضغط **كشف المباشرين**\n\n" +
        `-# المباشرون الآن: **${active}**`,
      color: 0x2B2D31,
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("mil:duty:in").setLabel("تسجيل دخول").setEmoji("✅").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("mil:duty:out").setLabel("تسجيل خروج").setEmoji("❌").setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("mil:duty:list").setLabel("كشف المباشرين").setEmoji("👮").setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  /** يحدّث لوحة العمليات المنشورة ليبقى عدّاد المباشرين صادقًا. */
  async refreshOperationsPanel(guildId) {
    const cfg = this.config(guildId);
    if (!cfg.panelChannelId || !cfg.panelMessageId) return;

    const channel = await this.app.client.channels.fetch(cfg.panelChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(cfg.panelMessageId).catch(() => null);
    if (!message) return;

    const payload = this.operationsPanelPayload(guildId);
    await message.edit({ flags: payload.flags, components: payload.components }).catch(() => {});
  }

  /** يمنح رتبة الدوام أو يسحبها، مع احترام تسلسل الرتب وصلاحيات البوت. */
  async applyDutyRole(guild, member, add) {
    const roleId = this.config(guild.id).dutyRoleId;
    if (!roleId) return { ok: true, skipped: true };

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return { ok: false, reason: "missingPermission" };

    const role = guild.roles.cache.get(roleId);
    if (!role) return { ok: false, reason: "roleMissing" };
    if (role.managed || role.position >= me.roles.highest.position) return { ok: false, reason: "roleTooHigh" };

    const done = add
      ? await member.roles.add(role, "تسجيل دخول للدوام").then(() => true).catch(() => false)
      : await member.roles.remove(role, "تسجيل خروج من الدوام").then(() => true).catch(() => false);

    return { ok: done, reason: done ? null : "actionFailed" };
  }

  async logDuty(guild, { member, shift, kind }) {
    const channelId = this.config(guild.id).dutyLogChannelId;
    if (!channelId) return;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const points = this.app.military.getPoints(guild.id, member.id).points;
    const isIn = kind === "in";

    const fields = [
      { name: "العسكري", value: `<@${member.id}>`, inline: false },
      isIn
        ? { name: "وقت الدخول", value: timestamp(shift.started_at, "F") }
        : { name: "مدة الدوام", value: formatDuration(shift.duration_ms || 0) },
      { name: "عدد نقاط العسكري", value: `\`${points}\``, inline: true }
    ];

    await channel
      .send({
        embeds: [
          buildEmbed({
            title: isIn ? "✅ تسجيل دخول جديد" : "❌ تسجيل خروج",
            color: this.app.config.color(isIn ? "success" : "danger"),
            fields
          })
        ]
      })
      .catch(() => {});
  }

  activeShiftsEmbed(guild, shifts) {
    if (!shifts.length) {
      return buildEmbed({ title: "👮 المباشرون حاليًا", description: "لا يوجد عسكريون مباشرون الآن.", color: this.app.config.color("neutral") });
    }
    return buildEmbed({
      title: "👮 المباشرون حاليًا",
      description: shifts
        .map((s, i) => `**${i + 1}.** <@${s.user_id}> — منذ ${timestamp(s.started_at, "R")}`)
        .join("\n"),
      color: this.app.config.color("success"),
      footer: `الإجمالي: ${shifts.length}`
    });
  }

  // ---------------- النقاط ----------------

  pointsEmbed(guild, user, record, { forSelf = true } = {}) {
    return buildEmbed({
      title: forSelf ? "🎖️ نقاطي" : "🎖️ كشف النقاط",
      description: forSelf
        ? `عزيزي العسكري <@${user.id}>\n\nعدد نقاطك هي: **${record.points}**\n\nنتمنى لك يومًا سعيدًا.`
        : `العسكري: <@${user.id}>\nعدد النقاط: **${record.points}**`,
      color: this.app.config.color("primary"),
      thumbnail: user.displayAvatarURL?.() || undefined
    });
  }

  pointsChangeEmbed(guild, { actorId, targetId, amount, added, reason }) {
    return buildEmbed({
      title: added ? "➕ إضافة نقاط" : "➖ إزالة نقاط",
      color: this.app.config.color(added ? "success" : "danger"),
      fields: [
        { name: "المسؤول", value: `<@${actorId}>`, inline: true },
        { name: "العسكري", value: `<@${targetId}>`, inline: true },
        { name: added ? "النقاط المضافة" : "النقاط المُزالة", value: `\`${amount}\``, inline: true },
        { name: "الرصيد الحالي", value: `\`${this.app.military.getPoints(guild.id, targetId).points}\``, inline: true },
        ...(reason ? [{ name: "السبب", value: truncate(reason, 500) }] : [])
      ]
    });
  }

  leaderboardEmbed(guild, rows) {
    if (!rows.length) {
      return buildEmbed({ description: "لا توجد نقاط مسجّلة بعد.", color: this.app.config.color("neutral") });
    }
    const medals = ["🥇", "🥈", "🥉"];
    return buildEmbed({
      title: "🎖️ كشف نقاط العسكريين",
      description: rows
        .map((r, i) => `${medals[i] || `**${i + 1}.**`} <@${r.user_id}> — \`${r.points}\` نقطة`)
        .join("\n"),
      color: this.app.config.color("primary")
    });
  }

  // ---------------- البلاغات ----------------

  reportsPanelPayload() {
    return containerPayload({
      text:
        "## 🚨 قائمة البلاغات\n\n" +
        "• للبلاغ عن سرقة، خطف، قتل، إلخ — يرجى ضغط الزر\n" +
        "• يرجى كتابة النموذج بالكامل، وفي حال المخالفة = تحذير أول\n" +
        "• في حال استلام بلاغك من أحد العسكر سيتم إبلاغك في الخاص",
      color: 0x2B2D31,
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("mil:report:open").setLabel("بلاغ").setEmoji("🚨").setStyle(ButtonStyle.Danger)
        )
      ]
    });
  }

  reportEmbed(guild, report) {
    const statusLabel = { open: "🟢 مفتوح", claimed: "🟡 قيد المعالجة", closed: "🔴 مغلق" }[report.status];
    const fields = [
      { name: "المُبلِّغ", value: `<@${report.reporter_id}>`, inline: true },
      { name: "نوع البلاغ", value: report.kind, inline: true },
      { name: "الحالة", value: statusLabel, inline: true },
      { name: "التفاصيل", value: truncate(report.details, 1000) }
    ];
    if (report.location) fields.push({ name: "الموقع", value: truncate(report.location, 200), inline: true });
    if (report.suspect) fields.push({ name: "المشتبه به", value: truncate(report.suspect, 200), inline: true });
    if (report.handler_id) fields.push({ name: "المستلم", value: `<@${report.handler_id}>`, inline: true });

    return buildEmbed({
      title: `🚨 بلاغ #${report.number}`,
      color: this.app.config.color(report.status === "closed" ? "neutral" : report.status === "claimed" ? "warning" : "danger"),
      fields,
      footer: `بلاغ رقم ${report.number}`
    });
  }

  reportButtons(report) {
    if (report.status === "closed") return [];
    const row = new ActionRowBuilder();
    if (report.status === "open") {
      row.addComponents(
        new ButtonBuilder().setCustomId(`mil:report:claim:${report.id}`).setLabel("استلام البلاغ").setEmoji("🚔").setStyle(ButtonStyle.Primary)
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId(`mil:report:close:${report.id}`).setLabel("إغلاق البلاغ").setEmoji("✅").setStyle(ButtonStyle.Secondary)
    );
    return [row];
  }

  async refreshReport(guild, report) {
    if (!report.channel_id || !report.message_id) return;
    const channel = await this.app.client.channels.fetch(report.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(report.message_id).catch(() => null);
    if (!message) return;

    await message
      .edit({ embeds: [this.reportEmbed(guild, report)], components: this.reportButtons(report) })
      .catch(() => {});
  }

  // ---------------- الترقية الآلية بالنقاط ----------------

  /**
   * يمنح العضو الرتبة التي تستحقها نقاطه، ويسحب رتب السلّم الأخرى.
   * السحب ضروري وإلا تراكمت الرتب القديمة على العضو مع كل ترقية.
   *
   * @returns {{ok: boolean, reason?: string, rank?: object, previous?: object}}
   */
  async promote(guild, member) {
    const ranks = this.app.military.listRanks(guild.id);
    if (!ranks.length) return { ok: false, reason: "noRanks" };

    const points = this.app.military.getPoints(guild.id, member.id).points;
    const deserved = this.app.military.rankFor(guild.id, points);
    if (!deserved) {
      const lowest = ranks[0];
      return { ok: false, reason: "notEnough", points, needed: lowest.points, nextLabel: lowest.label };
    }

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return { ok: false, reason: "missingPermission" };

    const role = guild.roles.cache.get(deserved.role_id);
    if (!role) return { ok: false, reason: "roleMissing" };
    if (role.managed || role.position >= me.roles.highest.position) return { ok: false, reason: "roleTooHigh" };

    if (member.roles.cache.has(role.id)) {
      const next = ranks.find((r) => r.points > points);
      return { ok: false, reason: "already", rank: deserved, next };
    }

    // نسحب رتب السلّم الأخرى فقط — لا نلمس رتب العضو الأخرى
    const previousRank = ranks.find((r) => r.role_id !== deserved.role_id && member.roles.cache.has(r.role_id));
    for (const r of ranks) {
      if (r.role_id === deserved.role_id) continue;
      if (!member.roles.cache.has(r.role_id)) continue;
      const old = guild.roles.cache.get(r.role_id);
      if (old && !old.managed && old.position < me.roles.highest.position) {
        await member.roles.remove(old, "ترقية عسكرية").catch(() => {});
      }
    }

    await member.roles.add(role, "ترقية عسكرية").catch(() => {});
    return { ok: true, rank: deserved, previous: previousRank, points };
  }

  ranksEmbed(guild, ranks) {
    if (!ranks.length) {
      return buildEmbed({
        description: "لم يُضبط سلّم الرتب بعد. أضِف رتبة بـ `/عسكرية رتبة-اضافة`.",
        color: this.app.config.color("neutral")
      });
    }
    return buildEmbed({
      title: "🎖️ سلّم الرتب العسكرية",
      description: ranks.map((r) => `**${r.points}** نقطة → <@&${r.role_id}> (${r.label})`).join("\n"),
      color: this.app.config.color("primary"),
      footer: "العضو يستلم ترقيته بـ /عسكرية ترقية"
    });
  }
}

module.exports = MilitaryService;
module.exports.REPORT_KINDS = REPORT_KINDS;
