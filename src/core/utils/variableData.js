const variables = require("./variables");

const STAT_VARS = ["XP", "LEVEL", "RANK", "BALANCE", "BANK", "REPUTATION"];

/**
 * يملأ متغيرات الإحصاءات ({XP} {LEVEL} {BALANCE}...) من قواعد البيانات،
 * لكن فقط إن كان النص يستخدمها فعلًا — فلا استعلامات بلا داعٍ.
 * منفصل عن variables.js حتى تبقى تلك الوحدة نقية بلا اعتماد على التطبيق.
 */
function enrich(app, ctx, ...texts) {
  const used = new Set();
  for (const t of texts.flat()) for (const v of variables.usedVariables(typeof t === "string" ? t : JSON.stringify(t || ""))) used.add(v);
  if (!STAT_VARS.some((v) => used.has(v))) return ctx;
  const guildId = ctx.guild?.id;
  const userId = ctx.user?.id || ctx.member?.id;
  if (!guildId || !userId) return ctx;

  const out = { ...ctx };
  try {
    if ((used.has("XP") || used.has("LEVEL") || used.has("RANK")) && app.levels) {
      const row = app.levels.repo.get(guildId, userId);
      if (out.xp == null) out.xp = row?.xp || 0;
      if (out.level == null) out.level = row?.level || 0;
      if (out.rank == null) out.rank = app.levels.repo.rankOf(guildId, userId) || "-";
    }
    if ((used.has("BALANCE") || used.has("BANK")) && app.economy) {
      const account = app.economy.get(guildId, userId);
      if (out.balance == null) out.balance = account ? account.wallet + account.bank : 0;
      if (out.bank == null) out.bank = account ? account.bank : 0;
    }
    if (used.has("REPUTATION") && app.socialPlus && out.reputation == null) {
      out.reputation = app.socialPlus.reputation(guildId, userId);
    }
  } catch (error) {
    app.logger.warn(`تعذّر ملء متغيرات الإحصاءات: ${error.message}`);
  }
  return out;
}

/** تطبيق كامل: بناء السياق، ملء الإحصاءات عند الحاجة، ثم الاستبدال. */
function render(app, text, ctxInput = {}) {
  const ctx = enrich(app, variables.buildContext(ctxInput), text);
  return variables.apply(text, ctx);
}

module.exports = { enrich, render, STAT_VARS };
