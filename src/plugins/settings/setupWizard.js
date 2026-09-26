const crypto = require("node:crypto");
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType
} = require("discord.js");
const I18n = require("../../core/i18n/I18n");

const TTL = 15 * 60_000;
const MAX_SESSIONS = 500;
const STEPS = ["language", "logs", "welcome", "staff", "tickets", "features", "preview"];
const WIZARD_FEATURES = [
  "levels", "economy", "tickets", "giveaways", "suggestions", "welcome", "verification", "history", "achievements", "games",
  "starboard", "social", "automation", "integrations", "announcements", "appeals", "invites", "afk", "reminders", "search",
  "backups", "analytics", "leaderboards", "staff", "permissions"
];

/**
 * معالج الإعداد: خطوات بالأزرار والقوائم، ولا يُحفظ شيء حتى المعاينة والتأكيد.
 * الجلسة في الذاكرة (محدودة العدد، تنتهي بعد 15 دقيقة)، ولصاحبها فقط.
 */
class SetupWizard {
  constructor(app) {
    this.app = app;
    this.sessions = new Map();
  }

  _sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (now - s.createdAt > TTL) this.sessions.delete(id);
    while (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value);
  }

  start(member) {
    this._sweep();
    const guildId = member.guild.id;
    const cfg = this.app.guildConfig.get(guildId);
    const id = crypto.randomBytes(6).toString("hex");
    const features = WIZARD_FEATURES.filter((f) => this.app.features.isKnown(f));
    this.sessions.set(id, {
      id, guildId, userId: member.id, step: 0, createdAt: Date.now(),
      draft: {
        language: cfg.language || "ar",
        logChannelId: null,
        welcomeChannelId: cfg.welcome?.channelId || null,
        staffRoleId: cfg.staff?.baseRoleId || null,
        ticketCategoryId: cfg.tickets?.categoryId || null,
        features: features.filter((f) => this.app.features.isEnabled(guildId, f))
      },
      featureList: features
    });
    return this.render(this.sessions.get(id));
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s || Date.now() - s.createdAt > TTL) {
      this.sessions.delete(id);
      return null;
    }
    return s;
  }

  _nav(s, t, { next = true } = {}) {
    const id = (a) => `setup:${s.id}:${a}`;
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(id("back")).setLabel(t("setup.back")).setStyle(ButtonStyle.Secondary).setDisabled(s.step === 0),
      ...(next ? [new ButtonBuilder().setCustomId(id("next")).setLabel(t("setup.next")).setStyle(ButtonStyle.Primary)] : []),
      new ButtonBuilder().setCustomId(id("cancel")).setLabel(t("setup.cancel")).setStyle(ButtonStyle.Danger)
    );
  }

  render(s) {
    const t = this.app.i18n.forGuild(s.guildId);
    const step = STEPS[s.step];
    const id = (a) => `setup:${s.id}:${a}`;
    const d = s.draft;
    const header = `🧭 ${t("setup.title")} — ${s.step + 1}/${STEPS.length}`;
    const embed = (description) => this.app.theme.embed(s.guildId, { title: header, description, color: "primary" });
    let row;
    switch (step) {
      case "language":
        row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id("lang")).setPlaceholder(t("setup.pickLanguage"))
          .addOptions(Object.entries(I18n.SUPPORTED).map(([value, l]) => ({ label: `${l.native} (${value})`, value, default: d.language === value }))));
        return { embeds: [embed(t("setup.stepLanguage"))], components: [row, this._nav(s, t)] };
      case "logs":
        row = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(id("log")).setPlaceholder(t("setup.pickChannel")).addChannelTypes(ChannelType.GuildText));
        return { embeds: [embed(`${t("setup.stepLogs")}\n\n${d.logChannelId ? `✅ <#${d.logChannelId}>` : "—"}`)], components: [row, this._nav(s, t)] };
      case "welcome":
        row = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(id("wel")).setPlaceholder(t("setup.pickChannel")).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));
        return { embeds: [embed(`${t("setup.stepWelcome")}\n\n${d.welcomeChannelId ? `✅ <#${d.welcomeChannelId}>` : "—"}`)], components: [row, this._nav(s, t)] };
      case "staff":
        row = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(id("staff")).setPlaceholder(t("setup.pickRole")));
        return { embeds: [embed(`${t("setup.stepStaff")}\n\n${d.staffRoleId ? `✅ <@&${d.staffRoleId}>` : "—"}`)], components: [row, this._nav(s, t)], allowedMentions: { parse: [] } };
      case "tickets":
        row = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(id("tcat")).setPlaceholder(t("setup.pickCategory")).addChannelTypes(ChannelType.GuildCategory));
        return { embeds: [embed(`${t("setup.stepTickets")}\n\n${d.ticketCategoryId ? `✅ <#${d.ticketCategoryId}>` : "—"}`)], components: [row, this._nav(s, t)] };
      case "features":
        row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id("feat")).setPlaceholder(t("setup.pickFeatures"))
          .setMinValues(0).setMaxValues(s.featureList.length)
          .addOptions(s.featureList.map((f) => ({ label: (this.app.features.list().find((x) => x.name === f)?.label || f).slice(0, 100), value: f, default: d.features.includes(f) }))));
        return { embeds: [embed(t("setup.stepFeatures"))], components: [row, this._nav(s, t)] };
      default: {
        // صفوف السجلات التفصيلية مخفية في المعاينة ويظهر ملخصها فقط
        const changes = this.changes(s).filter((c) => !c.hidden);
        return {
          embeds: [this.app.theme.embed(s.guildId, {
            title: `👁️ ${t("setup.previewTitle")}`,
            color: changes.length ? "warning" : "neutral",
            description: changes.map((c) => `• **${c.label}**: ${c.from} → ${c.to}`).join("\n").slice(0, 4000) || t("setup.noChanges")
          })],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(id("back")).setLabel(t("setup.back")).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(id("apply")).setLabel(t("setup.apply")).setStyle(ButtonStyle.Success).setDisabled(!changes.length),
            new ButtonBuilder().setCustomId(id("cancel")).setLabel(t("setup.cancel")).setStyle(ButtonStyle.Danger)
          )],
          allowedMentions: { parse: [] }
        };
      }
    }
  }

  /** الفروق بين الإعداد الحالي والمسودة + التحديثات المطلوبة (بلا حفظ). */
  changes(s) {
    const t = this.app.i18n.forGuild(s.guildId);
    const cfg = this.app.guildConfig.get(s.guildId);
    const d = s.draft;
    const out = [];
    const add = (label, path, from, to, show = (v) => v ?? "—") => {
      if (from === to || to === null || to === undefined) return;
      out.push({ label, path, value: to, from: show(from), to: show(to) });
    };
    add(t("setup.lblLanguage"), "language", cfg.language || "ar", d.language);
    if (d.logChannelId) {
      const unset = Object.entries(cfg.logs || {}).filter(([, v]) => !v).map(([k]) => k);
      for (const k of unset) out.push({ label: `${t("setup.lblLogs")} (${k})`, path: `logs.${k}`, value: d.logChannelId, from: "—", to: `<#${d.logChannelId}>`, hidden: true });
      if (unset.length) out.push({ label: t("setup.lblLogs"), path: null, from: `${unset.length} ${t("setup.unset")}`, to: `<#${d.logChannelId}>` });
    }
    add(t("setup.lblWelcome"), "welcome.channelId", cfg.welcome?.channelId || null, d.welcomeChannelId, (v) => (v ? `<#${v}>` : "—"));
    add(t("setup.lblStaff"), "staff.baseRoleId", cfg.staff?.baseRoleId || null, d.staffRoleId, (v) => (v ? `<@&${v}>` : "—"));
    add(t("setup.lblTickets"), "tickets.categoryId", cfg.tickets?.categoryId || null, d.ticketCategoryId, (v) => (v ? `<#${v}>` : "—"));
    for (const f of s.featureList) {
      const now = this.app.features.isEnabled(s.guildId, f);
      const want = d.features.includes(f);
      if (now !== want) out.push({ label: `${t("setup.lblFeature")} ${f}`, path: `features.${f}`, value: want, from: now ? "🟢" : "⚪", to: want ? "🟢" : "⚪" });
    }
    return out;
  }

  /** يطبّق كل التغييرات دفعة واحدة. */
  apply(s) {
    const updates = {};
    for (const c of this.changes(s)) if (c.path) updates[c.path] = c.value;
    if (Object.keys(updates).length) this.app.guildConfig.setMany(s.guildId, updates);
    this.sessions.delete(s.id);
    this.app.bus.emitSafe("settings:setup", { guildId: s.guildId, actorId: s.userId, keys: Object.keys(updates) });
    return Object.keys(updates).length;
  }
}

SetupWizard.STEPS = STEPS;

module.exports = SetupWizard;
