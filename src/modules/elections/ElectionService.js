const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildEmbed, timestamp, truncate } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");

/**
 * الانتخابات بمرشحين.
 *
 * الفرق عن الاستطلاعات العامة: كل خيار (مرشح) له ملف كامل (اسم، برنامج، صورة)
 * ويحتاج تسجيلًا من العضو نفسه وموافقة إدارية قبل ظهوره للناخبين — بخلاف
 * خيارات الاستطلاع التي يكتبها منشئ الاستطلاع مباشرة.
 */
class ElectionService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "elections") || {};
  }

  enabled(guildId) {
    return !!this.config(guildId).enabled;
  }

  // ---------------- لوحة الانتخاب الرئيسية ----------------

  /** يبني لوحة الانتخاب بالشكل الحديث: العنوان، حالة المرحلة، وأزرار الإجراءات. */
  panelPayload(election) {
    const candidates = this.app.elections.listCandidates(election.id, { approvedOnly: true });
    const stageLabel = {
      registration: "🟢 التسجيل مفتوح",
      voting: "🗳️ التصويت مفتوح",
      closed: "🔴 انتهى الانتخاب"
    }[election.status];

    const text =
      `## 🗳️ ${election.title}\n\n` +
      (election.description ? `${election.description}\n\n` : "") +
      `**الحالة:** ${stageLabel}\n` +
      `**عدد المرشحين المعتمدين:** ${candidates.length}\n` +
      (election.status === "voting" ? `**إجمالي المصوّتين:** ${this.app.elections.totalVoters(election.id)}` : "");

    const rows = [];
    if (election.status === "registration") {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`election:register:${election.id}`).setLabel("تسجيل كمرشح").setEmoji("📝").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`election:candidates:${election.id}`).setLabel("عرض المرشحين").setEmoji("👥").setStyle(ButtonStyle.Secondary)
        )
      );
    } else if (election.status === "voting") {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`election:vote:${election.id}`).setLabel("صوّت الآن").setEmoji("🗳️").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`election:candidates:${election.id}`).setLabel("عرض المرشحين وبرامجهم").setEmoji("👥").setStyle(ButtonStyle.Secondary)
        )
      );
    } else {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`election:results:${election.id}`).setLabel("عرض النتائج").setEmoji("📊").setStyle(ButtonStyle.Success)
        )
      );
    }

    return containerPayload({ text, color: 0xC9A227, rows });
  }

  /** يحدّث رسالة اللوحة المنشورة بعد أي تغيير في حالة الانتخاب. */
  async refreshPanel(election) {
    if (!election.channel_id || !election.message_id) return;
    const channel = await this.app.client.channels.fetch(election.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(election.message_id).catch(() => null);
    if (!message) return;

    const payload = this.panelPayload(election);
    await message.edit({ flags: payload.flags, components: payload.components }).catch(() => {});
  }

  // ---------------- المرشحون ----------------

  candidateEmbed(guild, candidate, user) {
    return buildEmbed({
      title: `🗳️ ملف مرشح`,
      description: truncate(candidate.platform, 3000),
      color: this.app.config.color(
        candidate.status === "approved" ? "success" : candidate.status === "rejected" ? "danger" : "warning"
      ),
      thumbnail: candidate.image_url || user?.displayAvatarURL?.() || undefined,
      fields: [
        { name: "المرشح", value: `<@${candidate.user_id}>`, inline: true },
        { name: "الحالة", value: { pending: "⏳ بانتظار المراجعة", approved: "✅ معتمد", rejected: "❌ مرفوض" }[candidate.status], inline: true }
      ]
    });
  }

  candidatesListEmbed(election, candidates) {
    if (!candidates.length) {
      return buildEmbed({ description: "لا يوجد مرشحون معتمدون بعد.", color: this.app.config.color("neutral") });
    }
    return buildEmbed({
      title: `👥 مرشحو ${election.title}`,
      description: candidates
        .map((c) => `**<@${c.user_id}>**\n${truncate(c.platform, 300)}`)
        .join("\n\n"),
      color: this.app.config.color("primary")
    });
  }

  resultsEmbed(election, results) {
    const total = results.reduce((sum, r) => sum + r.votes, 0);
    const lines = results.map((r, i) => {
      const percent = total ? Math.round((r.votes / total) * 100) : 0;
      const bar = "█".repeat(Math.round(percent / 10)) + "░".repeat(10 - Math.round(percent / 10));
      const medal = election.status === "closed" && i === 0 && r.votes > 0 ? "🏆 " : "";
      return `${medal}<@${r.user_id}> — \`${r.votes}\` صوت (${percent}%)\n${bar}`;
    });

    return buildEmbed({
      title: `📊 نتائج ${election.title}`,
      description: lines.join("\n\n") || "لا توجد أصوات بعد.",
      color: this.app.config.color(election.status === "closed" ? "success" : "primary"),
      footer: `إجمالي الأصوات: ${total} • ${election.status === "closed" ? "الانتخاب مغلق" : "التصويت جارٍ"}`
    });
  }
}

module.exports = ElectionService;
