/**
 * واجهة المخزون الموحّد.
 * التخزين الفعلي هو rp_inventory الموجود (مع سجل حركته)، فعناصر المتجر وعناصر RP
 * في حقيبة واحدة. عناصر المتجر مفتاحها `shop.<key>`.
 */
class InventoryService {
  constructor(app) {
    this.app = app;
  }

  add(guildId, userId, itemKey, qty, { reason = null, actorId = null } = {}) {
    return this.app.rp.give({ guildId, userId, itemKey, amount: Math.max(1, Math.floor(qty)), reason, actorId });
  }

  remove(guildId, userId, itemKey, qty, { reason = null, actorId = null } = {}) {
    return this.app.rp.take({ guildId, userId, itemKey, amount: Math.max(1, Math.floor(qty)), reason, actorId });
  }

  amountOf(guildId, userId, itemKey) {
    return this.app.rp.amountOf(guildId, userId, itemKey);
  }

  /** وصف عنصر من أي كتالوج (المتجر أو RP). */
  describe(guildId, itemKey) {
    if (itemKey.startsWith("shop.")) {
      const item = this.app.economyPlusRepo.itemByKey(guildId, itemKey.slice(5));
      return item ? { label: item.name, emoji: item.emoji || "📦", source: "shop", item } : { label: itemKey, emoji: "📦", source: "shop" };
    }
    const rp = this.app.rp.getItem(guildId, itemKey);
    return rp ? { label: rp.label, emoji: rp.emoji || "📦", source: "rp", item: rp } : { label: itemKey, emoji: "📦", source: "unknown" };
  }

  list(guildId, userId) {
    return this.app.rp.inventory(guildId, userId).map((row) => ({ ...row, ...this.describe(guildId, row.item_key) }));
  }

  /** يحوّل ما يكتبه العضو (اسم أو مفتاح) لمفتاح مخزون. */
  resolveKey(guildId, userId, input) {
    const q = String(input || "").trim().toLowerCase();
    if (!q) return null;
    const owned = this.list(guildId, userId);
    const hit = owned.find((r) => r.item_key.toLowerCase() === q || r.item_key.toLowerCase() === `shop.${q}` || String(r.label).toLowerCase() === q);
    if (hit) return hit.item_key;
    if (this.app.economyPlusRepo.itemByKey(guildId, q)) return `shop.${q}`;
    return q;
  }
}

module.exports = InventoryService;
