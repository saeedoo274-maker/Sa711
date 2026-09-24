const { AttachmentBuilder } = require("discord.js");
const { PERIODS, dayKeysForPeriod } = require("../../core/utils/time");
const { formatDuration } = require("../../core/utils/common");
const canvas = require("../../core/utils/canvas");

const CACHE_MS = 60_000;
const CACHE_MAX = 500;

/**
 * التحليلات المركزية: سلاسل يومية لكل مقياس + إجماليات + أداء الطاقم.
 * النتائج تُخزَّن دقيقة واحدة (كاش محدود) لأن لوحة التحكم قد تطلبها مرارًا.
 */
class AnalyticsService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    this.cache = new Map();
  }

  static get PERIODS() {
    return PERIODS;
  }

  _cached(key, fn) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = fn();
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  _range(period) {
    const days = dayKeysForPeriod(period);
    const sinceDay = days[0];
    const sinceMs = Date.parse(`${sinceDay}T00:00:00Z`);
    return { days, sinceDay, sinceMs };
  }

  server(guildId, period = "7d") {
    const p = PERIODS[period] ? period : "7d";
    return this._cached(`s:${guildId}:${p}`, () => {
      this.app.history?.flush();
      const { days, sinceDay, sinceMs } = this._range(p);
      const raw = {
        joins: this.repo.presenceByDay(guildId, sinceMs, "join"),
        leaves: this.repo.presenceByDay(guildId, sinceMs, "leave"),
        messages: this.repo.messagesByDay(guildId, sinceDay),
        voiceSeconds: this.repo.voiceByDay(guildId, sinceDay),
        activeMembers: this.repo.activeByDay(guildId, sinceDay),
        ticketsOpened: this.repo.countByDay("tickets", "created_at", guildId, sinceMs),
        ticketsClosed: this.repo.countByDay("tickets", "closed_at", guildId, sinceMs, "AND closed_at IS NOT NULL"),
        applications: this.repo.countByDay("applications", "created_at", guildId, sinceMs),
        suggestions: this.repo.countByDay("suggestions", "created_at", guildId, sinceMs),
        giveaways: this.repo.countByDay("giveaways", "created_at", guildId, sinceMs),
        economyTx: this.repo.countByDay("transactions", "created_at", guildId, sinceMs),
        economyVolume: this.repo.economyVolumeByDay(guildId, sinceMs)
      };
      const series = {};
      const totals = {};
      for (const [k, byDay] of Object.entries(raw)) {
        series[k] = days.map((d) => byDay[d] || 0);
        totals[k] = series[k].reduce((a, b) => a + b, 0);
      }
      totals.activeMembers = this.repo.activeMembers(guildId, sinceDay); // مميّزون عبر الفترة لا مجموع أيام
      totals.growth = totals.joins - totals.leaves;
      const tickets = this.repo.ticketTimes(guildId, sinceMs);
      return { period: p, labels: days.map((d) => d.slice(5)), series, totals, tickets };
    });
  }

  staff(guildId, period = "30d") {
    const p = PERIODS[period] ? period : "30d";
    return this._cached(`t:${guildId}:${p}`, () => {
      const { sinceDay, sinceMs } = this._range(p);
      const rows = this.repo.staff(guildId, sinceDay, sinceMs);
      for (const r of rows) r.score = r.messages / 50 + r.voice / 3600 + r.claimed * 2 + r.closed * 2 + r.reviews * 2;
      return rows.sort((a, b) => b.score - a.score);
    });
  }

  /** حمولة ديسكورد: إمبيد + رسم بياني إن توفرت مكتبة الرسم (وإلا Sparkline نصي). */
  serverPayload(guild, period) {
    const t = this.app.i18n.forGuild(guild.id);
    const data = this.server(guild.id, period);
    const s = data.series;
    const tt = data.totals;
    const spark = (arr) => (arr.length > 1 ? `\n\`${canvas.sparkline(arr.slice(-30))}\`` : "");
    const embed = this.app.theme.embed(guild.id, {
      title: `📊 ${t("an.serverTitle")} — ${t(`an.period.${data.period}`)}`,
      color: "info",
      fields: [
        { name: `📥 ${t("an.joins")} / 📤 ${t("an.leaves")}`, value: `**${tt.joins}** / **${tt.leaves}** (${tt.growth >= 0 ? "+" : ""}${tt.growth})${spark(s.joins)}`, inline: true },
        { name: `💬 ${t("an.messages")}`, value: `**${tt.messages}**${spark(s.messages)}`, inline: true },
        { name: `👥 ${t("an.active")}`, value: `**${tt.activeMembers}** / ${guild.memberCount}${spark(s.activeMembers)}`, inline: true },
        { name: `🔊 ${t("an.voice")}`, value: `**${formatDuration(tt.voiceSeconds * 1000)}**`, inline: true },
        { name: `🎫 ${t("an.tickets")}`, value: `${t("an.opened")}: **${tt.ticketsOpened}** • ${t("an.closed")}: **${tt.ticketsClosed}**\n⏱️ ${t("an.response")}: ${data.tickets.avgResponse ? formatDuration(data.tickets.avgResponse) : "—"}\n✅ ${t("an.closeTime")}: ${data.tickets.avgClose ? formatDuration(data.tickets.avgClose) : "—"}`, inline: true },
        { name: `📝 ${t("an.applications")}`, value: `**${tt.applications}**`, inline: true },
        { name: `💡 ${t("an.suggestions")}`, value: `**${tt.suggestions}**`, inline: true },
        { name: `🎉 ${t("an.giveaways")}`, value: `**${tt.giveaways}**`, inline: true },
        { name: `🏦 ${t("an.economy")}`, value: `${tt.economyTx} tx • ${this.app.economyService ? this.app.economyService.format(guild.id, tt.economyVolume) : tt.economyVolume}`, inline: true }
      ]
    });
    const image = canvas.chart({
      title: `${guild.name} — ${t(`an.period.${data.period}`)}`,
      labels: data.labels,
      series: [
        { label: t("an.messages"), values: s.messages },
        { label: t("an.active"), values: s.activeMembers },
        { label: t("an.joins"), values: s.joins },
        { label: t("an.leaves"), values: s.leaves }
      ]
    });
    if (image) {
      embed.setImage("attachment://analytics.png");
      return { embeds: [embed], files: [new AttachmentBuilder(image, { name: "analytics.png" })] };
    }
    return { embeds: [embed] };
  }

  staffPayload(guild, period) {
    const t = this.app.i18n.forGuild(guild.id);
    const rows = this.staff(guild.id, period).slice(0, 15);
    const lines = rows.map((r, i) =>
      `**${i + 1}.** <@${r.userId}> — 💬 ${r.messages} • 🔊 ${Math.round(r.voice / 3600)}h • 🎫 ${r.claimed}/${r.closed} • 📝 ${r.reviews} • ⏱️ ${r.avgResponse ? formatDuration(r.avgResponse) : "—"}`
    );
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `👥 ${t("an.staffTitle")} — ${t(`an.period.${PERIODS[period] ? period : "30d"}`)}`,
        description: lines.join("\n") || t("ui.empty"),
        color: "info",
        footer: t("an.staffLegend")
      })],
      allowedMentions: { parse: [] }
    };
  }
}

module.exports = AnalyticsService;
