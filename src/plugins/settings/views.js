const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const I18n = require("../../core/i18n/I18n");
const ThemeService = require("../../core/theme/ThemeService");
const { safeModal } = require("../../core/interactions/interactionSafe");

const on = (v) => (v ? "🟢" : "⚪");

function languagePayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const current = app.i18n.localeFor(guild.id);
  const coverage = app.i18n.coverage();
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🌐 ${t("cfg.languageTitle")}`,
      color: "info",
      description: Object.entries(I18n.SUPPORTED)
        .map(([code, l]) => `${code === current ? "✅" : "▫️"} **${l.native}** \`${code}\` — ${coverage[code] ?? 0}%`)
        .join("\n"),
      footer: t("cfg.languageFooter")
    })]
  };
}

function featuresPayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const rows = app.features.forGuild(guild.id).sort((a, b) => a.name.localeCompare(b.name));
  const line = (f) => `${f.globallyEnabled ? on(f.enabled) : "⛔"} \`${f.name}\`${f.source === "plugin" ? " 🧩" : ""}`;
  const half = Math.ceil(rows.length / 2);
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🧩 ${t("cfg.featuresTitle")}`,
      color: "primary",
      fields: [
        { name: "​", value: rows.slice(0, half).map(line).join("\n") || "—", inline: true },
        { name: "​", value: rows.slice(half).map(line).join("\n") || "—", inline: true }
      ],
      footer: t("cfg.featuresFooter")
    })]
  };
}

function themePayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const theme = app.theme.get(guild.id);
  const colors = ThemeService.COLOR_KEYS.map((k) => `\`${k}\` ${theme.colors?.[k] || `#${app.config.color(k).toString(16).padStart(6, "0")} (${t("cfg.default")})`}`).join("\n");
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `🎨 ${t("cfg.themeTitle")}`,
      color: "primary",
      thumbnail: theme.logoUrl || null,
      image: theme.bannerUrl || null,
      fields: [
        { name: t("cfg.colors"), value: colors },
        { name: t("cfg.footer"), value: theme.footer || "—", inline: true },
        { name: t("cfg.logo"), value: theme.logoUrl ? "✅" : "—", inline: true },
        { name: t("cfg.banner"), value: theme.bannerUrl ? "✅" : "—", inline: true }
      ]
    }, guild)]
  };
}

function logsPayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const rows = app.logs.overview(guild.id);
  const byCategory = {};
  for (const r of rows) (byCategory[r.category] ||= []).push(r);
  const fields = Object.entries(byCategory).slice(0, 25).map(([category, list]) => ({
    name: `${category} → ${list[0].channelId ? `#${guild.channels.cache.get(list[0].channelId)?.name || list[0].channelId}` : "—"}`,
    value: list.map((r) => `${on(r.enabled && r.channelId)} \`${r.key}\``).join(" ").slice(0, 1024),
    inline: false
  }));
  return { embeds: [app.theme.embed(guild.id, { title: `📜 ${t("cfg.logsTitle")}`, color: "info", fields, footer: t("cfg.logsFooter") })] };
}

function welcomePayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const w = app.welcome.config(guild.id);
  const g = w.goodbye || {};
  const autoRoles = app.guildConfig.value(guild.id, "autoRoles") || {};
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `👋 ${t("cfg.welcomeTitle")}`,
      color: "success",
      fields: [
        { name: t("cfg.welcomeChannel"), value: w.channelId ? `<#${w.channelId}>` : "—", inline: true },
        { name: t("cfg.embedImageDm"), value: `${on(w.embed?.enabled)} / ${on(w.image?.enabled)} / ${on(w.dm?.enabled)}`, inline: true },
        { name: t("cfg.rules"), value: w.rulesChannelId ? `<#${w.rulesChannelId}>` : "—", inline: true },
        { name: t("cfg.message"), value: (w.message || "—").slice(0, 300) },
        { name: t("cfg.buttons"), value: (w.buttons || []).map((b) => `[${b.label}](${b.url})`).join(" • ") || "—" },
        { name: t("cfg.autoRoles"), value: `${on(autoRoles.enabled)} ${(autoRoles.memberRoleIds || []).map((r) => `<@&${r}>`).join(" ") || "—"}\n-# /لوحة ← الأنظمة ← الرتب التلقائية`, inline: false },
        { name: t("cfg.goodbyeChannel"), value: g.channelId ? `<#${g.channelId}>` : "—", inline: true },
        { name: t("cfg.goodbyeEmbedImage"), value: `${on(g.embed?.enabled)} / ${on(g.image?.enabled)}`, inline: true }
      ],
      footer: t("cfg.variablesHint")
    })]
  };
}

function verifyPayload(app, guild) {
  const t = app.i18n.forGuild(guild.id);
  const v = app.verification.config(guild.id);
  return {
    embeds: [app.theme.embed(guild.id, {
      title: `✅ ${t("cfg.verifyTitle")}`,
      color: app.verification.isReady(guild.id) ? "success" : "neutral",
      fields: [
        { name: t("cfg.verifyRole"), value: v.roleId ? `<@&${v.roleId}>` : "—", inline: true },
        { name: t("cfg.unverifiedRole"), value: v.unverifiedRoleId ? `<@&${v.unverifiedRoleId}>` : "—", inline: true },
        { name: t("cfg.panel"), value: v.messageId ? `https://discord.com/channels/${guild.id}/${v.channelId}/${v.messageId}` : "—" },
        { name: t("cfg.verifiedCount"), value: `\`${app.verification.stats(guild.id)}\` (7d: ${app.verification.stats(guild.id, Date.now() - 7 * 86_400_000)})`, inline: true }
      ]
    })]
  };
}

const input = (id, label, value, { style = TextInputStyle.Short, max = 500, required = false } = {}) => {
  const i = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required).setMaxLength(max);
  if (value) i.setValue(String(value).slice(0, max));
  return new ActionRowBuilder().addComponents(i);
};

/** نماذج تعديل نصوص الترحيب/الوداع — القيم الحالية معبّأة مسبقًا. */
function openWelcomeModal(ctx, kind) {
  const app = ctx.app;
  const t = (k) => ctx.t(k);
  const w = app.welcome.config(ctx.guild.id);
  const modal = new ModalBuilder().setCustomId(`cfg:wel:${kind}`).setTitle(t(`cfg.modal.${kind}`).slice(0, 45));
  if (kind === "welcome") {
    modal.addComponents(
      input("message", t("cfg.f.message"), w.message, { style: TextInputStyle.Paragraph, max: 2000 }),
      input("title", t("cfg.f.embedTitle"), w.embed?.title, { max: 256 }),
      input("description", t("cfg.f.embedDescription"), w.embed?.description, { style: TextInputStyle.Paragraph, max: 3000 }),
      input("image", t("cfg.f.embedImage"), w.embed?.image),
      input("thumbnail", t("cfg.f.thumbnail"), w.embed?.thumbnail)
    );
  } else if (kind === "dm") {
    modal.addComponents(input("dm", t("cfg.f.dm"), w.dm?.message, { style: TextInputStyle.Paragraph, max: 2000 }));
  } else if (kind === "image") {
    modal.addComponents(
      input("imgTitle", t("cfg.f.imageTitle"), w.image?.title, { max: 100 }),
      input("imgSubtitle", t("cfg.f.imageSubtitle"), w.image?.subtitle, { max: 150 }),
      input("imgBackground", t("cfg.f.background"), w.image?.backgroundUrl)
    );
  } else {
    const g = w.goodbye || {};
    modal.addComponents(
      input("message", t("cfg.f.message"), g.message, { style: TextInputStyle.Paragraph, max: 2000 }),
      input("title", t("cfg.f.embedTitle"), g.embed?.title, { max: 256 }),
      input("description", t("cfg.f.embedDescription"), g.embed?.description, { style: TextInputStyle.Paragraph, max: 3000 }),
      input("imgTitle", t("cfg.f.imageTitle"), g.image?.title, { max: 100 }),
      input("imgSubtitle", t("cfg.f.imageSubtitle"), g.image?.subtitle, { max: 150 })
    );
  }
  return safeModal(ctx.interaction, modal);
}

function openVerifyModal(ctx) {
  const v = ctx.app.verification.config(ctx.guild.id);
  const t = (k) => ctx.t(k);
  const modal = new ModalBuilder().setCustomId("cfg:ver").setTitle(t("cfg.verifyTitle").slice(0, 45)).addComponents(
    input("title", t("cfg.f.embedTitle"), v.title, { max: 200 }),
    input("description", t("cfg.f.embedDescription"), v.description, { style: TextInputStyle.Paragraph, max: 2000 }),
    input("button", t("cfg.f.button"), v.buttonLabel, { max: 80 })
  );
  return safeModal(ctx.interaction, modal);
}

module.exports = { languagePayload, featuresPayload, themePayload, logsPayload, welcomePayload, verifyPayload, openWelcomeModal, openVerifyModal };
