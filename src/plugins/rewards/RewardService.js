const { dayKeyIn, weekKey } = require("../../core/utils/time");

/**
 * محرك المكافآت المركزي.
 *
 * كل نظام يمنح شيئًا (المستويات، الإنجازات، النشاط الأسبوعي، الفعاليات، الإدارة)
 * يمر من `grant()`، فيكون هناك:
 *  - مصدر واحد لمنطق منح المال والـXP والرتب والعناصر والشارات
 *  - سجل تدقيق واحد (`reward_log`)
 *  - حدث واحد على الناقل (`reward:granted`) تستمع له الإنجازات والسجلات
 *
 * المال يمر عبر EconomyService الموجود (لا اقتصاد ثانٍ)، والـXP عبر إضافة المستويات إن كانت محمّلة.
 */
class RewardService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    // ذاكرة قصيرة لتفادي كتابة مطالبة الدخول اليومي مع كل رسالة. محدودة الحجم وتُفرَّغ كل يوم.
    this._dailySeen = new Set();
    this._dailySeenDay = null;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "rewards") || {};
  }

  /** وصف مقروء للمكافأة (لرسائل التهنئة والسجلات). */
  describe(guildId, reward = {}) {
    const parts = [];
    if (reward.money > 0) parts.push(this.app.economyService ? this.app.economyService.format(guildId, reward.money) : `💰 ${reward.money}`);
    if (reward.xp > 0) parts.push(`✨ ${reward.xp} XP`);
    if (reward.roleId) parts.push(`<@&${reward.roleId}>`);
    if (reward.item?.key) parts.push(`📦 ${reward.item.qty || 1}× ${reward.item.label || reward.item.key}`);
    if (reward.badge) {
      const badge = this.repo.badge(guildId, reward.badge);
      parts.push(`${badge?.emoji || "🏅"} ${badge?.name || reward.badge}`);
    }
    return parts.join(" • ") || "—";
  }

  /**
   * يمنح مكافأة مركّبة. لا يرمي بسبب جزء واحد فاشل — يكمل البقية ويُبلغ بما تخطّاه.
   * @returns {Promise<{ ok: boolean, applied: object, skipped: string[] }>}
   */
  async grant(guildId, userId, reward = {}, { source = "admin", ref = null, actorId = null, member = null } = {}) {
    const applied = { money: 0, xp: 0, roleId: null, item: null, badge: null };
    const skipped = [];

    const money = Math.floor(Number(reward.money) || 0);
    if (money > 0) {
      if (this.app.economyService) {
        this.app.economyService.add(guildId, userId, money, { target: "bank", actorId, reason: `مكافأة (${source})` });
        applied.money = money;
      } else skipped.push("money:noEconomy");
    }

    const xp = Math.floor(Number(reward.xp) || 0);
    if (xp > 0) {
      if (this.app.levels) {
        this.app.levels.addXp(guildId, userId, xp, { reason: `reward:${source}`, actorId, silent: source === "level" });
        applied.xp = xp;
      } else skipped.push("xp:noLevels");
    }

    if (reward.roleId) {
      const result = await this._giveRole(guildId, userId, reward.roleId, member, source);
      if (result.ok) applied.roleId = reward.roleId;
      else skipped.push(`role:${result.reason}`);
    }

    if (reward.item?.key) {
      if (this.app.inventory) {
        const qty = Math.max(1, Math.floor(reward.item.qty || 1));
        this.app.inventory.add(guildId, userId, reward.item.key, qty, { reason: `مكافأة (${source})`, actorId });
        applied.item = { key: reward.item.key, qty };
      } else skipped.push("item:noInventory");
    }

    if (reward.badge) {
      if (this.repo.awardBadge(guildId, userId, reward.badge, source)) applied.badge = reward.badge;
      else skipped.push("badge:alreadyOwned");
    }

    const anything = applied.money || applied.xp || applied.roleId || applied.item || applied.badge;
    if (anything) {
      this.repo.log({
        guildId, userId, source, sourceRef: ref,
        money: applied.money, xp: applied.xp, roleId: applied.roleId,
        itemKey: applied.item?.key || null, itemQty: applied.item?.qty || 0,
        badge: applied.badge, actorId
      });
      this.app.bus.emitSafe("reward:granted", { guildId, userId, source, ref, applied, actorId });
    }
    return { ok: !!anything, applied, skipped };
  }

  async _giveRole(guildId, userId, roleId, member, source) {
    const guild = this.app.client.guilds?.cache?.get(guildId) || member?.guild;
    if (!guild) return { ok: false, reason: "noGuild" };
    const role = guild.roles.cache.get(roleId);
    if (!role) return { ok: false, reason: "missing" };
    const me = guild.members.me;
    if (role.managed || (me && role.position >= me.roles.highest.position)) return { ok: false, reason: "hierarchy" };
    const target = member || (await guild.members.fetch(userId).catch(() => null));
    if (!target) return { ok: false, reason: "notMember" };
    if (target.roles.cache.has(roleId)) return { ok: false, reason: "alreadyHas" };
    try {
      await target.roles.add(role, `مكافأة: ${source}`);
      return { ok: true };
    } catch (error) {
      this.app.logger.warn(`تعذّر منح رتبة المكافأة ${roleId} في ${guildId}: ${error.message}`);
      return { ok: false, reason: "discordError" };
    }
  }

  /** يطالب بمكافأة مرة واحدة لكل فترة. يُرجع false إن طُلبت سابقًا. */
  claimOnce(guildId, userId, kind, periodKey) {
    return this.repo.claim(guildId, userId, kind, periodKey);
  }

  // ---------------- المشغّلات ----------------

  /** مكافأة الدخول اليومي: أول رسالة في اليوم (بتوقيت UTC). */
  async onMessage(message) {
    if (message.author.bot || !message.guild) return;
    const cfg = this.config(message.guild.id).dailyLogin;
    if (!cfg?.enabled || (!(cfg.money > 0) && !(cfg.xp > 0))) return;

    const day = dayKeyIn(Date.now(), "UTC");
    if (this._dailySeenDay !== day) {
      this._dailySeen.clear();
      this._dailySeenDay = day;
    }
    const key = `${message.guild.id}:${message.author.id}`;
    if (this._dailySeen.has(key)) return;
    if (this._dailySeen.size < 100_000) this._dailySeen.add(key);

    if (!this.claimOnce(message.guild.id, message.author.id, "daily_login", day)) return;
    await this.grant(message.guild.id, message.author.id, { money: cfg.money, xp: cfg.xp }, { source: "daily_login", ref: day, member: message.member });
  }

  /** توزيع مكافآت الأسبوع على أنشط الأعضاء وأنشط الطاقم في كل سيرفر مفعّل. */
  async runWeekly() {
    const period = weekKey(Date.now() - 86_400_000); // الأسبوع المنتهي
    const report = [];
    for (const guild of this.app.client.guilds?.cache?.values() || []) {
      if (!this.app.features.isEnabled(guild.id, "rewards")) continue;
      const cfg = this.config(guild.id);
      if (cfg.weeklyActivity?.enabled && this.app.levels) {
        const top = this.app.levels.leaderboard(guild.id, { period: "weekly", limit: cfg.weeklyActivity.topN || 3 });
        report.push(...(await this._distribute(guild, top.map((r) => r.user_id), cfg.weeklyActivity, "weekly_activity", period)));
      }
      if (cfg.staffWeekly?.enabled) {
        const top = this.app.activity.pointsLeaderboard(guild.id, 7, cfg.staffWeekly.topN || 3);
        report.push(...(await this._distribute(guild, top.map((r) => r.userId), cfg.staffWeekly, "staff_weekly", period)));
      }
    }
    return report;
  }

  async _distribute(guild, userIds, cfg, kind, period) {
    const winners = [];
    for (const [i, userId] of userIds.entries()) {
      if (!this.claimOnce(guild.id, userId, kind, period)) continue;
      const reward = {
        money: Array.isArray(cfg.money) ? cfg.money[i] || 0 : cfg.money || 0,
        xp: Array.isArray(cfg.xp) ? cfg.xp[i] || 0 : cfg.xp || 0,
        roleId: i === 0 ? cfg.roleId || null : null
      };
      const result = await this.grant(guild.id, userId, reward, { source: kind, ref: period });
      if (result.ok) winners.push({ guildId: guild.id, userId, position: i + 1, reward });
    }
    if (winners.length && cfg.announceChannelId) {
      const t = this.app.i18n.forGuild(guild.id);
      const lines = winners.map((w) => `**${w.position}.** <@${w.userId}> — ${this.describe(guild.id, w.reward)}`);
      await this.app.notifications.notify({
        guildId: guild.id,
        targets: ["channel"],
        channelId: cfg.announceChannelId,
        payload: {
          embeds: [this.app.theme.embed(guild.id, {
            title: t(kind === "staff_weekly" ? "rewards.staffWeeklyTitle" : "rewards.weeklyTitle"),
            description: lines.join("\n"),
            color: "success"
          })]
        }
      });
    }
    return winners;
  }
}

module.exports = RewardService;
