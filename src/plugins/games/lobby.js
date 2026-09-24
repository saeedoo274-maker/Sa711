const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

/**
 * منطق مشترك لألعاب الغرفة الجماعية (السباق، السرقة الجماعية):
 * المضيف يفتح غرفة برهان ثابت، اللاعبون ينضمون (ويُحجز رهانهم)، ثم البدء يدويًا أو عند انتهاء الوقت.
 */
function lobbyPayload(engine, session, { title, description }) {
  const t = engine.t(session.guild_id);
  return {
    embeds: [engine.app.theme.embed(session.guild_id, {
      title,
      description: `${description}\n\n👥 ${session.players.map((p) => `<@${p}>`).join(" ")}\n⏱️ ${t("game.startsIn")} <t:${Math.floor(session.expires_at / 1000)}:R>`,
      color: "info",
      footer: t("game.lobbyFooter", { amount: engine.fmt(session.guild_id, session.bet) })
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`game:${session.id}:join`).setLabel(t("game.join")).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`game:${session.id}:go`).setLabel(t("game.start")).setStyle(ButtonStyle.Primary)
    )],
    allowedMentions: { parse: [] }
  };
}

async function handleLobby(engine, interaction, session, action, { render, resolve }) {
  if (action === "join") {
    const res = engine.repo.join(session.id, interaction.user.id);
    if (!res.ok) return res;
    return { ok: true, update: render(engine.repo.get(session.id)) };
  }
  if (action === "go") {
    if (interaction.user.id !== session.host_id) return { ok: false, reason: "notYours" };
    return { ok: true, update: await run(engine, session, resolve) };
  }
  return { ok: false, reason: "closed" };
}

/** تنفيذ الجولة: لاعب واحد فقط = استرداد. */
async function run(engine, session, resolve) {
  const t = engine.t(session.guild_id);
  if (session.players.length < 2) {
    engine.refund(session);
    return { embeds: [engine.app.theme.embed(session.guild_id, { description: `↩️ ${t("game.notEnoughPlayers")}`, color: "neutral" })], components: [] };
  }
  const { results, payload } = resolve(session);
  const res = engine.finish(session, results);
  if (!res.ok) return { embeds: [engine.app.theme.embed(session.guild_id, { description: t("game.err.closed"), color: "neutral" })], components: [] };
  return payload;
}

module.exports = { lobbyPayload, handleLobby, run };
