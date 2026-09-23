const { buildEmbed, timestamp } = require("../../core/utils/helpers");

const TX_LABELS = {
  deposit: "إيداع",
  withdraw: "سحب",
  transfer_out: "تحويل صادر",
  transfer_in: "تحويل وارد",
  charge: "خصم",
  admin_add: "إضافة إدارية",
  admin_remove: "خصم إداري",
  admin_set: "تعديل إداري",
  loan: "قرض",
  loan_repay: "سداد قرض"
};

/**
 * الطبقة التي تستخدمها كل الأنظمة للتعامل مع المال.
 * المخالفات والطيران لا تلمس جداول الحسابات مباشرة، بل تمر من هنا،
 * فيبقى سجل الحركات موحّدًا وكل خصم مُوثّقًا بمصدره.
 */
class EconomyService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "economy") || {};
  }

  enabled(guildId) {
    return !!this.config(guildId).enabled;
  }

  /** تنسيق المبلغ بالعملة المحددة في إعدادات السيرفر. */
  format(guildId, amount) {
    const cfg = this.config(guildId);
    const symbol = cfg.symbol || "";
    const value = Number(amount || 0).toLocaleString("en-US");
    return symbol ? `${value} ${symbol}` : `${value} ${cfg.currency || ""}`.trim();
  }

  /** يضمن وجود الحساب بالرصيد الابتدائي المعرّف للسيرفر. */
  account(guildId, userId) {
    const cfg = this.config(guildId);
    return this.app.economy.ensure(guildId, userId, cfg.startingWallet || 0, cfg.startingBank || 0);
  }

  total(account) {
    return (account?.wallet || 0) + (account?.bank || 0);
  }

  /**
   * يحسب الضريبة المضمّنة على مبلغ صافٍ، بمعدّل قابل للتعديل لكل سيرفر.
   * الصيغة تحسب "المبلغ الإجمالي شامل الضريبة" الذي يعادل صافي الربح المطلوب بعد خصم النسبة —
   * مفيدة في اقتصاديات الأدوار (RP) حيث يحتاج البائع معرفة كم يطلب من العميل ليصفّي مبلغًا معينًا بعد الضريبة.
   */
  calculateTax(guildId, netAmount) {
    const percent = this.config(guildId).taxPercent ?? 5.26;
    const rate = percent / 100;
    if (rate <= 0 || rate >= 1) return { ok: false, reason: "invalidRate" };
    const gross = Math.floor(netAmount / (1 - rate)) + 1;
    return { ok: true, gross, tax: gross - netAmount, percent };
  }

  // ---------------- العمليات ----------------

  deposit(guildId, userId, amount) {
    this.account(guildId, userId);
    const result = this.app.economy.move({ guildId, userId, amount, direction: "deposit" });
    if (result.ok) this._log(guildId, { type: "deposit", userId, amount, account: result.account });
    return result;
  }

  withdraw(guildId, userId, amount) {
    this.account(guildId, userId);
    const result = this.app.economy.move({ guildId, userId, amount, direction: "withdraw" });
    if (result.ok) this._log(guildId, { type: "withdraw", userId, amount, account: result.account });
    return result;
  }

  transfer(guildId, fromId, toId, amount, reason) {
    const cfg = this.config(guildId);

    if (fromId === toId) return { ok: false, reason: "self" };
    if (cfg.maxTransfer && amount > cfg.maxTransfer) {
      return { ok: false, reason: "overLimit", limit: cfg.maxTransfer };
    }

    this.account(guildId, fromId);
    this.account(guildId, toId);

    const fee = Math.floor((amount * (cfg.transferFeePercent || 0)) / 100);
    const result = this.app.economy.transfer({ guildId, fromId, toId, amount, fee, reason });

    if (result.ok) {
      this._log(guildId, { type: "transfer_out", userId: fromId, amount, account: result.sender, counterpartyId: toId, reason, fee });
    }
    return result;
  }

  /**
   * خصم مرتبط بنظام آخر (مخالفة، تذكرة طيران...).
   * يخصم من البنك أولًا ثم من الجيب.
   */
  charge(guildId, userId, amount, { reason, refType, refId, actorId } = {}) {
    this.account(guildId, userId);
    const result = this.app.economy.charge({ guildId, userId, amount, reason, refType, refId, actorId });
    if (result.ok) {
      this._log(guildId, { type: "charge", userId, amount, account: result.account, reason, actorId });
    }
    return result;
  }

  add(guildId, userId, amount, { target = "bank", actorId, reason } = {}) {
    this.account(guildId, userId);
    const account = this.app.economy.credit({ guildId, userId, amount, target, actorId, reason });
    this._log(guildId, { type: "admin_add", userId, amount, account, actorId, reason });
    return account;
  }

  remove(guildId, userId, amount, { actorId, reason } = {}) {
    this.account(guildId, userId);
    const result = this.app.economy.debit({ guildId, userId, amount, actorId, reason });
    if (result.ok) this._log(guildId, { type: "admin_remove", userId, amount, account: result.account, actorId, reason });
    return result;
  }

  // ---------------- العرض ----------------

  balanceEmbed(guildId, user, account) {
    const unpaid = this.app.violations.unpaidTotal(guildId, user.id);
    const loans = this.app.economy.activeLoans(guildId, user.id);
    const loanTotal = loans.reduce((sum, l) => sum + l.remaining, 0);

    const fields = [
      { name: "💵 نقدي", value: this.format(guildId, account.wallet), inline: true },
      { name: "🏦 مصرفي", value: this.format(guildId, account.bank), inline: true },
      { name: "📊 الإجمالي", value: this.format(guildId, this.total(account)), inline: true }
    ];
    if (unpaid > 0) fields.push({ name: "⚠️ مخالفات غير مسددة", value: this.format(guildId, unpaid), inline: true });
    if (loanTotal > 0) fields.push({ name: "📉 قروض مستحقة", value: this.format(guildId, loanTotal), inline: true });
    if (account.frozen) {
      fields.push({
        name: "⛔ الحالة",
        value: `الخدمات موقوفة${account.frozen_reason ? `\nالسبب: ${account.frozen_reason}` : ""}`
      });
    }

    return buildEmbed({
      title: "🏦 كشف الحساب",
      description: `حساب <@${user.id}>`,
      color: this.app.config.color(account.frozen ? "danger" : "primary"),
      thumbnail: user.displayAvatarURL?.() || undefined,
      fields
    });
  }

  statementEmbed(guildId, user, rows) {
    if (!rows.length) {
      return buildEmbed({ description: "لا توجد حركات مالية بعد.", color: this.app.config.color("neutral") });
    }
    const lines = rows.map((t) => {
      const sign = ["transfer_in", "admin_add", "loan"].includes(t.type) ? "🟢 +" : "🔴 −";
      const label = TX_LABELS[t.type] || t.type;
      const who = t.counterparty_id ? ` ← <@${t.counterparty_id}>` : "";
      const why = t.reason ? `\n  ↳ ${t.reason}` : "";
      return `${sign}${this.format(guildId, t.amount)} • **${label}**${who} • ${timestamp(t.created_at, "R")}${why}`;
    });
    return buildEmbed({
      title: `📄 آخر الحركات — ${user.username || user.id}`,
      description: lines.join("\n"),
      color: this.app.config.color("info")
    });
  }

  /** يرسل نسخة من الحركة إلى قناة سجل الاقتصاد إن كانت معرّفة. */
  async _log(guildId, { type, userId, amount, account, counterpartyId, actorId, reason, fee }) {
    const channelId = this.app.guildConfig.value(guildId, "logs.economy");
    if (!channelId) return;

    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const fields = [
      { name: "العضو", value: `<@${userId}>`, inline: true },
      { name: "المبلغ", value: this.format(guildId, amount), inline: true },
      { name: "الرصيد بعدها", value: this.format(guildId, this.total(account)), inline: true }
    ];
    if (counterpartyId) fields.push({ name: "الطرف الآخر", value: `<@${counterpartyId}>`, inline: true });
    if (actorId) fields.push({ name: "المنفّذ", value: `<@${actorId}>`, inline: true });
    if (fee) fields.push({ name: "الرسوم", value: this.format(guildId, fee), inline: true });
    if (reason) fields.push({ name: "السبب", value: String(reason).slice(0, 1000) });

    await channel.send({
      embeds: [buildEmbed({
        title: `🏦 ${TX_LABELS[type] || type}`,
        color: this.app.config.color(["admin_remove", "charge", "transfer_out", "withdraw"].includes(type) ? "danger" : "success"),
        fields
      })]
    }).catch(() => {});
  }
}

module.exports = EconomyService;
module.exports.TX_LABELS = TX_LABELS;
