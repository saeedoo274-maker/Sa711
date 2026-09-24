const { stamp, pageRow, medal } = require("../../core/interactions/ui");

const PER_PAGE = 10;
const PERIODS = ["all", "weekly", "daily", "voice", "messages"];

/** لوحة المتصدرين مع أزرار التصفح (صاحب الأمر فقط يقلّب الصفحات). */
function leaderboardPayload(app, guild, { period = "all", page = 1, ownerId }) {
  const t = app.i18n.forGuild(guild.id);
  const p = PERIODS.includes(period) ? period : "all";
  const total = app.levels.count(guild.id, p);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const current = Math.min(Math.max(1, page), pages);
  const rows = app.levels.leaderboard(guild.id, { period: p, limit: PER_PAGE, offset: (current - 1) * PER_PAGE });

  const format = (r) => {
    if (p === "voice") return `${Math.round(r.score / 60)} ${t("xp.minutes")}`;
    if (p === "messages") return `${r.score} ${t("xp.messagesUnit")}`;
    if (p === "all") return `${t("xp.level")} ${r.level} • ${r.score} XP`;
    return `${r.score} XP`;
  };
  const lines = rows.map((r, i) => `${medal((current - 1) * PER_PAGE + i + 1)} <@${r.user_id}> — ${format(r)}`);

  const embed = app.theme.embed(guild.id, {
    title: `🏆 ${t("xp.leaderboardTitle")} — ${t(`xp.period.${p}`)}`,
    description: lines.join("\n") || t("ui.empty"),
    color: "warning",
    footer: t("ui.page", { page: current, pages })
  });
  const s = stamp();
  const components = total > PER_PAGE ? [pageRow((pg, tag) => `lvl:top:${p}:${pg}:${ownerId}:${s}:${tag}`, current, pages)] : [];
  return { embeds: [embed], components };
}

function rewardsPayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const rewards = app.levels.repo.rewards(guild.id);
  const lines = rewards.map((r) => `**${t("xp.level")} ${r.level}** — ${app.rewards.describe(guild.id, { roleId: r.role_id, money: r.money })}`);
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🎁 ${t("xp.rewardsTitle")}`,
      description: lines.join("\n") || t("xp.noRewards"),
      color: "success",
      footer: t(app.levels.config(guild.id).stackRewards ? "xp.stackOn" : "xp.stackOff")
    })]
  };
}

function statusPayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const cfg = app.levels.config(guild.id);
  const stats = app.levels.repo.stats(guild.id);
  const mult = app.levels.repo.multipliers(guild.id);
  const list = (ids, kind) => (ids || []).map((id) => (kind === "role" ? `<@&${id}>` : `<#${id}>`)).join(" ") || "—";
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `⚙️ ${t("xp.settingsTitle")}`,
      color: app.levels.enabled(guild.id) ? "success" : "neutral",
      fields: [
        { name: t("xp.status"), value: app.levels.enabled(guild.id) ? `🟢 ${t("xp.on")}` : `⚪ ${t("xp.off")}`, inline: true },
        { name: t("xp.messageXp"), value: `\`${cfg.messageXpMin}-${cfg.messageXpMax}\``, inline: true },
        { name: t("xp.cooldown"), value: `\`${Math.round((cfg.cooldownMs || 0) / 1000)}s\``, inline: true },
        { name: t("xp.voiceXp"), value: `\`${cfg.voiceXpPerMinute}/min\``, inline: true },
        { name: t("xp.dailyCap"), value: cfg.dailyCap ? `\`${cfg.dailyCap}\`` : "∞", inline: true },
        { name: t("xp.levelUpMode"), value: `\`${cfg.levelUp?.mode}\`${cfg.levelUp?.channelId ? ` <#${cfg.levelUp.channelId}>` : ""}`, inline: true },
        { name: t("xp.ignoredChannels"), value: list(cfg.ignoredChannels, "channel") },
        { name: t("xp.ignoredRoles"), value: list(cfg.ignoredRoles, "role") },
        { name: t("xp.xpChannels"), value: list(cfg.xpChannels, "channel") },
        { name: t("xp.multipliers"), value: mult.map((m) => `${m.target_type === "role" ? `<@&${m.target_id}>` : `<#${m.target_id}>`} ×${m.multiplier}`).join("\n") || "—" },
        { name: t("xp.stats"), value: `${stats.members} ${t("xp.membersUnit")} • ${stats.totalXp} XP • ${t("xp.level")} ${stats.maxLevel} max` }
      ]
    })]
  };
}

module.exports = { leaderboardPayload, rewardsPayload, statusPayload, PERIODS };
