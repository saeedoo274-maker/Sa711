const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const variables = require("../../core/utils/variables");
const variableData = require("../../core/utils/variableData");
const canvas = require("../../core/utils/canvas");

const URL_RE = /^https:\/\/\S{4,500}$/i;

/**
 * الترحيب والوداع.
 * كل النصوص تدعم المتغيرات الموحّدة ({USER} {SERVER} {MEMBER_COUNT} {USER_AVATAR} ...).
 * الرتب التلقائية لا تُكرَّر هنا: يبقى نظام `autoRoles` الأصلي (أمر /رتبة_تلقائية) هو المسؤول.
 */
class WelcomeService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "welcome") || {};
  }

  _ctx(member) {
    return variableData.enrich(this.app, variables.buildContext({ member, user: member.user, guild: member.guild, client: this.app.client }), JSON.stringify(this.config(member.guild.id)));
  }

  _buttons(guild, cfg) {
    const buttons = [];
    if (cfg.rulesChannelId) {
      const t = this.app.i18n.forGuild(guild.id);
      buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t("welcome.rulesButton")).setEmoji("📜").setURL(`https://discord.com/channels/${guild.id}/${cfg.rulesChannelId}`));
    }
    for (const b of (cfg.buttons || []).slice(0, 4)) {
      if (!b?.label || !URL_RE.test(b.url || "")) continue;
      const btn = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(String(b.label).slice(0, 80)).setURL(b.url);
      if (b.emoji) btn.setEmoji(b.emoji);
      buttons.push(btn);
    }
    return buttons.length ? [new ActionRowBuilder().addComponents(buttons.slice(0, 5))] : [];
  }

  /** يبني حمولة الترحيب/الوداع (تُستخدم أيضًا للمعاينة والاختبار). */
  async buildPayload(member, kind = "welcome") {
    const root = this.config(member.guild.id);
    const cfg = kind === "goodbye" ? root.goodbye || {} : root;
    const ctx = this._ctx(member);
    const apply = (s) => (s ? variables.apply(String(s), ctx) : s);
    const payload = { allowedMentions: { users: kind === "welcome" ? [member.id] : [] } };

    if (cfg.message) payload.content = apply(cfg.message).slice(0, 2000);

    const files = [];
    if (cfg.image?.enabled) {
      const buffer = await canvas.welcomeCard({
        title: apply(cfg.image.title),
        subtitle: apply(cfg.image.subtitle),
        avatarUrl: member.user.displayAvatarURL?.({ extension: "png", size: 256 }),
        backgroundUrl: cfg.image.backgroundUrl,
        color: this.app.theme.color(member.guild.id, "primary")
      });
      if (buffer) files.push(new AttachmentBuilder(buffer, { name: `${kind}.png` }));
    }

    if (cfg.embed?.enabled) {
      const e = cfg.embed;
      const image = files.length ? `attachment://${kind}.png` : URL_RE.test(apply(e.image) || "") ? apply(e.image) : null;
      const thumbnail = URL_RE.test(apply(e.thumbnail) || "") ? apply(e.thumbnail) : null;
      payload.embeds = [this.app.theme.embed(member.guild.id, {
        title: apply(e.title),
        description: apply(e.description),
        color: e.color && /^#?[0-9a-f]{6}$/i.test(e.color) ? parseInt(e.color.replace("#", ""), 16) : kind === "goodbye" ? "neutral" : "primary",
        image,
        thumbnail
      }, member.guild)];
    }
    if (files.length) payload.files = files;
    if (kind === "welcome") payload.components = this._buttons(member.guild, root);
    return payload;
  }

  async onJoin(member) {
    const cfg = this.config(member.guild.id);
    if (member.user.bot && cfg.ignoreBots !== false) return { skipped: "bot" };
    const results = {};

    if (cfg.channelId) {
      const channel = await this.app.client.channels.fetch(cfg.channelId).catch(() => null);
      if (channel?.isTextBased?.()) {
        await channel.send(await this.buildPayload(member, "welcome")).catch((err) =>
          this.app.logger.debug(`تعذّر إرسال الترحيب في ${member.guild.id}: ${err.message}`)
        );
        results.channel = true;
      }
    }

    if (cfg.dm?.enabled && cfg.dm.message) {
      const text = variables.apply(cfg.dm.message, this._ctx(member)).slice(0, 2000);
      const report = await this.app.notifications.notify({
        guildId: member.guild.id, userId: member.id, category: "welcome",
        payload: { content: text, components: this._buttons(member.guild, cfg) }
      });
      results.dm = report.sent.includes("dm");
    }
    return results;
  }

  async onLeave(member) {
    const cfg = this.config(member.guild.id).goodbye || {};
    if (member.user?.bot && this.config(member.guild.id).ignoreBots !== false) return { skipped: "bot" };
    if (!cfg.channelId || !member.user) return {};
    const channel = await this.app.client.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return {};
    await channel.send(await this.buildPayload(member, "goodbye")).catch((err) =>
      this.app.logger.debug(`تعذّر إرسال الوداع في ${member.guild.id}: ${err.message}`)
    );
    return { channel: true };
  }

  /** التحقق من زر مخصص قبل حفظه. */
  static validButton(label, url) {
    return !!label && label.length <= 80 && URL_RE.test(url || "");
  }
}

module.exports = WelcomeService;
