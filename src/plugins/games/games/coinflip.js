const GameEngine = require("../GameEngine");

module.exports = {
  key: "coinflip",
  emoji: "🪙",
  async start(engine, ctx, { bet, side }) {
    const check = engine.checkBet(ctx.member, bet);
    if (!check.ok) return check;
    const pick = side === "tails" ? "tails" : "heads";
    const res = engine.instant(ctx.member, ctx.channel, "coinflip", bet, () => {
      const result = GameEngine.chance(0.5) ? "heads" : "tails";
      const won = result === pick;
      return { payout: won ? bet * 2 : 0, outcome: won ? "won" : "lost", data: { result, pick } };
    });
    if (!res.ok) return res;
    const t = engine.t(ctx.guild.id);
    return {
      ok: true,
      payload: {
        embeds: [engine.app.theme.embed(ctx.guild.id, {
          title: `🪙 ${t("game.coinflip")}`,
          color: res.outcome === "won" ? "success" : "danger",
          description: `${t("game.youPicked")}: **${t(`game.side.${res.data.pick}`)}**\n${t("game.result")}: **${t(`game.side.${res.data.result}`)}**\n\n${res.outcome === "won" ? `🎉 ${t("game.won", { amount: engine.fmt(ctx.guild.id, res.payout) })}` : `💸 ${t("game.lost", { amount: engine.fmt(ctx.guild.id, bet) })}`}`,
          footer: `${t("game.wallet")}: ${engine.fmt(ctx.guild.id, res.account.wallet)}`
        })]
      }
    };
  }
};
