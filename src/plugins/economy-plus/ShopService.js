const { PermissionFlagsBits } = require("discord.js");

const KEY_RE = /^[a-z0-9_-]{2,32}$/;

class ShopService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  static validKey(key) {
    return KEY_RE.test(key || "");
  }

  /** السعر الفعلي بعد الخصم. العرض المحدود المنتهي يجعل العنصر غير متاح. */
  price(item, now = Date.now()) {
    if (item.offer_ends_at && now > item.offer_ends_at) return null;
    const discount = Math.min(Math.max(item.discount_percent || 0, 0), 100);
    return Math.max(0, Math.floor(item.price * (1 - discount / 100)));
  }

  available(item, now = Date.now()) {
    return !!item.enabled && this.price(item, now) !== null && (item.stock === null || item.stock > 0);
  }

  /** فحوصات ما قبل الشراء التي تحتاج ديسكورد أو أنظمة أخرى. */
  precheck(member, item, quantity) {
    const guildId = member.guild.id;
    if (!this.available(item)) return { ok: false, reason: item.stock === 0 ? "outOfStock" : "unavailable" };
    if (item.required_level && this.app.levels) {
      const level = this.app.levels.repo.get(guildId, member.id)?.level || 0;
      if (level < item.required_level) return { ok: false, reason: "level", level: item.required_level };
    }
    if (item.type === "role" || item.type === "badge") {
      if (quantity !== 1) return { ok: false, reason: "singleOnly" };
    }
    if (item.type === "role") {
      const role = item.role_id ? member.guild.roles.cache.get(item.role_id) : null;
      const me = member.guild.members.me;
      if (!role || role.managed || (me && role.position >= me.roles.highest.position) || (me && !me.permissions.has(PermissionFlagsBits.ManageRoles))) {
        return { ok: false, reason: "roleUnavailable" };
      }
      if (member.roles.cache.has(role.id)) return { ok: false, reason: "alreadyOwned" };
    }
    if (item.type === "badge" && this.app.rewardsRepo) {
      if (this.app.rewardsRepo.memberBadges(guildId, member.id).some((b) => b.badge === item.badge_key)) return { ok: false, reason: "alreadyOwned" };
    }
    return { ok: true };
  }

  async buy(member, key, quantity = 1) {
    const guildId = member.guild.id;
    const item = this.repo.itemByKey(guildId, key);
    if (!item) return { ok: false, reason: "notFound" };
    const qty = Math.max(1, Math.min(100, Math.floor(quantity)));
    const check = this.precheck(member, item, qty);
    if (!check.ok) return check;

    const unitPrice = this.price(item);
    const result = this.repo.purchase({ guildId, userId: member.id, item, quantity: qty, unitPrice });
    if (!result.ok) return result;

    // الآثار الخارجية بعد نجاح الدفع؛ فشلها يسترجع المبلغ تلقائيًا
    try {
      if (item.type === "role") await member.roles.add(item.role_id, `شراء من المتجر #${result.purchaseId}`);
      if (item.type === "badge") this.app.rewardsRepo?.awardBadge(guildId, member.id, item.badge_key, "shop");
    } catch (error) {
      this.repo.refund(guildId, result.purchaseId, this.app.client.user?.id || "system");
      this.app.logger.warn(`استرجاع تلقائي لشراء #${result.purchaseId}: ${error.message}`);
      return { ok: false, reason: "deliveryFailed" };
    }
    this.app.bus.emitSafe("shop:purchase", { guildId, userId: member.id, item, quantity: qty, total: result.total, purchaseId: result.purchaseId });
    return result;
  }

  sell(member, key, quantity = 1) {
    const item = this.repo.itemByKey(member.guild.id, key);
    if (!item) return { ok: false, reason: "notFound" };
    const result = this.repo.sell({ guildId: member.guild.id, userId: member.id, item, quantity: Math.max(1, Math.floor(quantity)) });
    if (result.ok) this.app.bus.emitSafe("shop:sell", { guildId: member.guild.id, userId: member.id, item, quantity, total: result.total });
    return result;
  }

  async refund(guild, purchaseId, actorId) {
    const result = this.repo.refund(guild.id, purchaseId, actorId);
    if (!result.ok) return result;
    const { item, purchase } = result;
    if (item?.type === "role") {
      const member = await guild.members.fetch(purchase.user_id).catch(() => null);
      if (member?.roles.cache.has(item.role_id)) await member.roles.remove(item.role_id, `استرجاع #${purchase.id}`).catch(() => {});
    }
    if (item?.type === "badge") this.app.rewardsRepo?.revokeBadge(guild.id, purchase.user_id, item.badge_key);
    this.app.bus.emitSafe("shop:refund", { guildId: guild.id, purchase, actorId });
    return result;
  }

  /** تجهيز عنصر تجميلي يملكه العضو. */
  equip(member, key) {
    const item = this.repo.itemByKey(member.guild.id, key);
    if (!item || item.type !== "cosmetic") return { ok: false, reason: "notCosmetic" };
    if (this.app.inventory.amountOf(member.guild.id, member.id, `shop.${key}`) < 1) return { ok: false, reason: "notOwned" };
    const slot = item.data?.slot || "rankBackground";
    this.repo.equip(member.guild.id, member.id, slot, `shop.${key}`);
    return { ok: true, slot, item };
  }

  /** قيمة تجميلية مجهّزة (مثل رابط خلفية بطاقة الرتبة) إن كان العضو ما زال يملك العنصر. */
  cosmetic(guildId, userId, slot) {
    const row = this.repo.equipped(guildId, userId).find((c) => c.slot === slot);
    if (!row) return null;
    if (this.app.inventory.amountOf(guildId, userId, row.item_key) < 1) return null;
    const item = this.repo.itemByKey(guildId, row.item_key.replace(/^shop\./, ""));
    return item?.data?.value || null;
  }
}

module.exports = ShopService;
