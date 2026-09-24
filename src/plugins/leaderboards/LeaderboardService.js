const { PERIODS, dayKeysForPeriod } = require("../../core/utils/time");
const { formatDuration } = require("../../core/utils/common");
const { stamp, pageRow, medal } = require("../../core/interactions/ui");

const PER_PAGE = 10;
const TYPES = {
  xp: { emoji: "✨", feature: "levels", periodic: false },
  level: { emoji: "⭐", feature: "levels", periodic: false },
  messages: { emoji: "💬", feature: "history", periodic: true },
  voice: { emoji: "🔊", feature: "history", periodic: true },
  activity: { emoji: "📅", feature: "history", periodic: true },
  economy: { emoji: "💰", feature: "economy", periodic: false },
  tickets: { emoji: "🎫", feature: "tickets", periodic: true },
  staff: { emoji: "👥", feature: "staff", periodic: true },
  achievements: { emoji: "🏆", feature: "achievements", periodic: true },
  reputation: { emoji: "👍", feature: "social", periodic: true },
  games: { emoji: "🎮", feature: "games", periodic: false }
};

class LeaderboardService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  static get TYPES() {
    return TYPES;
  }

  _range(period) {
    if (!period || period === "all") return { sinceDay: null, sinceMs: 0 };
    const days = dayKeysForPeriod(period);
    return { sinceDay: days[0], sinceMs: Date.parse(`${days[0]}T00:00:00Z`) };
  }

  rows(type, guildId, { period = "all", page = 1 } = {}) {
    if (type === "staff") {
      const days = PERIODS[period]?.days || 30;
      return this.app.activity.pointsLeaderboard(guildId, days, 100).map((r) => ({ user_id: r.userId, score: Math.round(r.total * 10) / 10 }))
        .slice((page - 1) * PER_PAGE, page * PER_PAGE + 1);
    }
    this.app.history?.flush();
    return this.repo.query(type, guildId, { ...this._range(period), limit: PER_PAGE + 1, offset: (page - 1) * PER_PAGE });
  }

  format(type, guildId, row) {
    if (type === "voice") return formatDuration(row.score * 1000);
    if (type === "economy" || type === "games") return this.app.economyService.format(guildId, row.score);
    if (type === "level") return `Lv ${row.score} (${row.xp} XP)`;
    if (type === "xp") return `${row.score} XP`;
    return String(row.score);
  }

  payload(guild, { type = "xp", period = "all", page = 1, ownerId }) {
    const t = this.app.i18n.forGuild(guild.id);
    const def = TYPES[type] || TYPES.xp;
    const p = def.periodic ? (PERIODS[period] ? period : "all") : "all";
    const current = Math.max(1, page);
    const rows = this.rows(type, guild.id, { period: p, page: current });
    const hasNext = rows.length > PER_PAGE;
    const shown = rows.slice(0, PER_PAGE);
    const lines = shown.map((r, i) => `${medal((current - 1) * PER_PAGE + i + 1)} <@${r.user_id}> — ${this.format(type, guild.id, r)}`);
    const mine = type === "staff" ? null : this.repo.positionOf(type, guild.id, ownerId, this._range(p));
    const s = stamp();
    const pages = hasNext ? current + 1 : current;
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `${def.emoji} ${t(`lb.type.${type}`)}${def.periodic ? ` — ${t(`lb.period.${p}`)}` : ""}`,
        description: lines.join("\n") || t("ui.empty"),
        color: "warning",
        footer: mine ? t("lb.yourPosition", { position: mine.position, score: this.format(type, guild.id, mine) }) : t("ui.page", { page: current, pages })
      })],
      components: current > 1 || hasNext ? [pageRow((pg, tag) => `lb:${type}:${p}:${pg}:${ownerId}:${s}:${tag}`, current, pages)] : [],
      allowedMentions: { parse: [] }
    };
  }
}

module.exports = LeaderboardService;
