const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildEmbed, timestamp, truncate, formatDuration } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");

/**
 * الأنظمة الحكومية: مجلس الشورى، التعميمات، والتقاعد.
 *
 * مجلس الشورى يختلف عن `/انتخابات`: هناك تختار مرشحًا، وهنا تصوّت
 * بموافقة أو رفض أو امتناع على **مشروع قرار**، ثم يتخذ الرئيس القرار النهائي.
 */
class GovernmentService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "government") || {};
  }

  enabled(guildId) {
    return !!this.config(guildId).enabled;
  }

  /** هل العضو من أعضاء المجلس المخوّلين بالتصويت؟ */
  isCouncil(guildId, member) {
    const roleId = this.config(guildId).councilRoleId;
    if (!roleId) return true;
    return member.roles.cache.has(roleId);
  }

  // ---------------- مجلس الشورى ----------------

  projectPayload(project) {
    const counts = this.app.government.voteCounts(project.id);
    const total = counts.yes + counts.no + counts.abstain;
    const statusLabel = {
      open: "🟢 التصويت مفتوح",
      approved: "✅ اعتُمد المشروع",
      rejected: "❌ رُفض المشروع"
    }[project.status];

    const text =
      `## 🏛️ مشروع قرار #${project.number}\n\n` +
      `**${project.title}**\n\n` +
      `**الهدف من المشروع:**\n${project.goal}\n\n` +
      (project.details ? `**تفاصيل:**\n${truncate(project.details, 800)}\n\n` : "") +
      `**مقدّم المشروع:** <@${project.proposer_id}>\n` +
      `**الحالة:** ${statusLabel}\n` +
      (project.session_time ? `**ميقات الجلسة:** ${project.session_time}\n` : "") +
      (project.reason ? `**سبب القرار:** ${truncate(project.reason, 400)}\n` : "") +
      `\n✅ موافق: **${counts.yes}** • ❌ رافض: **${counts.no}** • ⚪ ممتنع: **${counts.abstain}** • الإجمالي: **${total}**`;

    const rows = [];
    if (project.status === "open") {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`gov:vote:${project.id}:yes`).setLabel("موافق").setEmoji("✅").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`gov:vote:${project.id}:no`).setLabel("رافض").setEmoji("❌").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`gov:vote:${project.id}:abstain`).setLabel("ممتنع").setEmoji("⚪").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`gov:approve:${project.id}`).setLabel("اعتماد المشروع").setEmoji("🏛️").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`gov:reject:${project.id}`).setLabel("رفض المشروع").setEmoji("🚫").setStyle(ButtonStyle.Secondary)
        )
      );
    }

    return containerPayload({
      text,
      color: project.status === "approved" ? 0x2ECC71 : project.status === "rejected" ? 0xE74C3C : 0xC9A227,
      rows
    });
  }

  async refreshProject(project) {
    if (!project.channel_id || !project.message_id) return;
    const channel = await this.app.client.channels.fetch(project.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(project.message_id).catch(() => null);
    if (!message) return;

    const payload = this.projectPayload(project);
    await message.edit({ flags: payload.flags, components: payload.components }).catch(() => {});
  }

  councilPanelPayload() {
    return containerPayload({
      text:
        "## 🏛️ مجلس الشورى\n\n" +
        "— لتقديم مشروع قرار للمجلس اضغط الزر بالأسفل.\n" +
        "— يُعرض المشروع على الأعضاء للتصويت (موافق / رافض / ممتنع).\n" +
        "— القرار النهائي يتخذه رئيس المجلس بعد انتهاء التصويت.",
      color: 0xC9A227,
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("gov:propose").setLabel("تقديم مشروع قرار").setEmoji("📜").setStyle(ButtonStyle.Primary)
        )
      ]
    });
  }

  // ---------------- التعميمات ----------------

  circularPayload(guild, circular) {
    return containerPayload({
      text:
        `## 📢 تعميم إداري رقم (${circular.number})\n\n` +
        `**${circular.title}**\n\n` +
        `${circular.body}\n\n` +
        `-# ${circular.authority || "الإدارة العامة"} • أصدره <@${circular.issuer_id}> • ${timestamp(circular.created_at, "D")}`,
      color: 0x5865F2
    });
  }

  // ---------------- التقاعد ----------------

  retirementPayload(guild, retirement) {
    return containerPayload({
      text:
        `## 🎗️ قرار تقاعد رقم (${retirement.number})\n\n` +
        `**المتقاعد:** <@${retirement.user_id}>\n` +
        (retirement.service_ms ? `**مدة الخدمة:** ${formatDuration(retirement.service_ms)}\n` : "") +
        (retirement.reason ? `**السبب:** ${truncate(retirement.reason, 500)}\n` : "") +
        (retirement.honor ? `\n${retirement.honor}\n` : "") +
        (retirement.saved_roles.length ? `\n**الرتب المسحوبة:** ${retirement.saved_roles.length}\n` : "") +
        `\n-# أصدره <@${retirement.retired_by}> • ${timestamp(retirement.created_at, "D")}`,
      color: 0xF1C40F
    });
  }

  /**
   * يسحب رتب الطاقم عند التقاعد ويحفظها في السجل.
   * يحترم الرتب المعفاة وتسلسل رتبة البوت، بنفس منطق نظام الإجازات.
   */
  async retire(guild, member, { reason, honor, retiredBy }) {
    const cfg = this.config(guild.id);
    const me = guild.members.me;
    const exempt = new Set(cfg.retirementExemptRoles || []);

    const removable = [...member.roles.cache.keys()].filter((id) => {
      if (id === guild.id) return false;
      if (exempt.has(id)) return false;
      const role = guild.roles.cache.get(id);
      return role && !role.managed && role.position < me.roles.highest.position;
    });

    // مدة الخدمة تُحسب من تاريخ الانضمام للسيرفر
    const serviceMs = member.joinedTimestamp ? Date.now() - member.joinedTimestamp : null;

    const record = this.app.government.createRetirement({
      guildId: guild.id,
      userId: member.id,
      reason,
      honor,
      savedRoles: removable,
      serviceMs,
      retiredBy
    });

    for (const roleId of removable) {
      await member.roles.remove(roleId, "تقاعد").catch(() => {});
    }

    if (cfg.retiredRoleId) {
      const role = guild.roles.cache.get(cfg.retiredRoleId);
      if (role && !role.managed && role.position < me.roles.highest.position) {
        await member.roles.add(role, "تقاعد").catch(() => {});
      }
    }

    return { ok: true, record, removed: removable.length };
  }
}

module.exports = GovernmentService;
