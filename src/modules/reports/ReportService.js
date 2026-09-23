const { PermissionFlagsBits } = require("discord.js");
const { buildEmbed, formatDuration, timestamp, dayKey } = require("../../core/utils/helpers");

const SECTIONS = {
  tickets: "التذاكر",
  staff: "نشاط الطاقم",
  ratings: "التقييمات",
  moderation: "الإجراءات الإدارية",
  applications: "التقديمات",
  inactive: "الطاقم غير النشط"
};

const WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/**
 * التقارير الدورية وتنبيهات انخفاض النشاط.
 *
 * التشغيل يُسجَّل بمفتاح اليوم لا بالوقت، فإعادة تشغيل البوت
 * في نفس اليوم لا تُرسل التقرير مرتين.
 */
class ReportService {
  constructor(app) {
    this.app = app;
    this.timer = null;
  }

  start() {
    // فحص كل عشر دقائق يكفي لدقة الساعة المطلوبة
    this.timer = setInterval(() => this.tick().catch(() => {}), 10 * 60_000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    const now = new Date();
    const today = dayKey(now);

    for (const schedule of this.app.reports.dueSchedules()) {
      const guild = this.app.client.guilds.cache.get(schedule.guild_id);
      if (!guild) continue;
      if (!this.isDue(schedule, now, today)) continue;

      // العلامة أولًا: لو فشل الإرسال لا نكرر المحاولة كل عشر دقائق
      if (!this.app.reports.markRun(schedule.guild_id, today)) continue;

      await this.send(guild, schedule).catch((err) =>
        this.app.errors.capture(err, { system: "reports", guildId: guild.id })
      );
    }
  }

  isDue(schedule, now, today) {
    if (schedule.last_run_day === today) return false;
    if (now.getUTCHours() < schedule.hour) return false;
    if (schedule.frequency === "weekly" && now.getUTCDay() !== schedule.weekday) return false;
    return true;
  }

  /** يجمع البيانات ويُرسل التقرير. */
  async send(guild, schedule) {
    const channel = await this.app.client.channels.fetch(schedule.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return { ok: false, reason: "noChannel" };

    const me = guild.members.me;
    if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) return { ok: false, reason: "noPermission" };

    const days = schedule.frequency === "daily" ? 1 : 7;
    const embed = await this.build(guild, days, schedule.sections);

    await channel
      .send({
        content: schedule.mention_role_id ? `<@&${schedule.mention_role_id}>` : undefined,
        embeds: [embed],
        allowedMentions: { parse: ["roles"] }
      })
      .catch(() => {});

    return { ok: true };
  }

  /** يبني إمبيد التقرير حسب الأقسام المطلوبة. */
  async build(guild, days, sections = []) {
    const wanted = sections.length ? sections : Object.keys(SECTIONS);
    const guildId = guild.id;
    const fields = [];

    if (wanted.includes("tickets")) {
      const stats = this.app.tickets.stats(guildId);
      fields.push({
        name: "🎫 التذاكر",
        value: `مفتوحة: \`${stats.open}\`\nمغلقة: \`${stats.closed}\``,
        inline: true
      });
    }

    if (wanted.includes("ratings")) {
      const r = this.app.tickets.guildRatingStats(guildId);
      fields.push({
        name: "⭐ التقييمات",
        value: r.count ? `المتوسط: \`${r.average.toFixed(2)}\`\nالعدد: \`${r.count}\`` : "لا توجد",
        inline: true
      });
    }

    if (wanted.includes("moderation")) {
      const recent = this.app.cases.recent(guildId, 1);
      fields.push({
        name: "🛡️ الإجراءات",
        value: `آخر قضية: \`#${recent[0]?.case_number || 0}\``,
        inline: true
      });
    }

    if (wanted.includes("applications")) {
      const s = this.app.applications.stats(guildId);
      fields.push({
        name: "📋 التقديمات",
        value: `معلّقة: \`${s.pending}\`\nمقبولة: \`${s.accepted}\` • مرفوضة: \`${s.rejected}\``,
        inline: true
      });
    }

    if (wanted.includes("staff")) {
      const top = this.app.activity.leaderboard(guildId, "messages", days, 5);
      fields.push({
        name: `👥 أنشط الطاقم (${days} يوم)`,
        value: top.length
          ? top.map((r, i) => `**${i + 1}.** <@${r.user_id}> — \`${r.total}\` رسالة`).join("\n")
          : "لا توجد بيانات"
      });

      const voice = this.app.activity.leaderboard(guildId, "voice_seconds", days, 3);
      if (voice.length) {
        fields.push({
          name: "🔊 الأكثر تواجدًا صوتيًا",
          value: voice.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${formatDuration(r.total * 1000)}`).join("\n")
        });
      }

      const claims = this.app.activity.leaderboard(guildId, "tickets_claimed", days, 3);
      if (claims.length) {
        fields.push({
          name: "🎫 الأكثر استلامًا للتذاكر",
          value: claims.map((r, i) => `**${i + 1}.** <@${r.user_id}> — \`${r.total}\``).join("\n")
        });
      }
    }

    if (wanted.includes("inactive")) {
      const inactive = await this.inactiveStaff(guild, days);
      fields.push({
        name: `😴 طاقم بلا نشاط (${days} يوم)`,
        value: inactive.length
          ? inactive.slice(0, 10).map((m) => `• <@${m.id}> — ${m.messages === 0 ? "بلا نشاط إطلاقًا" : `\`${m.messages}\` رسالة`}`).join("\n")
          : "✅ كل الطاقم نشط"
      });
    }

    return buildEmbed({
      title: `📊 التقرير ${days === 1 ? "اليومي" : "الأسبوعي"} — ${guild.name}`,
      description: `الفترة: آخر **${days}** ${days === 1 ? "يوم" : "أيام"}\nحتى ${timestamp(Date.now(), "F")}`,
      color: this.app.config.color("primary"),
      fields,
      thumbnail: guild.iconURL() || undefined
    });
  }

  /**
   * أعضاء الطاقم الذين لم يبلغوا الحد الأدنى من النشاط.
   * يعتمد على رتبة الطاقم الأساسية، فبدونها لا معنى للتقرير.
   */
  async inactiveStaff(guild, days) {
    const cfg = this.app.guildConfig.get(guild.id);
    const staffRoleId = cfg.staff?.baseRoleId;
    if (!staffRoleId) return [];

    const role = guild.roles.cache.get(staffRoleId);
    if (!role) return [];

    const minMessages = cfg.staff?.minMessages ?? 10;
    const results = [];

    // نجلب الأعضاء مرة واحدة، ثم نقرأ نشاط كل واحد من قاعدة البيانات
    await guild.members.fetch().catch(() => null);

    for (const member of role.members.values()) {
      if (member.user.bot) continue;
      const summary = this.app.activity.summary(guild.id, member.id, days);
      if (summary.messages < minMessages) {
        results.push({ id: member.id, messages: summary.messages, voice: summary.voice_seconds });
      }
    }

    return results.sort((a, b) => a.messages - b.messages);
  }
}

module.exports = ReportService;
module.exports.SECTIONS = SECTIONS;
module.exports.WEEKDAYS = WEEKDAYS;
