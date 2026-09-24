const GameEngine = require("../GameEngine");

const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
const EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };

/** حجر ورقة مقص ضد البوت: الفوز ×2، التعادل يعيد الرهان. */
module.exports = {
  key: "rps",
  emoji: "✂️",
  async start(engine, ctx, { bet, choice }) {
    if (!BEATS[choice]) return { ok: false, reason: "badGuess" };
    const check = engine.checkBet(ctx.member, bet);
    if (!check.ok) return check;
    const res = engine.instant(ctx.member, ctx.channel, "rps", bet, () => {
      const bot = Object.keys(BEATS)[GameEngine.int(0, 2)];
      const outcome = bot === choice ? "draw" : BEATS[choice] === bot ? "won" : "lost";
      return { payout: outcome === "won" ? bet * 2 : outcome === "draw" ? bet : 0, outcome, data: { bot } };
    });
    if (!res.ok) return res;
    const t = engine.t(ctx.guild.id);
    const line = res.outcome === "won" ? `🎉 ${t("game.won", { amount: engine.fmt(ctx.guild.id, res.payout) })}` : res.outcome === "draw" ? `🤝 ${t("game.draw")}` : `💸 ${t("game.lost", { amount: engine.fmt(ctx.guild.id, bet) })}`;
    return {
      ok: true,
      payload: {
        embeds: [engine.app.theme.embed(ctx.guild.id, {
          title: `✂️ ${t("game.rps")}`,
          color: res.outcome === "won" ? "success" : res.outcome === "draw" ? "warning" : "danger",
          description: `${EMOJI[choice]} ${t(`game.rpsChoice.${choice}`)}  vs  ${EMOJI[res.data.bot]} ${t(`game.rpsChoice.${res.data.bot}`)}\n\n${line}`,
          footer: `${t("game.wallet")}: ${engine.fmt(ctx.guild.id, res.account.wallet)}`
        })]
      }
    };
  }
};
