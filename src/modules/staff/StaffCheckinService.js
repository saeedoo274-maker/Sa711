const { buildEmbed, truncate, timestamp } = require("../../core/utils/helpers");

/** النص الافتراضي للتحذير. المتغيرات تُستبدل عند الإرسال. */
const DEFAULT_WARNING =
  "⚠️ تنبيه غياب\n\n" +
  "مرحبًا {user}، لاحظنا غيابك عن **{server}**.\n" +
  "آخر تسجيل دخول لك كان قبل **{days}** يوم.\n\n" +
  "يُرجى تسجيل الدخول اليومي بكتابة رسالة في أي روم، أو من زر **تسجيل دخول** في لوحة الإدارة.";

/**
 * تسجيل الدخول اليومي للإداريين.
 *
 * الفكرة: كل إداري يسجّل حضوره مرة يوميًا. التسجيل يحدث **تلقائيًا**
 * بأول رسالة يكتبها في أي روم — فلا يحتاج أمرًا ولا زرًا، والزر موجود
 * لمن أراد التسجيل صراحةً بلا كتابة.
 *
 * ومن غاب أكثر من الحد المسموح يصله تحذير **مرة واحدة يوميًا**،
 * بنص قابل للتعديل بالكامل من لوحة الإدارة.
 */
class StaffCheckinService {
  constructor(app) {
    this.app = app;
    this.timer = null;
  }

  config(guildId) {
    const cfg = this.app.guildConfig.value(guildId, "staff.checkin") || {};
    return {
      enabled: !!cfg.enabled,
      warnAfterDays: cfg.warnAfterDays ?? 2,
      warningText: cfg.warningText || DEFAULT_WARNING,
      warnChannelId: cfg.warnChannelId || null,
      dmWarning: cfg.dmWarning !== false,
      ...cfg
    };
  }

  /** يبدأ الفحص الدوري. مرة كل ساعة تكفي لنظام يوميّ. */
  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), 3_600_000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * تسجيل حضور تلقائي من رسالة.
   * يُستدعى من `messageCreate` لكل رسالة، فلا بد أن يكون رخيصًا:
   * نتحقق أولًا من التفعيل ثم من كون الكاتب إداريًا قبل لمس القاعدة.
   */
  recordFromMessage(guildId, member) {
    if (!member || member.user?.bot) return false;
    if (!this.config(guildId).enabled) return false;
    if (!this.isStaff(guildId, member)) return false;
    return this.app.activity.checkIn(guildId, member.id, "message");
  }

  /** هل العضو ضمن الطاقم؟ يعتمد السلم الإداري أو الرتبة الأساسية. */
  isStaff(guildId, member) {
    if (this.app.staffService.currentRank(member)) return true;
    const base = this.app.guildConfig.value(guildId, "staff.baseRoleId");
    return !!(base && member.roles?.cache?.has(base));
  }

  /** حالة إداري واحد. */
  status(guildId, userId) {
    const act = this.app.activity;
    return {
      today: act.checkedInToday(guildId, userId),
      last: act.lastCheckIn(guildId, userId),
      daysSince: act.daysSinceCheckIn(guildId, userId),
      streak: act.checkInStreak(guildId, userId),
      last30: act.checkInCount(guildId, userId, 30)
    };
  }

  /** يستبدل متغيرات نص التحذير. */
  renderWarning(template, { member, guild, days }) {
    return String(template)
      .replaceAll("{user}", `<@${member.id}>`)
      .replaceAll("{username}", member.user?.username || member.id)
      .replaceAll("{server}", guild.name)
      .replaceAll("{days}", String(days))
      .replaceAll("{date}", new Date().toLocaleDateString("ar"));
  }

  /**
   * يفحص كل السيرفرات ويحذّر الغائبين.
   * التحذير يُرسل مرة واحدة يوميًا لكل عضو مهما تكرر الفحص.
   */
  async tick() {
    for (const guild of this.app.client.guilds.cache.values()) {
      const cfg = this.config(guild.id);
      if (!cfg.enabled || !cfg.warnAfterDays) continue;
      await this.warnAbsent(guild).catch((err) =>
        this.app.errors.capture(err, { system: "staff/checkin", guildId: guild.id })
      );
    }
  }

  /** يحذّر غائبي سيرفر واحد. @returns {{warned:number, checked:number}} */
  async warnAbsent(guild) {
    const cfg = this.config(guild.id);
    const act = this.app.activity;
    const result = { warned: 0, checked: 0, failed: 0 };

    // نجمع الإداريين من رتب السلم والرتبة الأساسية
    const ranks = this.app.staff.list(guild.id);
    const roleIds = new Set(ranks.map((r) => r.role_id));
    const base = this.app.guildConfig.value(guild.id, "staff.baseRoleId");
    if (base) roleIds.add(base);
    if (!roleIds.size) return result;

    const seen = new Set();
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role?.members) continue;

      for (const member of role.members.values()) {
        if (seen.has(member.id) || member.user?.bot) continue;
        seen.add(member.id);
        result.checked++;

        if (act.checkedInToday(guild.id, member.id)) continue;
        if (act.warnedToday(guild.id, member.id)) continue;

        // من لم يسجّل قط يُعامل كغائب منذ بدء التفعيل لا كمخالف فورًا
        const days = act.daysSinceCheckIn(guild.id, member.id);
        if (days === null || days < cfg.warnAfterDays) continue;

        const delivered = await this.sendWarning(guild, member, days, cfg);
        act.recordWarning(guild.id, member.id, days, delivered);
        if (delivered) result.warned++;
        else result.failed++;
      }
    }

    return result;
  }

  /** يرسل التحذير في الخاص و/أو قناة محددة. */
  async sendWarning(guild, member, days, cfg = null) {
    const settings = cfg || this.config(guild.id);
    const text = this.renderWarning(settings.warningText, { member, guild, days });

    const embed = buildEmbed({
      title: "⚠️ تنبيه غياب",
      description: truncate(text, 3800),
      color: this.app.config.color("warning"),
      footer: `${guild.name} • سجّل دخولك بكتابة رسالة في أي روم`
    });

    let delivered = false;

    if (settings.dmWarning) {
      const sent = await member.user?.send({ embeds: [embed] }).catch(() => null);
      if (sent) delivered = true;
    }

    if (settings.warnChannelId) {
      const channel = await this.app.client.channels.fetch(settings.warnChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        const sent = await channel
          .send({ content: `<@${member.id}>`, embeds: [embed], allowedMentions: { users: [member.id] } })
          .catch(() => null);
        if (sent) delivered = true;
      }
    }

    return delivered;
  }

  /** تقرير حضور اليوم. */
  todayReport(guild) {
    const act = this.app.activity;
    const ranks = this.app.staff.list(guild.id);
    const roleIds = new Set(ranks.map((r) => r.role_id));
    const base = this.app.guildConfig.value(guild.id, "staff.baseRoleId");
    if (base) roleIds.add(base);

    const staff = new Set();
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role?.members) continue;
      for (const m of role.members.values()) {
        if (!m.user?.bot) staff.add(m.id);
      }
    }

    const present = [];
    const absent = [];
    for (const id of staff) {
      if (act.checkedInToday(guild.id, id)) present.push(id);
      else absent.push({ id, days: act.daysSinceCheckIn(guild.id, id) });
    }

    return { total: staff.size, present, absent };
  }
}

module.exports = StaffCheckinService;
module.exports.DEFAULT_WARNING = DEFAULT_WARNING;
