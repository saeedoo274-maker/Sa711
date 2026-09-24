const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const GameEngine = require("../GameEngine");

const ACCEPT_MS = 60_000;

/** مبارزة: الطرفان يراهنان بنفس المبلغ، والفائز يأخذ الاثنين (50/50 بعشوائية آمنة). */
module.exports = {
  key: "duel",
  emoji: "⚔️",

  async start(engine, ctx, { bet, target }) {
    if (!target || target.user.bot || target.id === ctx.member.id) return { ok: false, reason: "invalidTarget" };
    const check = engine.checkBet(ctx.member, bet);
    if (!check.ok) return check;
    const opened = engine.open(ctx.member, ctx.channel, "duel", bet, { target: target.id }, ACCEPT_MS);
    if (!opened.ok) return opened;
    const t = engine.t(ctx.guild.id);
    return {
      ok: true,
      session: opened.session,
      payload: {
        content: `<@${target.id}>`,
        embeds: [engine.app.theme.embed(ctx.guild.id, {
          title: `⚔️ ${t("game.duel")}`,
          description: t("game.duelInvite", { host: `<@${ctx.member.id}>`, target: `<@${target.id}>`, amount: engine.fmt(ctx.guild.id, bet) }),
          color: "warning"
        })],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`game:${opened.session.id}:accept`).setLabel(t("game.accept")).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`game:${opened.session.id}:decline`).setLabel(t("game.decline")).setStyle(ButtonStyle.Danger)
        )],
        allowedMentions: { users: [target.id] }
      }
    };
  },

  async handle(engine, interaction, session, action) {
    const t = engine.t(session.guild_id);
    if (interaction.user.id !== session.state.target) return { ok: false, reason: "notYours" };
    if (action === "decline") {
      engine.refund(session);
      return { ok: true, update: { content: null, embeds: [engine.app.theme.embed(session.guild_id, { title: `⚔️ ${t("game.duel")}`, description: t("game.duelDeclined"), color: "neutral" })], components: [] } };
    }
    if (action !== "accept") return { ok: false, reason: "closed" };
    const joined = engine.repo.join(session.id, interaction.user.id);
    if (!joined.ok) return joined;
    const fresh = engine.repo.get(session.id);
    const winner = GameEngine.chance(0.5) ? fresh.host_id : fresh.state.target;
    const loser = winner === fresh.host_id ? fresh.state.target : fresh.host_id;
    const res = engine.finish(fresh, [
      { userId: winner, payout: fresh.bet * 2, outcome: "won" },
      { userId: loser, payout: 0, outcome: "lost" }
    ]);
    if (!res.ok) return res;
    return {
      ok: true,
      update: {
        content: null,
        embeds: [engine.app.theme.embed(session.guild_id, {
          title: `⚔️ ${t("game.duel")}`,
          description: `🏆 ${t("game.duelWinner", { winner: `<@${winner}>`, amount: engine.fmt(session.guild_id, fresh.bet * 2) })}`,
          color: "success"
        })],
        components: [],
        allowedMentions: { parse: [] }
      }
    };
  }
};
