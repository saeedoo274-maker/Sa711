const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const GameEngine = require("../GameEngine");

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function newDeck() {
  return GameEngine.shuffle(SUITS.flatMap((s) => RANKS.map((r) => `${r}${s}`)));
}

function value(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    const r = card.slice(0, -1);
    if (r === "A") { total += 11; aces++; } else if (["J", "Q", "K"].includes(r)) total += 10;
    else total += parseInt(r, 10);
  }
  while (total > 21 && aces--) total -= 10;
  return total;
}

function render(engine, session, state, { final = false, note = null } = {}) {
  const t = engine.t(session.guild_id);
  const p = value(state.player);
  const d = value(state.dealer);
  const dealerShown = final ? `${state.dealer.join(" ")} (${d})` : `${state.dealer[0]} 🂠`;
  const embed = engine.app.theme.embed(session.guild_id, {
    title: `🃏 ${t("game.blackjack")} — ${engine.fmt(session.guild_id, session.bet)}`,
    color: final ? (note?.outcome === "won" ? "success" : note?.outcome === "draw" ? "warning" : "danger") : "primary",
    fields: [
      { name: t("game.yourHand"), value: `${state.player.join(" ")} (**${p}**)`, inline: true },
      { name: t("game.dealer"), value: dealerShown, inline: true },
      ...(note ? [{ name: "​", value: note.text }] : [])
    ]
  });
  const components = final ? [] : [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`game:${session.id}:hit`).setLabel(t("game.hit")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`game:${session.id}:stand`).setLabel(t("game.stand")).setStyle(ButtonStyle.Secondary)
  )];
  return { embeds: [embed], components };
}

function settle(engine, session, state) {
  const t = engine.t(session.guild_id);
  while (value(state.dealer) < 17) state.dealer.push(state.deck.pop());
  const p = value(state.player);
  const d = value(state.dealer);
  let outcome;
  let payout;
  if (p > 21) { outcome = "lost"; payout = 0; }
  else if (d > 21 || p > d) { outcome = "won"; payout = session.bet * 2; }
  else if (p === d) { outcome = "draw"; payout = session.bet; }
  else { outcome = "lost"; payout = 0; }
  const res = engine.finish(session, [{ userId: session.host_id, payout, outcome }]);
  if (!res.ok) return null;
  const text = outcome === "won" ? `🎉 ${t("game.won", { amount: engine.fmt(session.guild_id, payout) })}` : outcome === "draw" ? `🤝 ${t("game.draw")}` : `💸 ${t("game.lost", { amount: engine.fmt(session.guild_id, session.bet) })}`;
  return render(engine, session, state, { final: true, note: { outcome, text } });
}

module.exports = {
  key: "blackjack",
  emoji: "🃏",
  value,

  async start(engine, ctx, { bet }) {
    const check = engine.checkBet(ctx.member, bet);
    if (!check.ok) return check;
    const deck = newDeck();
    const state = { deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()] };
    const opened = engine.open(ctx.member, ctx.channel, "blackjack", bet, state);
    if (!opened.ok) return opened;
    const session = opened.session;
    // بلاك جاك طبيعي: يُحسم فورًا بعائد ×2.5
    if (value(state.player) === 21) {
      const dealerBJ = value(state.dealer) === 21;
      const payout = dealerBJ ? bet : Math.floor(bet * 2.5);
      engine.finish(session, [{ userId: ctx.member.id, payout, outcome: dealerBJ ? "draw" : "won" }]);
      const t = engine.t(ctx.guild.id);
      return { ok: true, payload: render(engine, session, state, { final: true, note: { outcome: dealerBJ ? "draw" : "won", text: dealerBJ ? `🤝 ${t("game.draw")}` : `🃏 Blackjack! ${t("game.won", { amount: engine.fmt(ctx.guild.id, payout) })}` } }) };
    }
    return { ok: true, payload: render(engine, session, state), session };
  },

  async handle(engine, interaction, session, action) {
    if (interaction.user.id !== session.host_id) return { ok: false, reason: "notYours" };
    const state = session.state;
    if (action === "hit") {
      state.player.push(state.deck.pop());
      if (value(state.player) >= 21) {
        const payload = settle(engine, session, state);
        return payload ? { ok: true, update: payload } : { ok: false, reason: "closed" };
      }
      engine.repo.saveState(session.id, state);
      return { ok: true, update: render(engine, session, state) };
    }
    if (action === "stand") {
      const payload = settle(engine, session, state);
      return payload ? { ok: true, update: payload } : { ok: false, reason: "closed" };
    }
    return { ok: false, reason: "closed" };
  },

  /** انتهاء المهلة = وقوف تلقائي (لا يستفيد اللاعب من الانتظار). */
  async expire(engine, session) {
    const payload = settle(engine, session, session.state);
    if (payload) await engine.editMessage(session, payload);
  }
};
