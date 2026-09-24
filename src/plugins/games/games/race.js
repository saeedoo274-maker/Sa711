const GameEngine = require("../GameEngine");
const { lobbyPayload, handleLobby, run } = require("../lobby");

const ANIMALS = ["🐎", "🐆", "🐇", "🐢", "🦊", "🐕", "🦄", "🐖"];

function render(engine, session) {
  const t = engine.t(session.guild_id);
  return lobbyPayload(engine, session, { title: `🏁 ${t("game.race")}`, description: t("game.raceLobby") });
}

/** السباق: كل لاعب له فرصة متساوية، والفائز يأخذ مجموع الرهانات. */
function resolve(engine) {
  return (session) => {
    const t = engine.t(session.guild_id);
    const lanes = session.players.map((p, i) => ({ p, emoji: ANIMALS[i % ANIMALS.length], progress: GameEngine.int(5, 14) }));
    const winner = lanes[GameEngine.int(0, lanes.length - 1)];
    winner.progress = 15;
    const pot = session.bet * session.players.length;
    const track = lanes.map((l) => `${"▫️".repeat(15 - l.progress)}${l.emoji}${"➖".repeat(Math.max(0, l.progress - 1))}🏁 <@${l.p}>`).join("\n");
    return {
      results: session.players.map((p) => ({ userId: p, payout: p === winner.p ? pot : 0, outcome: p === winner.p ? "won" : "lost" })),
      payload: {
        embeds: [engine.app.theme.embed(session.guild_id, {
          title: `🏁 ${t("game.race")}`,
          description: `${track}\n\n🏆 ${t("game.raceWinner", { winner: `<@${winner.p}>`, amount: engine.fmt(session.guild_id, pot) })}`,
          color: "success"
        })],
        components: [],
        allowedMentions: { parse: [] }
      }
    };
  };
}

module.exports = {
  key: "race",
  emoji: "🏁",
  multiplayer: true,
  async start(engine, ctx, { bet }) {
    const check = engine.checkBet(ctx.member, bet);
    if (!check.ok) return check;
    const opened = engine.open(ctx.member, ctx.channel, "race", bet, {}, engine.config(ctx.guild.id).lobbyMs);
    if (!opened.ok) return opened;
    return { ok: true, session: opened.session, payload: render(engine, opened.session) };
  },
  handle: (engine, interaction, session, action) => handleLobby(engine, interaction, session, action, { render: (s) => render(engine, s), resolve: resolve(engine) }),
  async expire(engine, session) {
    await engine.editMessage(session, await run(engine, session, resolve(engine)));
  }
};
