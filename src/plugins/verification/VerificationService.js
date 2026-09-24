const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

/**
 * تحقق وظيفي بسيط (ليس نظام حماية): زر يمنح رتبة "متحقق" ويزيل رتبة "غير متحقق".
 * لا CAPTCHA ولا فحص أعمار حسابات ولا أي منطق أمني — بحسب نطاق المهمة.
 */
class VerificationService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "verification") || {};
  }

  isReady(guildId) {
    return this.app.features.isEnabled(guildId, "verification") && !!this.config(guildId).roleId;
  }

  panelPayload(guild) {
    const cfg = this.config(guild.id);
    return {
      embeds: [this.app.theme.embed(guild.id, { title: `✅ ${cfg.title || "التحقق"}`, description: cfg.description, color: "success" }, guild)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("verify:go").setLabel(String(cfg.buttonLabel || "Verify").slice(0, 80)).setStyle(ButtonStyle.Success)
      )]
    };
  }

  /** ينشر لوحة التحقق (أو يحدّث المنشورة سابقًا). */
  async publish(guild, channel) {
    const cfg = this.config(guild.id);
    if (cfg.messageId && cfg.channelId === channel.id) {
      const existing = await channel.messages.fetch(cfg.messageId).catch(() => null);
      if (existing) {
        await existing.edit(this.panelPayload(guild));
        return existing;
      }
    }
    const message = await channel.send(this.panelPayload(guild));
    this.app.guildConfig.setMany(guild.id, { "verification.channelId": channel.id, "verification.messageId": message.id });
    return message;
  }

  _manageable(guild, roleId) {
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    const me = guild.members.me;
    if (!role) return null;
    if (role.managed || (me && role.position >= me.roles.highest.position)) return null;
    return role;
  }

  async onJoin(member) {
    if (member.user.bot || !this.isReady(member.guild.id)) return false;
    const role = this._manageable(member.guild, this.config(member.guild.id).unverifiedRoleId);
    if (!role) return false;
    await member.roles.add(role, "بانتظار التحقق").catch((err) => this.app.logger.debug(`رتبة غير متحقق فشلت: ${err.message}`));
    return true;
  }

  async verify(member) {
    const cfg = this.config(member.guild.id);
    if (!this.isReady(member.guild.id)) return { ok: false, reason: "notConfigured" };
    const role = this._manageable(member.guild, cfg.roleId);
    if (!role) return { ok: false, reason: "roleUnmanageable" };
    if (member.roles.cache.has(role.id)) return { ok: false, reason: "already" };
    await member.roles.add(role, "تحقق");
    const unverified = this._manageable(member.guild, cfg.unverifiedRoleId);
    if (unverified && member.roles.cache.has(unverified.id)) await member.roles.remove(unverified, "تحقق").catch(() => {});
    this.repo.record(member.guild.id, member.id);
    const age = member.user.createdTimestamp ? Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000) : null;
    this.app.bus.emitSafe("verification:verified", { guildId: member.guild.id, userId: member.id, accountAgeDays: age });
    return { ok: true };
  }

  stats(guildId, sinceMs = 0) {
    return this.repo.count(guildId, sinceMs);
  }
}

module.exports = VerificationService;
