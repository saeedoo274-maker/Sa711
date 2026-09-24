const GameEngine = require("../GameEngine");

// الرمز ووزنه (احتمال الظهور) ومضاعف ثلاثة متطابقة
const SYMBOLS = [
  { s: "🍒", w: 30, x3: 5 },
  { s: "🍋", w: 25, x3: 8 },
  { s: "🍇", w: 20, x3: 12 },
  { s: "🔔", w: 12, x3: 20 },
  { s: "⭐", w: 8, x3: 35 },
  { s: "💎", w: 4, x3: 75 },
  { s: "7️⃣", w: 1, x3: 250 }
];
const TOTAL = SYMBOLS.reduce((a, b) => a + b.w, 0);

function spin() {
  let r = GameEngine.int(1, TOTAL);
  for (const sym of SYMBOLS) {
    r -= sym.w;
    if (r <= 0) return sym;
  }
  return SYMBOLS[0];
}

module.exports = {
  key: "slots",
  emoji: "🎰",
  SYMBOLS,
  /** العائد: ثلاثة متطابقة = x3 للرمز، اثنان متطابقان = ×1.5. */
  payoutFor(reels, bet) {
    const [a, b, c] = reels;
    if (a.s === b.s && b.s === c.s) return bet * a.x3;
    if (a.s === b.s || b.s === c.s || a.s === c.s) return Math.floor(bet * 1.5);
    return 0;
  },
  async start(engine, ctx, { bet }) {
    const check = engine.checkBet(ctx.member, bet);
    if (!check.ok) return check;
    const res = engine.instant(ctx.member, ctx.channel, "slots", bet, () => {
      const reels = [spin(), spin(), spin()];
      const payout = module.exports.payoutFor(reels, bet);
      return { payout, outcome: payout > bet ? "won" : payout > 0 ? "draw" : "lost", data: { reels: reels.map((r) => r.s) } };
    });
    if (!res.ok) return res;
    const t = engine.t(ctx.guild.id);
    return {
      ok: true,
      payload: {
        embeds: [engine.app.theme.embed(ctx.guild.id, {
          title: `🎰 ${t("game.slots")}`,
          color: res.payout > bet ? "success" : res.payout > 0 ? "warning" : "danger",
          description: `**[ ${res.data.reels.join(" | ")} ]**\n\n${res.payout > 0 ? `🎉 ${t("game.won", { amount: engine.fmt(ctx.guild.id, res.payout) })}` : `💸 ${t("game.lost", { amount: engine.fmt(ctx.guild.id, bet) })}`}`,
          footer: `${t("game.wallet")}: ${engine.fmt(ctx.guild.id, res.account.wallet)}`
        })]
      }
    };
  }
};
