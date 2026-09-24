const { dayKey } = require("../../core/utils/common");
const GiveawaysPlusRepository = require("./GiveawaysPlusRepository");

const MAX_DURATION = 30 * 86_400_000;
const MAX_START_DELAY = 60 * 86_400_000;
const TEMPLATE_RE = /^[\p{L}\p{N}_-]{1,32}$/u;

/**
 * توسعة السحوبات. لا تستبدل GiveawayService: تضيف له خطافات للشروط والفرص
 * وتدير السحوبات المجدولة والقوالب والسجل. الإنهاء والسحب الذرّي يبقيان في الخدمة الأصلية.
 */
class GiveawaysPlusService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "giveaways") || {};
  }

  // ---------------- الشروط والفرص ----------------

  /** الشروط الإضافية (المستوى، النشاط، الدعوات). تُستدعى من GiveawayService.eligibility. */
  eligibility(giveaway, member) {
    const guildId = member.guild.id;
    const t = this.app.i18n.forGuild(guildId);
    if (giveaway.min_level) {
      if (!this.app.levels || !this.app.features.isEnabled(guildId, "levels")) return { ok: false, message: t("gw.reqUnavailable", { system: "levels" }) };
      const level = this.app.levels.profile(guildId, member.id).level || 0;
      if (level < giveaway.min_level) return { ok: false, message: t("gw.reqLevel", { level: giveaway.min_level, current: level }) };
    }
    if (giveaway.min_messages) {
      if (!this.app.historyRepo || !this.app.features.isEnabled(guildId, "history")) return { ok: false, message: t("gw.reqUnavailable", { system: "history" }) };
      this.app.history.flush();
      const days = giveaway.activity_days || 30;
      const since = dayKey(new Date(Date.now() - (days - 1) * 86_400_000));
      const messages = this.app.historyRepo.activity(guildId, member.id, since).messages;
      if (messages < giveaway.min_messages) return { ok: false, message: t("gw.reqMessages", { count: giveaway.min_messages, days, current: messages }) };
    }
    if (giveaway.min_invites) {
      if (!this.app.invites || !this.app.features.isEnabled(guildId, "invites")) return { ok: false, message: t("gw.reqUnavailable", { system: "invites" }) };
      const invites = this.app.invites.count(guildId, member.id);
      if (invites < giveaway.min_invites) return { ok: false, message: t("gw.reqInvites", { count: giveaway.min_invites, current: invites }) };
    }
    return { ok: true };
  }

  /** أعلى عدد فرص بين رتب البونص التي يملكها العضو. */
  weight(giveaway, member) {
    let best = 1;
    for (const b of GiveawaysPlusRepository.parseBonus(giveaway)) {
      if (member.roles.cache.has(b.roleId)) best = Math.max(best, b.entries);
    }
    return best;
  }

  extraFields(giveaway) {
    const t = this.app.i18n.forGuild(giveaway.guild_id);
    const req = [];
    if (giveaway.min_level) req.push(`⭐ ${t("gw.fLevel", { level: giveaway.min_level })}`);
    if (giveaway.min_messages) req.push(`💬 ${t("gw.fMessages", { count: giveaway.min_messages, days: giveaway.activity_days || 30 })}`);
    if (giveaway.min_invites) req.push(`📨 ${t("gw.fInvites", { count: giveaway.min_invites })}`);
    const fields = [];
    if (req.length) fields.push({ name: t("gw.requirements"), value: req.join("\n"), inline: false });
    const bonus = GiveawaysPlusRepository.parseBonus(giveaway);
    if (bonus.length) fields.push({ name: t("gw.bonus"), value: bonus.map((b) => `<@&${b.roleId}> ×${b.entries}`).join("\n"), inline: true });
    return fields;
  }

  // ---------------- الإنشاء والجدولة ----------------

  /** يتحقق من الخيارات الإضافية قبل الإنشاء. */
  validate(guildId, opts) {
    if (opts.minLevel && (!this.app.levels || !this.app.features.isEnabled(guildId, "levels"))) return { ok: false, reason: "levelsDisabled" };
    if (opts.minMessages && (!this.app.historyRepo || !this.app.features.isEnabled(guildId, "history"))) return { ok: false, reason: "historyDisabled" };
    if (opts.minInvites && (!this.app.invites || !this.app.features.isEnabled(guildId, "invites"))) return { ok: false, reason: "invitesDisabled" };
    if (opts.durationMs > MAX_DURATION) return { ok: false, reason: "tooLong" };
    if (opts.startsInMs && opts.startsInMs > MAX_START_DELAY) return { ok: false, reason: "startTooFar" };
    return { ok: true };
  }

  /**
   * إنشاء سحب (فوري أو مجدول) عبر المستودع الأصلي، ثم حفظ الخيارات الإضافية.
   * opts: { channel, prize, durationMs, winners, hostId, requiredRoleId, bonusRoleId, bonusEntries,
   *         minAccountAgeMs, minLevel, minMessages, activityDays, minInvites, bonusRoles, description, dmWinners, startsInMs }
   */
  async create(guild, opts) {
    const valid = this.validate(guild.id, opts);
    if (!valid.ok) return valid;
    const giveaway = this.app.giveaways.create({
      guildId: guild.id,
      channelId: opts.channel.id,
      prize: opts.prize,
      winnersCount: opts.winners || 1,
      hostId: opts.hostId,
      requiredRoleId: opts.requiredRoleId || null,
      bonusRoleId: opts.bonusRoleId || null,
      bonusEntries: opts.bonusEntries || 1,
      minAccountAgeMs: opts.minAccountAgeMs || null,
      endsAt: Date.now() + (opts.startsInMs || 0) + opts.durationMs
    });
    this.repo.setExtras(giveaway.id, {
      min_level: opts.minLevel || null,
      min_messages: opts.minMessages || null,
      activity_days: opts.minMessages ? opts.activityDays || 30 : null,
      min_invites: opts.minInvites || null,
      bonus_roles: JSON.stringify((opts.bonusRoles || []).slice(0, this.config(guild.id).maxBonusRoles || 5)),
      description: opts.description || null,
      dm_winners: (opts.dmWinners ?? this.config(guild.id).dmWinnersDefault) ? 1 : 0,
      duration_ms: opts.durationMs
    });
    if (opts.startsInMs) {
      const startsAt = Date.now() + opts.startsInMs;
      this.repo.markScheduled(giveaway.id, startsAt, opts.durationMs);
      this.app.scheduler.schedule({ type: "giveaway:start", guildId: guild.id, uniqueKey: `giveaway-start:${giveaway.id}`, runAt: startsAt, payload: { id: giveaway.id } });
      return { ok: true, giveaway: this.app.giveaways.getById(giveaway.id), scheduled: true, startsAt };
    }
    const fresh = this.app.giveaways.getById(giveaway.id);
    await this.publish(fresh, opts.channel);
    return { ok: true, giveaway: this.app.giveaways.getById(giveaway.id), scheduled: false };
  }

  async publish(giveaway, channel = null) {
    const ch = channel || (await this.app.client.channels.fetch(giveaway.channel_id).catch(() => null));
    if (!ch?.send) return { ok: false, reason: "channelMissing" };
    const svc = this.app.giveawayService;
    const message = await ch.send({ embeds: [svc.buildEmbed(giveaway)], components: svc.buttons(giveaway) });
    this.app.giveaways.setMessage(giveaway.id, message.id);
    this.app.bus.emitSafe("giveaway:created", { guildId: giveaway.guild_id, giveaway, hostId: giveaway.host_id });
    return { ok: true, message };
  }

  /** مهمة المجدول: تفعيل السحب ونشر رسالته. */
  async start(id) {
    const giveaway = this.app.giveaways.getById(id);
    if (!giveaway || giveaway.status !== "scheduled") return;
    const endsAt = Date.now() + (giveaway.duration_ms || giveaway.ends_at - (giveaway.starts_at || giveaway.created_at));
    if (!this.repo.activate(id, endsAt)) return;
    const res = await this.publish(this.app.giveaways.getById(id));
    if (!res.ok) {
      this.app.giveaways.cancel(id);
      this.app.logger.warn(`سحب مجدول #${id} أُلغي: قناته لم تعد موجودة.`);
    }
  }

  cancelScheduled(giveaway) {
    if (!this.repo.cancelScheduled(giveaway.id)) return false;
    this.app.scheduler.cancelByKey(`giveaway-start:${giveaway.id}`);
    return true;
  }

  addBonusRole(giveaway, roleId, entries) {
    if (!["active", "scheduled"].includes(giveaway.status)) return { ok: false, reason: "notActive" };
    const list = GiveawaysPlusRepository.parseBonus(giveaway).filter((b) => b.roleId !== roleId);
    if (entries > 1) list.push({ roleId, entries });
    if (list.length > (this.config(giveaway.guild_id).maxBonusRoles || 5)) return { ok: false, reason: "maxBonus" };
    this.repo.setExtras(giveaway.id, { bonus_roles: JSON.stringify(list) });
    return { ok: true, bonus: list };
  }

  /** بعد الإنهاء (أو إعادة السحب): وقت الانتهاء، ورسائل خاصة للفائزين إن فُعّلت. */
  async onEnded({ giveaway, winners, rerolledBy }) {
    if (!giveaway) return;
    this.repo.markEndedAt(giveaway.id);
    const fresh = this.app.giveaways.getById(giveaway.id);
    if (!fresh?.dm_winners || !winners?.length) return;
    const t = this.app.i18n.forGuild(giveaway.guild_id);
    const guild = this.app.client.guilds?.cache?.get(giveaway.guild_id);
    for (const userId of winners) {
      await this.app.notifications.notify({
        guildId: giveaway.guild_id,
        userId,
        category: "giveaways",
        targets: ["dm"],
        payload: { content: `🎉 ${t(rerolledBy ? "gw.dmRerollWin" : "gw.dmWin", { prize: giveaway.prize, server: guild?.name || giveaway.guild_id })}` }
      });
    }
  }

  // ---------------- القوالب ----------------

  saveTemplate(guildId, name, data, userId) {
    const key = String(name || "").trim().toLowerCase();
    if (!TEMPLATE_RE.test(key)) return { ok: false, reason: "badName" };
    if (!this.repo.template(guildId, key) && this.repo.templateCount(guildId) >= (this.config(guildId).maxTemplates || 25)) return { ok: false, reason: "maxTemplates" };
    this.repo.saveTemplate(guildId, key, data, userId);
    return { ok: true, name: key };
  }

  /** يحوّل سحبًا موجودًا إلى بيانات قالب. */
  static templateFrom(giveaway) {
    return {
      prize: giveaway.prize,
      durationMs: giveaway.duration_ms || Math.max(60_000, giveaway.ends_at - (giveaway.starts_at || giveaway.created_at)),
      winners: giveaway.winners_count,
      requiredRoleId: giveaway.required_role_id,
      bonusRoleId: giveaway.bonus_role_id,
      bonusEntries: giveaway.bonus_entries,
      minAccountAgeMs: giveaway.min_account_age_ms,
      minLevel: giveaway.min_level,
      minMessages: giveaway.min_messages,
      activityDays: giveaway.activity_days,
      minInvites: giveaway.min_invites,
      bonusRoles: GiveawaysPlusRepository.parseBonus(giveaway),
      description: giveaway.description,
      dmWinners: !!giveaway.dm_winners
    };
  }

  // ---------------- العرض ----------------

  historyPayload(guild, userId = null) {
    const t = this.app.i18n.forGuild(guild.id);
    const ts = (ms) => (ms ? `<t:${Math.floor(ms / 1000)}:d>` : "—");
    if (userId) {
      const wins = this.repo.winsOf(guild.id, userId);
      return {
        embeds: [this.app.theme.embed(guild.id, {
          title: `🏆 ${t("gw.winsTitle", { count: this.repo.winCount(guild.id, userId) })}`,
          description: `<@${userId}>\n\n${wins.map((w) => `\`#${w.id}\` **${w.prize}** — ${ts(w.drawn_at)}`).join("\n") || t("ui.empty")}`,
          color: "warning"
        })],
        allowedMentions: { parse: [] }
      };
    }
    const rows = this.repo.history(guild.id, 10);
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `📜 ${t("gw.historyTitle")}`,
        description: rows.map((g) => {
          const winners = g.winner_ids ? g.winner_ids.split(",").slice(0, 5).map((id) => `<@${id}>`).join(" ") : "—";
          return `\`#${g.id}\` **${g.prize}** ${g.status === "cancelled" ? "❌" : "✅"} — 👥 ${g.entries} — ${ts(g.ended_at || g.ends_at)}\n${winners}`;
        }).join("\n\n") || t("ui.empty"),
        color: "info"
      })],
      allowedMentions: { parse: [] }
    };
  }

  infoPayload(guild, giveaway) {
    const t = this.app.i18n.forGuild(guild.id);
    const entries = this.app.giveaways.entryCount(giveaway.id);
    const winners = [...new Set(this.app.giveaways.winners(giveaway.id).map((w) => w.user_id))];
    const base = this.app.giveawayService.buildEmbed(giveaway, { ended: giveaway.status === "ended", winners });
    const fields = [
      { name: t("gw.status"), value: `\`${giveaway.status}\``, inline: true },
      { name: t("gw.entries"), value: `\`${entries}\``, inline: true }
    ];
    if (giveaway.status === "scheduled") fields.push({ name: t("gw.startsAt"), value: `<t:${Math.floor(giveaway.starts_at / 1000)}:R>`, inline: true });
    if (giveaway.message_id) fields.push({ name: t("gw.message"), value: `https://discord.com/channels/${guild.id}/${giveaway.channel_id}/${giveaway.message_id}`, inline: false });
    base.addFields(fields);
    return { embeds: [base], allowedMentions: { parse: [] } };
  }
}

module.exports = GiveawaysPlusService;
