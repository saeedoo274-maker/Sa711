const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const GameEngine = require("../GameEngine");

const TILES = 20; // 4 صفوف × 5 أزرار، والصف الخامس لزر السحب
const EDGE = 0.97;

function multiplier(revealed, mines) {
  let m = 1;
  for (let i = 0; i < revealed; i++) m *= (TILES - i) / (TILES - mines - i);
  return Math.floor(m * EDGE * 100) / 100;
}

function render(engine, session, state, { final = false, text = null } = {}) {
  const t = engine.t(session.guild_id);
  const mult = multiplier(state.revealed.length, state.mines.length);
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 5; c++) {
      const i = r * 5 + c;
      const opened = state.revealed.includes(i);
      const isMine = state.mines.includes(i);
      const btn = new ButtonBuilder().setCustomId(`game:${session.id}:t:${i}`);
      if (opened) btn.setEmoji("💎").setStyle(ButtonStyle.Success).setDisabled(true);
      else if (final && isMine) btn.setEmoji("💣").setStyle(ButtonStyle.Danger).setDisabled(true);
      else btn.setLabel("​").setStyle(ButtonStyle.Secondary).setDisabled(final);
      row.addComponents(btn);
    }
    rows.push(row);
  }
  if (!final) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`game:${session.id}:cash`).setLabel(`${t("game.cashout")} ×${mult}`).setStyle(ButtonStyle.Primary).setDisabled(state.revealed.length === 0)
    ));
  }
  return {
    embeds: [engine.app.theme.embed(session.guild_id, {
      title: `💣 ${t("game.mines")} — ${state.mines.length} 💣 • ${engine.fmt(session.guild_id, session.bet)}`,
      description: text || `${t("game.multiplier")}: **×${mult}** • ${t("game.potential")}: ${engine.fmt(session.guild_id, Math.floor(session.bet * mult))}`,
      color: final ? (text?.startsWith("🎉") ? "success" : "danger") : "primary"
    })],
    components: rows
  };
}

function cashout(engine, session, state) {
  const t = engine.t(session.guild_id);
  const payout = Math.floor(session.bet * multiplier(state.revealed.length, state.mines.length));
  const res = engine.finish(session, [{ userId: session.host_id, payout, outcome: payout > session.bet ? "won" : payout === session.bet ? "draw" : "lost" }]);
  if (!res.ok) return null;
  return render(engine, session, state, { final: true, text: `🎉 ${t("game.won", { amount: engine.fmt(session.guild_id, payout) })}` });
}

module.exports = {
  key: "mines",
  emoji: "💣",
  multiplier,

  async start(engine, ctx, { bet, mines = 3 }) {
    const count = Math.min(Math.max(parseInt(mines, 10) || 3, 1), 10);
    const check = engine.checkBet(ctx.member, bet);
    if (!check.ok) return check;
    const state = { mines: GameEngine.shuffle([...Array(TILES).keys()]).slice(0, count), revealed: [] };
    const opened = engine.open(ctx.member, ctx.channel, "mines", bet, state);
    if (!opened.ok) return opened;
    return { ok: true, payload: render(engine, opened.session, state), session: opened.session };
  },

  async handle(engine, interaction, session, action, arg) {
    if (interaction.user.id !== session.host_id) return { ok: false, reason: "notYours" };
    const state = session.state;
    const t = engine.t(session.guild_id);
    if (action === "cash") {
      if (!state.revealed.length) return { ok: false, reason: "closed" };
      const payload = cashout(engine, session, state);
      return payload ? { ok: true, update: payload } : { ok: false, reason: "closed" };
    }
    if (action === "t") {
      const i = parseInt(arg, 10);
      if (!(i >= 0 && i < TILES) || state.revealed.includes(i)) return { ok: false, reason: "closed" };
      if (state.mines.includes(i)) {
        const res = engine.finish(session, [{ userId: session.host_id, payout: 0, outcome: "lost" }]);
        if (!res.ok) return { ok: false, reason: "closed" };
        return { ok: true, update: render(engine, session, state, { final: true, text: `💥 ${t("game.lost", { amount: engine.fmt(session.guild_id, session.bet) })}` }) };
      }
      state.revealed.push(i);
      if (state.revealed.length === TILES - state.mines.length) {
        const payload = cashout(engine, session, state);
        return payload ? { ok: true, update: payload } : { ok: false, reason: "closed" };
      }
      engine.repo.saveState(session.id, state);
      return { ok: true, update: render(engine, session, state) };
    }
    return { ok: false, reason: "closed" };
  },

  /** انتهاء المهلة: سحب تلقائي بالمضاعف الحالي (أو استرداد إن لم يكشف شيئًا). */
  async expire(engine, session) {
    if (!session.state.revealed.length) {
      engine.refund(session);
      return;
    }
    const payload = cashout(engine, session, session.state);
    if (payload) await engine.editMessage(session, payload);
  }
};
