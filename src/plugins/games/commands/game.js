const { SlashCommandBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { parseAmount } = require("../../../core/utils/common");
const { medal } = require("../../../core/interactions/ui");

const betOpt = (o, req = true) => o.setName("bet").setDescription("الرهان (يدعم 1k)").setRequired(req).setMaxLength(12);
const INTERACTIVE = new Set(["blackjack", "mines", "trivia", "duel", "race", "heist"]);

function failGame(ctx, res) {
  const details = ctx.t(`game.err.${res.reason}`, { min: res.min ?? "", max: res.max ?? "", game: res.game ?? "" });
  return ctx.fail("errors.actionFailed", { details: details.startsWith("game.err.") ? res.reason : details });
}

module.exports = [
  {
    name: "لعبة",
    aliases: ["game", "games", "cf", "coinflip", "slots", "dice", "bj", "blackjack", "mines", "trivia", "rps", "duel", "race", "heist"],
    aliasRoutes: {
      cf: { sub: "coinflip" }, coinflip: { sub: "coinflip" }, slots: { sub: "slots" }, dice: { sub: "dice" }, bj: { sub: "blackjack" },
      blackjack: { sub: "blackjack" }, mines: { sub: "mines" }, trivia: { sub: "trivia" }, rps: { sub: "rps" }, duel: { sub: "duel" },
      race: { sub: "race" }, heist: { sub: "heist" }
    },
    subAliases: { عملة: "coinflip", نرد: "dice", سلوت: "slots", بلاكجاك: "blackjack", ألغام: "mines", أسئلة: "trivia", مبارزة: "duel", سباق: "race", سطو: "heist", احصائياتي: "stats", الصدارة: "top" },
    description: "ألعاب برهانات من جيبك: عملة، نرد، سلوتس، بلاك جاك، حجر ورقة مقص، أسئلة، مبارزة، سباق، ألغام، سطو جماعي.",
    usage: "/لعبة slots bet:500 | !cf 100 heads | !bj 1k",
    arguments: [
      { name: "coinflip/dice/slots/rps", required: false, description: "ألعاب فورية" },
      { name: "blackjack/mines/trivia", required: false, description: "ألعاب تفاعلية" },
      { name: "duel/race/heist", required: false, description: "ألعاب جماعية" },
      { name: "stats/top", required: false, description: "إحصاءاتك والمتصدرون" }
    ],
    examples: ["!cf 100 heads", "!slots 250", "/لعبة mines bet:1k mines:5", "/لعبة duel user:@عضو bet:500"],
    category: "games",
    cooldown: 2000,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("لعبة")
      .setDescription("الألعاب")
      .addSubcommand((s) => s.setName("coinflip").setDescription("رمي عملة ×2").addStringOption(betOpt)
        .addStringOption((o) => o.setName("side").setDescription("الوجه").addChoices({ name: "صورة", value: "heads" }, { name: "كتابة", value: "tails" })))
      .addSubcommand((s) => s.setName("dice").setDescription("نرد: رقم ×5 أو عالي/منخفض ×1.9").addStringOption(betOpt)
        .addStringOption((o) => o.setName("guess").setDescription("1-6 أو high/low").setMaxLength(4)))
      .addSubcommand((s) => s.setName("slots").setDescription("آلة السلوتس").addStringOption(betOpt))
      .addSubcommand((s) => s.setName("blackjack").setDescription("بلاك جاك").addStringOption(betOpt))
      .addSubcommand((s) => s.setName("rps").setDescription("حجر ورقة مقص").addStringOption(betOpt)
        .addStringOption((o) => o.setName("choice").setDescription("اختيارك").setRequired(true).addChoices({ name: "حجر", value: "rock" }, { name: "ورقة", value: "paper" }, { name: "مقص", value: "scissors" })))
      .addSubcommand((s) => s.setName("trivia").setDescription("سؤال (بلا رهان = مجاني)").addStringOption((o) => betOpt(o, false)))
      .addSubcommand((s) => s.setName("duel").setDescription("مبارزة عضو").addUserOption((o) => o.setName("user").setDescription("الخصم").setRequired(true)).addStringOption(betOpt))
      .addSubcommand((s) => s.setName("race").setDescription("سباق جماعي").addStringOption(betOpt))
      .addSubcommand((s) => s.setName("mines").setDescription("ألغام").addStringOption(betOpt)
        .addIntegerOption((o) => o.setName("mines").setDescription("عدد الألغام (1-10)").setMinValue(1).setMaxValue(10)))
      .addSubcommand((s) => s.setName("heist").setDescription("سطو جماعي").addStringOption(betOpt))
      .addSubcommand((s) => s.setName("stats").setDescription("إحصاءات ألعابك").addUserOption((o) => o.setName("user").setDescription("العضو")))
      .addSubcommand((s) => s.setName("top").setDescription("متصدرو الألعاب")
        .addStringOption((o) => o.setName("game").setDescription("لعبة محددة").addChoices(...["coinflip", "dice", "slots", "blackjack", "rps", "trivia", "duel", "race", "mines", "heist"].map((g) => ({ name: g, value: g }))))),

    async execute(ctx) {
      const app = ctx.app;
      const engine = app.games;
      const sub = ctx.subcommand();
      const t = (k, v) => ctx.t(k, v);

      if (sub === "stats") {
        const user = (await ctx.getUser("user", 0)) || ctx.user;
        const rows = engine.repo.stats(ctx.guild.id, user.id);
        const fmt = (v) => engine.fmt(ctx.guild.id, v);
        return ctx.reply({
          embeds: [ctx.embed({
            title: `🎮 ${t("game.statsTitle", { user: user.username })}`,
            color: "info",
            description: rows.map((r) => `${engine.games.get(r.game)?.emoji || "🎮"} **${r.game}** — ${r.played} • ✅ ${r.won} • ❌ ${r.lost} • ${r.profit >= 0 ? "📈" : "📉"} ${fmt(r.profit)}`).join("\n") || t("ui.empty")
          })]
        });
      }
      if (sub === "top") {
        const game = ctx.getString("game", 0);
        const rows = engine.repo.leaderboard(ctx.guild.id, { game, by: "profit", limit: 10 });
        return ctx.reply({
          embeds: [ctx.embed({
            title: `🏆 ${t("game.topTitle")}${game ? ` — ${game}` : ""}`,
            color: "warning",
            description: rows.map((r, i) => `${medal(i + 1)} <@${r.user_id}> — ${engine.fmt(ctx.guild.id, r.score)} (${r.won}/${r.played})`).join("\n") || t("ui.empty")
          })],
          allowedMentions: { parse: [] }
        });
      }

      // ---- بدء لعبة ----
      const rawBet = ctx.isSlash ? ctx.interaction.options.getString("bet") : ctx.args[0];
      const bet = rawBet === null || rawBet === undefined || rawBet === "" ? (sub === "trivia" ? 0 : null) : parseAmount(rawBet);
      if (bet === null || bet === undefined) return failGame(ctx, { reason: "betRange", ...engine.config(ctx.guild.id) });
      const options = { bet };
      if (sub === "coinflip") options.side = ctx.isSlash ? ctx.interaction.options.getString("side") : ctx.args[1];
      if (sub === "dice") options.guess = ctx.isSlash ? ctx.interaction.options.getString("guess") : ctx.args[1];
      if (sub === "rps") options.choice = ctx.isSlash ? ctx.interaction.options.getString("choice") : ctx.args[1];
      if (sub === "mines") options.mines = ctx.isSlash ? ctx.interaction.options.getInteger("mines") : ctx.args[1];
      if (sub === "duel") {
        options.target = await ctx.getMember("user", 1);
        // البريفكس: !duel @عضو 500
        if (!ctx.isSlash) options.bet = parseAmount(ctx.args.find((a) => !/^<@!?\d+>$/.test(a) && parseAmount(a)));
      }

      const res = await engine.start(ctx, sub, options);
      if (!res.ok) return failGame(ctx, res);
      if (INTERACTIVE.has(sub) && res.session) {
        await engine.replyAndTrack(ctx, res.session, res.payload);
        return null;
      }
      return ctx.reply(res.payload);
    }
  }
];
