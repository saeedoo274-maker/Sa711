const GameEngine = require("../GameEngine");
const { lobbyPayload, handleLobby, run } = require("../lobby");

/** السرقة الجماعية: كلما زاد الفريق زادت فرصة النجاح (حتى 80%). النجاح = ×2.2 لكل عضو. */
function successChance(players) {
  return Math.min(0.8, 0.25 + 0.1 * players);
}

function render(engine, session) {
  const t = engine.t(session.guild_id);
  return lobbyPayload(engine, session, {
    title: `🏦 ${t("game.heist")}`,
    description: t("game.heistLobby", { chance: Math.round(successChance(session.players.length) * 100) })
  });
}

function resolve(engine) {
  return (session) => {
    const t = engine.t(session.guild_id);
    const success = GameEngine.chance(successChance(session.players.length));
    const payout = success ? Math.floor(session.bet * 2.2) : 0;
    return {
      results: session.players.map((p) => ({ userId: p, payout, outcome: success ? "won" : "lost" })),
      payload: {
        embeds: [engine.app.theme.embed(session.guild_id, {
          title: `🏦 ${t("game.heist")}`,
          description: success
            ? `💰 ${t("game.heistSuccess", { amount: engine.fmt(session.guild_id, payout) })}\n${session.players.map((p) => `<@${p}>`).join(" ")}`
            : `🚓 ${t("game.heistFail")}`,
          color: success ? "success" : "danger"
        })],
        components: [],
        allowedMentions: { parse: [] }
      }
    };
  };
}

module.exports = {
  key: "heist",
  emoji: "🏦",
  multiplayer: true,
  successChance,
  async start(engine, ctx, { bet }) {
    const check = engine.checkBet(ctx.member, bet);
    if (!check.ok) return check;
    const opened = engine.open(ctx.member, ctx.channel, "heist", bet, {}, engine.config(ctx.guild.id).lobbyMs);
    if (!opened.ok) return opened;
    return { ok: true, session: opened.session, payload: render(engine, opened.session) };
  },
  handle: (engine, interaction, session, action) => handleLobby(engine, interaction, session, action, { render: (s) => render(engine, s), resolve: resolve(engine) }),
  async expire(engine, session) {
    await engine.editMessage(session, await run(engine, session, resolve(engine)));
  }
};
