const GameEngine = require("../GameEngine");

/** النرد: رقم محدد (1-6) يربح ×5، أو عالي/منخفض (4-6 / 1-3) يربح ×1.9. */
module.exports = {
  key: "dice",
  emoji: "🎲",
  async start(engine, ctx, { bet, guess }) {
    const check = engine.checkBet(ctx.member, bet);
    if (!check.ok) return check;
    const g = String(guess || "high").toLowerCase();
    const exact = /^[1-6]$/.test(g) ? parseInt(g, 10) : null;
    if (!exact && !["high", "low"].includes(g)) return { ok: false, reason: "badGuess" };
    const res = engine.instant(ctx.member, ctx.channel, "dice", bet, () => {
      const roll = GameEngine.int(1, 6);
      const won = exact ? roll === exact : g === "high" ? roll >= 4 : roll <= 3;
      const payout = won ? Math.floor(bet * (exact ? 5 : 1.9)) : 0;
      return { payout, outcome: won ? "won" : "lost", data: { roll } };
    });
    if (!res.ok) return res;
    const t = engine.t(ctx.guild.id);
    const faces = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
    return {
      ok: true,
      payload: {
        embeds: [engine.app.theme.embed(ctx.guild.id, {
          title: `🎲 ${t("game.dice")} — ${faces[res.data.roll - 1]} ${res.data.roll}`,
          color: res.outcome === "won" ? "success" : "danger",
          description: `${t("game.youPicked")}: **${exact || t(`game.${g}`)}**\n\n${res.outcome === "won" ? `🎉 ${t("game.won", { amount: engine.fmt(ctx.guild.id, res.payout) })}` : `💸 ${t("game.lost", { amount: engine.fmt(ctx.guild.id, bet) })}`}`,
          footer: `${t("game.wallet")}: ${engine.fmt(ctx.guild.id, res.account.wallet)}`
        })]
      }
    };
  }
};
