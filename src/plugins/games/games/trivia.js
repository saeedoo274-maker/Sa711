const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const GameEngine = require("../GameEngine");
const BANK = require("../data/trivia.json");

const ANSWER_MS = 20_000;

/** أسئلة: الإجابة الأولى في البنك هي الصحيحة، وتُخلط عند العرض. بلا رهان = لعب مجاني بمكافأة XP. */
module.exports = {
  key: "trivia",
  emoji: "🧠",

  async start(engine, ctx, { bet = 0 }) {
    const check = engine.checkBet(ctx.member, bet, { allowFree: true });
    if (!check.ok) return check;
    const locale = engine.app.i18n.localeFor(ctx.guild.id);
    const pool = BANK[locale] || BANK.ar;
    const question = pool[GameEngine.int(0, pool.length - 1)];
    const order = GameEngine.shuffle([0, 1, 2, 3]);
    const state = { q: question.q, answers: order.map((i) => question.a[i]), correct: order.indexOf(0) };
    const opened = engine.open(ctx.member, ctx.channel, "trivia", bet, state, ANSWER_MS);
    if (!opened.ok) return opened;
    const t = engine.t(ctx.guild.id);
    const row = new ActionRowBuilder().addComponents(
      state.answers.map((a, i) => new ButtonBuilder().setCustomId(`game:${opened.session.id}:a:${i}`).setLabel(String(a).slice(0, 80)).setStyle(ButtonStyle.Primary))
    );
    return {
      ok: true,
      session: opened.session,
      payload: {
        embeds: [engine.app.theme.embed(ctx.guild.id, {
          title: `🧠 ${t("game.trivia")}${bet ? ` — ${engine.fmt(ctx.guild.id, bet)}` : ""}`,
          description: `**${state.q}**\n\n⏱️ ${t("game.answerWithin", { seconds: ANSWER_MS / 1000 })}`,
          color: "info"
        })],
        components: [row]
      }
    };
  },

  async handle(engine, interaction, session, action, arg) {
    if (interaction.user.id !== session.host_id) return { ok: false, reason: "notYours" };
    if (action !== "a") return { ok: false, reason: "closed" };
    const t = engine.t(session.guild_id);
    const state = session.state;
    const pick = parseInt(arg, 10);
    const right = pick === state.correct;
    const payout = right ? session.bet * 2 : 0;
    const res = engine.finish(session, [{ userId: session.host_id, payout, outcome: right ? "won" : "lost" }]);
    if (!res.ok) return { ok: false, reason: "closed" };
    if (right && !session.bet && engine.app.levels && engine.app.features.isEnabled(session.guild_id, "levels")) {
      engine.app.levels.addXp(session.guild_id, session.host_id, 20, { reason: "trivia", log: false });
    }
    const row = new ActionRowBuilder().addComponents(
      state.answers.map((a, i) => new ButtonBuilder().setCustomId(`game:${session.id}:a:${i}`).setLabel(String(a).slice(0, 80))
        .setStyle(i === state.correct ? ButtonStyle.Success : i === pick ? ButtonStyle.Danger : ButtonStyle.Secondary).setDisabled(true))
    );
    const text = right
      ? (session.bet ? `🎉 ${t("game.won", { amount: engine.fmt(session.guild_id, payout) })}` : `🎉 ${t("game.correctFree")}`)
      : `❌ ${t("game.wrong", { answer: state.answers[state.correct] })}`;
    return {
      ok: true,
      update: {
        embeds: [engine.app.theme.embed(session.guild_id, { title: `🧠 ${t("game.trivia")}`, description: `**${state.q}**\n\n${text}`, color: right ? "success" : "danger" })],
        components: [row]
      }
    };
  },

  /** لم يُجب في الوقت: خسارة (بلا استرداد، وإلا صار الانتظار حيلة لتجنب الخسارة). */
  async expire(engine, session) {
    const t = engine.t(session.guild_id);
    const res = engine.finish(session, [{ userId: session.host_id, payout: 0, outcome: "lost" }]);
    if (res.ok) {
      await engine.editMessage(session, {
        embeds: [engine.app.theme.embed(session.guild_id, { title: `🧠 ${t("game.trivia")}`, description: `**${session.state.q}**\n\n⏱️ ${t("game.timeUp", { answer: session.state.answers[session.state.correct] })}`, color: "danger" })],
        components: []
      });
    }
  }
};
