const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require("discord.js");
const { buildEmbed, truncate, timestamp, formatDuration } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");

/**
 * أنواع التحقق من إنجاز المهمة.
 *
 * الفكرة الجوهرية: البوت **يقيس** الإنجاز من بيانات السيرفر الحقيقية بدل
 * تصديق ضغطة زر. عند الاستلام تُؤخذ لقطة (baseline) للرقم الحالي، وعند
 * الضغط على "تم الإنجاز" يُقاس الفرق — فلا يُحتسب عمل سابق للاستلام.
 *
 * `manual` هو الاستثناء الوحيد: يحتاج تصديق إداري لأنه غير قابل للقياس.
 */
const VERIFIERS = {
  manual: {
    label: "تصديق إداري",
    unit: "",
    measurable: false,
    read: () => 0
  },
  messages: {
    label: "عدد الرسائل",
    unit: "رسالة",
    measurable: true,
    read: (app, guildId, userId) => app.activity.summary(guildId, userId, 1).today?.messages ?? 0
  },
  voice_minutes: {
    label: "دقائق الصوت",
    unit: "دقيقة",
    measurable: true,
    read: (app, guildId, userId) => Math.floor((app.activity.summary(guildId, userId, 1).voice_seconds || 0) / 60)
  },
  tickets_claimed: {
    label: "تذاكر مستلمة",
    unit: "تذكرة",
    measurable: true,
    read: (app, guildId, userId) => app.activity.summary(guildId, userId, 7).tickets_claimed ?? 0
  },
  tickets_closed: {
    label: "تذاكر مغلقة",
    unit: "تذكرة",
    measurable: true,
    read: (app, guildId, userId) => app.activity.summary(guildId, userId, 7).tickets_closed ?? 0
  },
  ratings: {
    label: "تقييمات مستلمة",
    unit: "تقييم",
    measurable: true,
    read: (app, guildId, userId) => app.tickets.staffRating(guildId, userId)?.count ?? 0
  },
  violations: {
    label: "مخالفات صادرة",
    unit: "مخالفة",
    measurable: true,
    read: (app, guildId, userId) => {
      try {
        return app.violations.db
          .prepare("SELECT COUNT(*) AS c FROM violations WHERE guild_id = ? AND officer_id = ?")
          .get(guildId, userId).c;
      } catch {
        return 0;
      }
    }
  },
  checkins: {
    label: "أيام حضور",
    unit: "يوم",
    measurable: true,
    read: (app, guildId, userId) => app.activity.checkInCount(guildId, userId, 30)
  },
  points: {
    label: "نقاط النشاط",
    unit: "نقطة",
    measurable: true,
    read: (app, guildId, userId) => {
      const w = app.guildConfig.value(guildId, "staff.points") || {};
      return Math.floor(app.activity.points(guildId, userId, 30, w).total);
    }
  }
};

const DIFFICULTY = {
  easy: { label: "سهلة", color: 0x57F287, emoji: "🟢" },
  normal: { label: "متوسطة", color: 0x5865F2, emoji: "🔵" },
  hard: { label: "صعبة", color: 0xFEE75C, emoji: "🟡" },
  elite: { label: "نخبة", color: 0xED4245, emoji: "🔴" }
};

/** مهام جاهزة تُزرع بأمر واحد — مصمّمة لتكون قابلة للقياس الآلي. */
const PRESETS = [
  // يومية
  { key: "daily_messages", title: "تفاعل مع السيرفر", description: "اكتب 20 رسالة في أي روم اليوم.", kind: "daily", verifyType: "messages", verifyTarget: 20, maxClaims: 0, rewardPoints: 2, difficulty: "easy", emoji: "💬" },
  { key: "daily_voice", title: "حضور صوتي", description: "اقضِ 30 دقيقة في الرومات الصوتية.", kind: "daily", verifyType: "voice_minutes", verifyTarget: 30, maxClaims: 0, rewardPoints: 3, difficulty: "easy", emoji: "🎙️" },
  { key: "daily_ticket", title: "استلام تذكرة", description: "استلم تذكرة دعم واحدة ورُد عليها.", kind: "daily", verifyType: "tickets_claimed", verifyTarget: 1, maxClaims: 5, rewardPoints: 3, difficulty: "normal", emoji: "🎫" },
  { key: "daily_close2", title: "إغلاق تذكرتين", description: "أغلق تذكرتين بعد حل مشكلتيهما.", kind: "daily", verifyType: "tickets_closed", verifyTarget: 2, maxClaims: 5, rewardPoints: 5, difficulty: "normal", emoji: "✅" },
  { key: "daily_checkin", title: "الحضور اليومي", description: "سجّل حضورك اليوم.", kind: "daily", verifyType: "checkins", verifyTarget: 1, maxClaims: 0, rewardPoints: 1, difficulty: "easy", emoji: "📅" },
  { key: "daily_violation", title: "ضبط مخالفة", description: "أصدر مخالفة موثّقة لمخالف.", kind: "daily", verifyType: "violations", verifyTarget: 1, maxClaims: 3, rewardPoints: 4, difficulty: "normal", emoji: "⚖️" },
  { key: "daily_welcome", title: "ترحيب بالأعضاء", description: "رحّب بالأعضاء الجدد في روم الترحيب.", kind: "daily", verifyType: "manual", verifyTarget: 1, maxClaims: 2, rewardPoints: 2, difficulty: "easy", emoji: "👋" },
  { key: "daily_patrol", title: "جولة تفقدية", description: "تفقّد كل الرومات وأبلغ عن أي مخالفة.", kind: "daily", verifyType: "manual", verifyTarget: 1, maxClaims: 2, rewardPoints: 3, difficulty: "normal", emoji: "🔍" },
  { key: "daily_active", title: "نشاط مكثّف", description: "اكتب 60 رسالة اليوم.", kind: "daily", verifyType: "messages", verifyTarget: 60, maxClaims: 0, rewardPoints: 5, difficulty: "hard", emoji: "🔥" },
  { key: "daily_help", title: "مساعدة عضو", description: "ساعد عضوًا في استفساره حتى الحل.", kind: "daily", verifyType: "manual", verifyTarget: 1, maxClaims: 4, rewardPoints: 2, difficulty: "easy", emoji: "🤝" },

  // أسبوعية
  { key: "weekly_tickets", title: "بطل التذاكر", description: "أغلق 10 تذاكر خلال الأسبوع.", kind: "weekly", verifyType: "tickets_closed", verifyTarget: 10, maxClaims: 3, rewardPoints: 20, difficulty: "hard", emoji: "🏆" },
  { key: "weekly_ratings", title: "رضا الأعضاء", description: "احصل على 5 تقييمات على خدمتك.", kind: "weekly", verifyType: "ratings", verifyTarget: 5, maxClaims: 0, rewardPoints: 15, difficulty: "hard", emoji: "⭐" },
  { key: "weekly_attendance", title: "التزام أسبوعي", description: "سجّل حضورك 6 أيام.", kind: "weekly", verifyType: "checkins", verifyTarget: 6, maxClaims: 0, rewardPoints: 12, difficulty: "normal", emoji: "📆" },
  { key: "weekly_points", title: "صدارة النشاط", description: "اجمع 50 نقطة نشاط.", kind: "weekly", verifyType: "points", verifyTarget: 50, maxClaims: 0, rewardPoints: 25, difficulty: "elite", emoji: "💎" },
  { key: "weekly_voice", title: "ماراثون صوتي", description: "اقضِ 300 دقيقة صوتية خلال الأسبوع.", kind: "weekly", verifyType: "voice_minutes", verifyTarget: 300, maxClaims: 0, rewardPoints: 18, difficulty: "hard", emoji: "🎧" },
  { key: "weekly_audit", title: "تدقيق أمني", description: "افحص الروابط والبوتات وارفع تقريرًا.", kind: "weekly", verifyType: "manual", verifyTarget: 1, maxClaims: 1, rewardPoints: 20, difficulty: "elite", emoji: "🛡️" },
  { key: "weekly_report", title: "تقرير الأداء", description: "اكتب تقريرًا عن أداء الطاقم مع توصيات.", kind: "weekly", verifyType: "manual", verifyTarget: 1, maxClaims: 1, rewardPoints: 20, difficulty: "elite", emoji: "📊" },
  { key: "weekly_event", title: "تنظيم فعالية", description: "نظّم فعالية كاملة: إعلان وتنفيذ وجوائز.", kind: "weekly", verifyType: "manual", verifyTarget: 1, maxClaims: 2, rewardPoints: 30, difficulty: "elite", emoji: "🎉" },
  { key: "weekly_rules", title: "تحديث القوانين", description: "راجع قوانين السيرفر وحدّثها.", kind: "weekly", verifyType: "manual", verifyTarget: 1, maxClaims: 1, rewardPoints: 15, difficulty: "hard", emoji: "📜" },
  { key: "weekly_violations", title: "ضبط المخالفين", description: "أصدر 5 مخالفات موثّقة.", kind: "weekly", verifyType: "violations", verifyTarget: 5, maxClaims: 3, rewardPoints: 18, difficulty: "hard", emoji: "⚔️" }
];

class QuestService {
  constructor(app) {
    this.app = app;
    this.timer = null;
  }

  config(guildId) {
    const c = this.app.guildConfig.value(guildId, "quests") || {};
    return {
      enabled: !!c.enabled,
      channelId: c.channelId || null,
      defaultTimeoutMs: c.defaultTimeoutMs ?? 3_600_000,
      logChannelId: c.logChannelId || null,
      ...c
    };
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), 300_000);
    if (this.timer.unref) this.timer.unref();
    this.tick().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** يلغي الاستلامات المنتهية ويغلق الدورات المنتهية. */
  async tick() {
    for (const claim of this.app.quests.expiredClaims()) {
      if (this.app.quests.expire(claim.id)) {
        await this.refreshCycle(claim.cycle_id).catch(() => {});
      }
    }
    for (const cycle of this.app.quests.dueCycles()) {
      if (this.app.quests.closeCycle(cycle.id)) {
        await this.refreshCycle(cycle.id).catch(() => {});
      }
    }
  }

  verifier(type) {
    return VERIFIERS[type] || VERIFIERS.manual;
  }

  difficulty(key) {
    return DIFFICULTY[key] || DIFFICULTY.normal;
  }

  verifierChoices() {
    return Object.entries(VERIFIERS).map(([value, v]) => ({ name: v.label, value }));
  }

  /** اللقطة عند الاستلام — الأساس الذي يُقاس منه التقدّم. */
  baselineFor(quest, guildId, userId) {
    const v = this.verifier(quest.verify_type);
    if (!v.measurable) return 0;
    return v.read(this.app, guildId, userId) || 0;
  }

  /**
   * يقيس التقدّم الفعلي منذ الاستلام.
   * @returns {{measurable:boolean, done:number, target:number, ok:boolean, label:string, unit:string}}
   */
  measure(quest, claim) {
    const v = this.verifier(quest.verify_type);
    const target = quest.verify_target || 1;

    if (!v.measurable) {
      return { measurable: false, done: 0, target, ok: false, label: v.label, unit: v.unit };
    }

    const now = v.read(this.app, claim.guild_id, claim.user_id) || 0;
    const done = Math.max(0, now - (claim.baseline || 0));
    return { measurable: true, done, target, ok: done >= target, label: v.label, unit: v.unit };
  }

  /** يزرع المهام الجاهزة. لا يلمس ما هو موجود. */
  seed(guildId, createdBy) {
    let added = 0, skipped = 0;
    for (const preset of PRESETS) {
      if (this.app.quests.get(guildId, preset.key)) { skipped++; continue; }
      this.app.quests.create({ ...preset, guildId, createdBy });
      added++;
    }
    return { added, skipped, total: PRESETS.length };
  }

  // ---------------- العرض ----------------

  /** بطاقة المهمة المنشورة. */
  cardPayload(guild, quest, cycle) {
    const diff = this.difficulty(quest.difficulty);
    const v = this.verifier(quest.verify_type);
    const claims = this.app.quests.claimsFor(cycle.id);
    const taken = claims.filter((c) => c.status === "claimed" || c.status === "completed").length;
    const done = claims.filter((c) => c.status === "completed");
    const active = claims.filter((c) => c.status === "claimed");

    const capacity = quest.max_claims > 0 ? `${taken} / ${quest.max_claims}` : `${taken} / ∞`;
    const closed = !!cycle.closed_at;
    const full = quest.max_claims > 0 && taken >= quest.max_claims;

    const text =
      `## ${quest.emoji || diff.emoji} ${quest.title}\n\n` +
      (quest.description ? `${quest.description}\n\n` : "") +
      `**الصعوبة**\n${diff.emoji} ${diff.label}\n\n` +
      `**شرط الإنجاز**\n${v.measurable ? `${v.label}: **${quest.verify_target}** ${v.unit}` : "تصديق إداري"}\n\n` +
      `**المقاعد**\n${capacity}\n\n` +
      (quest.reward_points || quest.reward_money
        ? `**المكافأة**\n${quest.reward_points ? `⭐ ${quest.reward_points} نقطة` : ""}${quest.reward_points && quest.reward_money ? " • " : ""}${quest.reward_money ? `💰 ${quest.reward_money}` : ""}\n\n`
        : "") +
      (active.length ? `**قيد التنفيذ**\n${active.map((c) => `<@${c.user_id}>`).join(" • ")}\n\n` : "") +
      (done.length ? `**أنجزها**\n${done.map((c) => `<@${c.user_id}>`).join(" • ")}\n\n` : "") +
      `-# ${closed ? "🔒 الدورة مغلقة" : full ? "🚫 اكتملت المقاعد" : "🟢 متاحة"}` +
      (cycle.closes_at && !closed ? ` • تُغلق ${timestamp(cycle.closes_at, "R")}` : "");

    const rows = [];
    if (!closed) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`qs:claim:${cycle.id}`).setLabel("استلام المهمة")
            .setEmoji("🙋").setStyle(ButtonStyle.Success).setDisabled(full),
          new ButtonBuilder().setCustomId(`qs:done:${cycle.id}`).setLabel("تم الإنجاز")
            .setEmoji("✅").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`qs:drop:${cycle.id}`).setLabel("تخلّي")
            .setEmoji("↩️").setStyle(ButtonStyle.Secondary)
        )
      );
    }

    return containerPayload({ text, color: diff.color, rows });
  }

  async refreshCycle(cycleId) {
    const cycle = this.app.quests.getCycle(cycleId);
    if (!cycle?.channel_id || !cycle.message_id) return;

    const channel = await this.app.client.channels.fetch(cycle.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(cycle.message_id).catch(() => null);
    if (!message) return;

    const quest = this.app.quests.getById(cycle.quest_id);
    if (!quest) return;
    const guild = this.app.client.guilds.cache.get(cycle.guild_id) || { id: cycle.guild_id, name: "" };

    const payload = this.cardPayload(guild, quest, cycle);
    await message.edit({ flags: payload.flags, components: payload.components }).catch(() => {});
  }

  async log(guildId, embed) {
    const channelId = this.config(guildId).logChannelId;
    if (!channelId) return;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => {});
  }

  /** يصرف المكافأة. النقاط تُسجَّل كإنجاز، والمال عبر نظام الاقتصاد. */
  async grantReward(guildId, userId, quest) {
    if (quest.reward_money > 0 && this.app.economyService) {
      this.app.economyService.add(guildId, userId, quest.reward_money, {
        target: "wallet",
        reason: `مكافأة مهمة: ${quest.title}`
      });
    }
  }
}

module.exports = QuestService;
module.exports.VERIFIERS = VERIFIERS;
module.exports.DIFFICULTY = DIFFICULTY;
module.exports.PRESETS = PRESETS;
