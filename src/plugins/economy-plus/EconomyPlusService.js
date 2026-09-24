const { dayKeyIn, weekKey } = require("../../core/utils/time");

const DAY = 86_400_000;

function monthKey(ms) {
  return new Date(ms).toISOString().slice(0, 7);
}

/**
 * توسعة الاقتصاد: المطالبات (يومي/أسبوعي/شهري بسلسلة)، العمل والوظائف، السرقة،
 * الاستثمار، والقروض بالفائدة. كل حركة مال تمر عبر EconomyRepository الموجود.
 *
 * منع الاستغلال (للاقتصاد فقط، لا حماية سيرفر): كل مطالبة وتبريد ذرّي داخل
 * معاملة، فلا تُصرف مكافأة مرتين حتى لو ضغط العضو عشر مرات في نفس اللحظة.
 */
class EconomyPlusService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "economy") || {};
  }

  enabled(guildId) {
    return this.config(guildId).enabled !== false;
  }

  format(guildId, amount) {
    return this.app.economyService.format(guildId, amount);
  }

  _account(guildId, userId) {
    this.app.economyService.account(guildId, userId);
    return this.app.economy.get(guildId, userId);
  }

  // ---------------- المطالبات الدورية ----------------

  _periods(kind, now = Date.now()) {
    if (kind === "daily") return { period: dayKeyIn(now, "UTC"), previous: dayKeyIn(now - DAY, "UTC") };
    if (kind === "weekly") return { period: weekKey(now), previous: weekKey(now - 7 * DAY) };
    const d = new Date(now);
    const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).getTime();
    return { period: monthKey(now), previous: monthKey(prev) };
  }

  claimPeriodic(member, kind) {
    const guildId = member.guild.id;
    const cfg = this.config(guildId)[kind] || {};
    const base = Math.max(0, Math.floor(cfg.amount ?? { daily: 500, weekly: 3000, monthly: 10000 }[kind]));
    if (!base) return { ok: false, reason: "disabled" };
    this._account(guildId, member.id);
    if (this._account(guildId, member.id)?.frozen) return { ok: false, reason: "frozen" };
    const { period, previous } = this._periods(kind);
    const claim = this.repo.claim(guildId, member.id, kind, { period, previousPeriod: previous });
    if (!claim.ok) return { ...claim, next: this._nextReset(kind) };

    const streakBonus = kind === "daily" ? Math.min((claim.streak - 1) * (cfg.streakBonus ?? 50), cfg.maxStreakBonus ?? 1000) : 0;
    const total = base + streakBonus;
    const res = this.app.economy.adjustWallet({ guildId, userId: member.id, delta: total, type: kind, reason: `${kind}${claim.streak > 1 ? ` streak ${claim.streak}` : ""}` });
    if (!res.ok) {
      this.repo.releaseClaim(guildId, member.id, kind);
      return { ok: false, reason: res.reason };
    }
    this.app.bus.emitSafe("economy:claim", { guildId, userId: member.id, kind, amount: total, streak: claim.streak });
    return { ok: true, amount: total, base, streakBonus, streak: claim.streak, account: res.account, next: this._nextReset(kind) };
  }

  _nextReset(kind, now = Date.now()) {
    const d = new Date(now);
    if (kind === "daily") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    if (kind === "weekly") {
      const dayNum = (d.getUTCDay() + 6) % 7; // الإثنين = 0 (أسبوع ISO)
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dayNum + 7);
    }
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }

  // ---------------- العمل ----------------

  work(member) {
    const guildId = member.guild.id;
    const cfg = this.config(guildId).work || {};
    if (cfg.enabled === false) return { ok: false, reason: "disabled" };
    if (this._account(guildId, member.id)?.frozen) return { ok: false, reason: "frozen" };
    const job = this.repo.memberJob(guildId, member.id);
    const min = job ? job.min_pay : cfg.min ?? 100;
    const max = job ? job.max_pay : cfg.max ?? 400;
    const claim = this.repo.claim(guildId, member.id, "work", { cooldownMs: cfg.cooldownMs ?? 3_600_000 });
    if (!claim.ok) return claim;
    const amount = min + Math.floor(Math.random() * (Math.max(min, max) - min + 1));
    const res = this.app.economy.adjustWallet({ guildId, userId: member.id, delta: amount, type: "work", reason: job ? job.name : "work" });
    if (!res.ok) {
      this.repo.releaseClaim(guildId, member.id, "work");
      return { ok: false, reason: res.reason };
    }
    this.app.bus.emitSafe("economy:work", { guildId, userId: member.id, amount, jobId: job?.id || null });
    return { ok: true, amount, job, account: res.account };
  }

  applyJob(member, jobId) {
    const job = this.repo.job(member.guild.id, jobId);
    if (!job) return { ok: false, reason: "notFound" };
    const level = this.app.levels ? this.app.levels.repo.get(member.guild.id, member.id)?.level || 0 : Infinity;
    if (job.required_level && level < job.required_level) return { ok: false, reason: "level", level: job.required_level };
    this.repo.setMemberJob(member.guild.id, member.id, job.id);
    return { ok: true, job };
  }

  // ---------------- السرقة ----------------

  rob(robber, target) {
    const guildId = robber.guild.id;
    const cfg = this.config(guildId).rob || {};
    if (!cfg.enabled) return { ok: false, reason: "disabled" };
    if (target.user.bot || target.id === robber.id) return { ok: false, reason: "invalidTarget" };
    const targetAccount = this._account(guildId, target.id);
    const robberAccount = this._account(guildId, robber.id);
    if (robberAccount?.frozen) return { ok: false, reason: "frozen" };
    const minWallet = cfg.minTargetWallet ?? 500;
    if (!targetAccount || targetAccount.wallet < minWallet) return { ok: false, reason: "targetPoor", min: minWallet };

    // حماية الضحية لفترة بعد سرقتها (منع الاستهداف المتكرر) — تُفحص قبل استهلاك تبريد السارق
    const protection = this.repo.cooldownOf(guildId, target.id, "robbed");
    if (protection && Date.now() - protection.last_at < (cfg.protectionMs ?? 3_600_000)) return { ok: false, reason: "protected" };

    const claim = this.repo.claim(guildId, robber.id, "rob", { cooldownMs: cfg.cooldownMs ?? 7_200_000 });
    if (!claim.ok) return claim;

    const success = Math.random() < (cfg.successChance ?? 0.45);
    if (success) {
      const maxPercent = Math.min(Math.max(cfg.maxPercent ?? 0.3, 0.01), 1);
      const amount = Math.max(1, Math.floor(targetAccount.wallet * (0.1 + Math.random() * (maxPercent - 0.1 > 0 ? maxPercent - 0.1 : 0))));
      const result = this.repo.atomic(() => {
        const take = this.app.economy.adjustWallet({ guildId, userId: target.id, delta: -amount, type: "robbed", counterpartyId: robber.id });
        if (!take.ok) this.repo.constructor.abort("targetPoor");
        this.app.economy.adjustWallet({ guildId, userId: robber.id, delta: amount, type: "rob", counterpartyId: target.id });
        this.repo.claim(guildId, target.id, "robbed", { cooldownMs: 0 });
        return { ok: true };
      });
      if (!result.ok) return result;
      this.app.bus.emitSafe("economy:rob", { guildId, userId: robber.id, targetId: target.id, success: true, amount });
      return { ok: true, success: true, amount };
    }
    const fine = Math.floor((robberAccount.wallet + robberAccount.bank) * (cfg.finePercent ?? 0.15));
    const paid = Math.min(fine, robberAccount.wallet);
    if (paid > 0) this.app.economy.adjustWallet({ guildId, userId: robber.id, delta: -paid, type: "rob_fine", counterpartyId: target.id });
    this.app.bus.emitSafe("economy:rob", { guildId, userId: robber.id, targetId: target.id, success: false, fine: paid });
    return { ok: true, success: false, fine: paid };
  }

  // ---------------- الاستثمار ----------------

  plans(guildId) {
    const plans = this.config(guildId).investments?.plans;
    return Array.isArray(plans) && plans.length ? plans : [
      { key: "short", label: "قصير", days: 1, rate: 2 },
      { key: "mid", label: "متوسط", days: 7, rate: 18 },
      { key: "long", label: "طويل", days: 30, rate: 90 }
    ];
  }

  invest(member, planKey, amount) {
    const guildId = member.guild.id;
    const cfg = this.config(guildId).investments || {};
    if (cfg.enabled === false) return { ok: false, reason: "disabled" };
    const plan = this.plans(guildId).find((p) => p.key === planKey);
    if (!plan) return { ok: false, reason: "unknownPlan" };
    if (!(amount > 0)) return { ok: false, reason: "invalidAmount" };
    if (cfg.minAmount && amount < cfg.minAmount) return { ok: false, reason: "tooSmall", min: cfg.minAmount };
    this._account(guildId, member.id);
    const res = this.repo.invest({ guildId, userId: member.id, plan: plan.key, amount, rate: plan.rate, durationMs: plan.days * DAY, maxActive: cfg.maxActive ?? 3 });
    if (res.ok) this.app.bus.emitSafe("economy:invest", { guildId, userId: member.id, amount, plan: plan.key });
    return { ...res, plan };
  }

  closeInvestment(member, id) {
    const cfg = this.config(member.guild.id).investments || {};
    return this.repo.closeInvestment({ guildId: member.guild.id, userId: member.id, id, penaltyPercent: cfg.earlyPenaltyPercent ?? 10 });
  }

  // ---------------- القروض ----------------

  loanConfig(guildId) {
    return { enabled: false, maxAmount: 50_000, interestPercent: 10, termDays: 14, maxActive: 1, ...(this.config(guildId).loans || {}) };
  }

  async requestLoan(member, amount, reason) {
    const guildId = member.guild.id;
    const cfg = this.loanConfig(guildId);
    if (!cfg.enabled) return { ok: false, reason: "disabled" };
    if (!(amount > 0) || amount > cfg.maxAmount) return { ok: false, reason: "invalidAmount", max: cfg.maxAmount };
    const active = this.app.economy.activeLoans(guildId, member.id).length;
    const pending = this.app.economy.pendingLoans(guildId).filter((l) => l.user_id === member.id).length;
    if (active + pending >= cfg.maxActive) return { ok: false, reason: "loanLimit" };
    const loan = this.app.economy.createLoan({ guildId, userId: member.id, amount, reason });
    this.app.bus.emitSafe("economy:loanRequested", { guildId, userId: member.id, loan });
    return { ok: true, loan };
  }

  approveLoan(guild, loanId, reviewer) {
    const cfg = this.loanConfig(guild.id);
    const res = this.repo.approveLoan({ loanId, guildId: guild.id, reviewerId: reviewer.id, interestPercent: cfg.interestPercent, termMs: cfg.termDays * DAY });
    if (res.ok) this.app.bus.emitSafe("economy:loanApproved", { guildId: guild.id, loan: res.loan, reviewerId: reviewer.id });
    return res;
  }

  rejectLoan(guild, loanId, reviewer) {
    const loan = this.app.economy.getLoan(loanId);
    if (!loan || loan.guild_id !== guild.id) return { ok: false, reason: "notFound" };
    return this.app.economy.rejectLoan(loanId, reviewer.id) ? { ok: true, loan } : { ok: false, reason: "alreadyDecided" };
  }

  repayLoan(member, loanId, amount) {
    const loans = this.app.economy.activeLoans(member.guild.id, member.id);
    const loan = loanId ? loans.find((l) => l.id === loanId) : loans[0];
    if (!loan) return { ok: false, reason: "noLoan" };
    return this.repo.repayLoan({ guildId: member.guild.id, userId: member.id, loanId: loan.id, amount: amount || loan.remaining });
  }

  /** مهمة يومية: تحصيل القروض المتأخرة (ما يتوفر من الرصيد) وإشعار أصحابها. */
  async collectOverdue() {
    let collected = 0;
    for (const loan of this.repo.overdueLoans()) {
      if (!this.loanConfig(loan.guild_id).autoCollect) continue;
      const res = this.repo.collectOverdue(loan);
      if (res.ok && res.paid > 0) {
        collected += res.paid;
        const t = this.app.i18n.forGuild(loan.guild_id);
        await this.app.notifications.notify({
          guildId: loan.guild_id, userId: loan.user_id, category: "economy",
          payload: { content: t("eco.loanCollected", { id: loan.id, amount: this.format(loan.guild_id, res.paid) }) }
        });
      }
    }
    return collected;
  }
}

module.exports = EconomyPlusService;
