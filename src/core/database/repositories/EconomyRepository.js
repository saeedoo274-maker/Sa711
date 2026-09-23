/**
 * حسابات الأعضاء والحركات المالية.
 *
 * القاعدة الحاكمة: أي عملية تُنقص رصيدًا تستخدم شرط `balance >= amount`
 * داخل جملة UPDATE نفسها. لو رجعت changes === 0 فالرصيد غير كافٍ،
 * ولا يمكن أبدًا أن يصبح الرصيد سالبًا مهما تزامنت الطلبات.
 */
class EconomyRepository {
  constructor(db) {
    this.db = db;

    /** تحويل بين عضوين: خصم وإضافة داخل معاملة واحدة، إما الاثنان أو لا شيء. */
    this._transfer = db.transaction(({ guildId, fromId, toId, amount, fee, reason }) => {
      const total = amount + fee;

      // الشرط `frozen = 0` ذرّي داخل نفس جملة UPDATE، فلا يوجد فاصل زمني
      // بين فحص التجميد وتنفيذ الخصم يمكن استغلاله بتحويل متزامن
      const debit = db
        .prepare("UPDATE accounts SET bank = bank - ? WHERE guild_id = ? AND user_id = ? AND bank >= ? AND frozen = 0")
        .run(total, guildId, fromId, total);
      if (debit.changes !== 1) {
        const account = db.prepare("SELECT * FROM accounts WHERE guild_id = ? AND user_id = ?").get(guildId, fromId);
        if (account?.frozen) return { ok: false, reason: "frozen", account };
        return { ok: false, reason: "insufficient" };
      }

      db.prepare(
        `INSERT INTO accounts (guild_id, user_id, wallet, bank, created_at) VALUES (?, ?, 0, 0, ?)
         ON CONFLICT(guild_id, user_id) DO NOTHING`
      ).run(guildId, toId, Date.now());

      db.prepare("UPDATE accounts SET bank = bank + ? WHERE guild_id = ? AND user_id = ?").run(amount, guildId, toId);

      const sender = db.prepare("SELECT * FROM accounts WHERE guild_id = ? AND user_id = ?").get(guildId, fromId);
      const receiver = db.prepare("SELECT * FROM accounts WHERE guild_id = ? AND user_id = ?").get(guildId, toId);

      this._log({ guildId, userId: fromId, type: "transfer_out", amount: total, account: sender, counterpartyId: toId, reason });
      this._log({ guildId, userId: toId, type: "transfer_in", amount, account: receiver, counterpartyId: fromId, reason });

      return { ok: true, sender, receiver, fee };
    });

    /** نقل بين الجيب والبنك لنفس العضو. */
    this._move = db.transaction(({ guildId, userId, amount, direction, }) => {
      const from = direction === "deposit" ? "wallet" : "bank";
      const to = direction === "deposit" ? "bank" : "wallet";

      // اسما العمودين ثابتان من الشرط أعلاه ولا يأتيان من مدخلات المستخدم
      const sql =
        direction === "deposit"
          ? "UPDATE accounts SET wallet = wallet - ?, bank = bank + ? WHERE guild_id = ? AND user_id = ? AND wallet >= ? AND frozen = 0"
          : "UPDATE accounts SET bank = bank - ?, wallet = wallet + ? WHERE guild_id = ? AND user_id = ? AND bank >= ? AND frozen = 0";

      const res = db.prepare(sql).run(amount, amount, guildId, userId, amount);
      if (res.changes !== 1) {
        const account = db.prepare("SELECT * FROM accounts WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
        if (account?.frozen) return { ok: false, reason: "frozen", account };
        return { ok: false, reason: "insufficient", from };
      }

      const account = db.prepare("SELECT * FROM accounts WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
      this._log({ guildId, userId, type: direction, amount, account });
      return { ok: true, account, to };
    });

    /** خصم من البنك ثم من الجيب عند الحاجة (يُستخدم للمخالفات والتذاكر). */
    this._charge = db.transaction(({ guildId, userId, amount, reason, refType, refId, actorId }) => {
      const account = db.prepare("SELECT * FROM accounts WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
      if (!account || account.bank + account.wallet < amount) return { ok: false, reason: "insufficient", account };

      const fromBank = Math.min(account.bank, amount);
      const fromWallet = amount - fromBank;

      const res = db
        .prepare(
          `UPDATE accounts SET bank = bank - ?, wallet = wallet - ?
           WHERE guild_id = ? AND user_id = ? AND bank >= ? AND wallet >= ?`
        )
        .run(fromBank, fromWallet, guildId, userId, fromBank, fromWallet);
      if (res.changes !== 1) return { ok: false, reason: "insufficient", account };

      const updated = db.prepare("SELECT * FROM accounts WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
      this._log({ guildId, userId, type: "charge", amount, account: updated, reason, refType, refId, actorId });
      return { ok: true, account: updated, fromBank, fromWallet };
    });
  }

  _log({ guildId, userId, type, amount, account, counterpartyId, actorId, reason, refType, refId }) {
    this.db
      .prepare(
        `INSERT INTO transactions
          (guild_id, user_id, type, amount, wallet_after, bank_after, counterparty_id, actor_id, reason, ref_type, ref_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        guildId, userId, type, amount,
        account?.wallet ?? 0, account?.bank ?? 0,
        counterpartyId || null, actorId || null, reason || null,
        refType || null, refId ? String(refId) : null, Date.now()
      );
  }

  /** ينشئ الحساب إن لم يكن موجودًا، بالرصيد الابتدائي المحدد في إعدادات السيرفر. */
  ensure(guildId, userId, startingWallet = 0, startingBank = 0) {
    this.db
      .prepare(
        `INSERT INTO accounts (guild_id, user_id, wallet, bank, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO NOTHING`
      )
      .run(guildId, userId, startingWallet, startingBank, Date.now());
    return this.get(guildId, userId);
  }

  get(guildId, userId) {
    return this.db.prepare("SELECT * FROM accounts WHERE guild_id = ? AND user_id = ?").get(guildId, userId) || null;
  }

  exists(guildId, userId) {
    return !!this.db.prepare("SELECT 1 FROM accounts WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  }

  transfer(args) { return this._transfer(args); }
  move(args) { return this._move(args); }
  charge(args) { return this._charge(args); }

  /** إضافة رصيد إداريًا (بلا سقف، لأن المصدر هو الإدارة). */
  credit({ guildId, userId, amount, target = "bank", actorId, reason }) {
    const apply = this.db.transaction(() => {
      this.ensure(guildId, userId);
      const sql = target === "wallet"
        ? "UPDATE accounts SET wallet = wallet + ? WHERE guild_id = ? AND user_id = ?"
        : "UPDATE accounts SET bank = bank + ? WHERE guild_id = ? AND user_id = ?";
      this.db.prepare(sql).run(amount, guildId, userId);
      const account = this.get(guildId, userId);
      this._log({ guildId, userId, type: "admin_add", amount, account, actorId, reason });
      return account;
    });
    return apply();
  }

  /** سحب رصيد إداريًا. لا ينزل تحت الصفر. */
  debit({ guildId, userId, amount, actorId, reason }) {
    const apply = this.db.transaction(() => {
      const account = this.get(guildId, userId);
      if (!account) return { ok: false, reason: "noAccount" };
      const total = account.wallet + account.bank;
      if (total < amount) return { ok: false, reason: "insufficient", account };

      const fromBank = Math.min(account.bank, amount);
      const fromWallet = amount - fromBank;
      this.db
        .prepare("UPDATE accounts SET bank = bank - ?, wallet = wallet - ? WHERE guild_id = ? AND user_id = ?")
        .run(fromBank, fromWallet, guildId, userId);

      const updated = this.get(guildId, userId);
      this._log({ guildId, userId, type: "admin_remove", amount, account: updated, actorId, reason });
      return { ok: true, account: updated };
    });
    return apply();
  }

  setBalance({ guildId, userId, wallet, bank, actorId }) {
    const apply = this.db.transaction(() => {
      this.ensure(guildId, userId);
      this.db
        .prepare("UPDATE accounts SET wallet = ?, bank = ? WHERE guild_id = ? AND user_id = ?")
        .run(Math.max(0, wallet), Math.max(0, bank), guildId, userId);
      const account = this.get(guildId, userId);
      this._log({ guildId, userId, type: "admin_set", amount: wallet + bank, account, actorId });
      return account;
    });
    return apply();
  }

  /** يوقف الخدمات البنكية (تحويل، سحب، إيداع) عن حساب عضو. القراءة تبقى متاحة دائمًا. */
  freeze({ guildId, userId, reason, actorId }) {
    this.ensure(guildId, userId);
    this.db
      .prepare("UPDATE accounts SET frozen = 1, frozen_reason = ?, frozen_by = ?, frozen_at = ? WHERE guild_id = ? AND user_id = ?")
      .run(reason || null, actorId || null, Date.now(), guildId, userId);
    return this.get(guildId, userId);
  }

  /** يعيد تفعيل الخدمات. يرجع false لو الحساب لم يكن مجمَّدًا أصلاً. */
  unfreeze({ guildId, userId }) {
    const res = this.db
      .prepare("UPDATE accounts SET frozen = 0, frozen_reason = NULL, frozen_by = NULL, frozen_at = NULL WHERE guild_id = ? AND user_id = ? AND frozen = 1")
      .run(guildId, userId);
    return res.changes === 1;
  }

  top(guildId, limit = 10) {
    return this.db
      .prepare("SELECT user_id, wallet, bank, (wallet + bank) AS total FROM accounts WHERE guild_id = ? ORDER BY total DESC LIMIT ?")
      .all(guildId, limit);
  }

  statement(guildId, userId, limit = 10) {
    return this.db
      .prepare("SELECT * FROM transactions WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(guildId, userId, limit);
  }

  totalMoney(guildId) {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(wallet + bank), 0) AS total, COUNT(*) AS accounts FROM accounts WHERE guild_id = ?")
      .get(guildId);
    return row;
  }

  // ---------------- القروض ----------------

  createLoan({ guildId, userId, amount, reason }) {
    const info = this.db
      .prepare("INSERT INTO loans (guild_id, user_id, amount, remaining, status, reason, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
      .run(guildId, userId, amount, amount, reason || null, Date.now());
    return this.getLoan(info.lastInsertRowid);
  }

  getLoan(id) {
    return this.db.prepare("SELECT * FROM loans WHERE id = ?").get(id) || null;
  }

  /** الموافقة ذرّية: لا يمكن اعتماد نفس الطلب مرتين. */
  approveLoan(id, reviewerId) {
    return this.db
      .prepare("UPDATE loans SET status = 'active', reviewed_by = ? WHERE id = ? AND status = 'pending'")
      .run(reviewerId, id).changes === 1;
  }

  rejectLoan(id, reviewerId) {
    return this.db
      .prepare("UPDATE loans SET status = 'rejected', reviewed_by = ?, closed_at = ? WHERE id = ? AND status = 'pending'")
      .run(reviewerId, Date.now(), id).changes === 1;
  }

  repayLoan(id, amount) {
    const res = this.db
      .prepare("UPDATE loans SET remaining = remaining - ? WHERE id = ? AND status = 'active' AND remaining >= ?")
      .run(amount, id, amount);
    if (res.changes !== 1) return false;
    this.db.prepare("UPDATE loans SET status = 'paid', closed_at = ? WHERE id = ? AND remaining <= 0").run(Date.now(), id);
    return true;
  }

  activeLoans(guildId, userId) {
    return this.db
      .prepare("SELECT * FROM loans WHERE guild_id = ? AND user_id = ? AND status = 'active' ORDER BY created_at ASC")
      .all(guildId, userId);
  }

  pendingLoans(guildId) {
    return this.db.prepare("SELECT * FROM loans WHERE guild_id = ? AND status = 'pending' ORDER BY created_at ASC").all(guildId);
  }
}

module.exports = EconomyRepository;
