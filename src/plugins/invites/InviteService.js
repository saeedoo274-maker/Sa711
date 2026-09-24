/**
 * تتبع الدعوات.
 *
 * ديسكورد لا يخبرنا بالرابط الذي دخل منه العضو، فنحتفظ بعدد استخدامات كل رابط
 * لكل سيرفر، وعند دخول عضو نجلب الروابط مجددًا ونبحث عن الرابط الذي زاد استخدامه.
 * الذاكرة محدودة: السيرفرات المفعّل فيها النظام فقط، ويُحمَّل كل سيرفر عند أول حاجة.
 */
class InviteService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    this.cache = new Map(); // guildId -> Map(code -> { uses, inviterId })
  }

  enabled(guildId) {
    return this.app.features.isEnabled(guildId, "invites");
  }

  _snapshot(invites) {
    const map = new Map();
    for (const inv of invites.values()) map.set(inv.code, { uses: inv.uses || 0, inviterId: inv.inviterId || inv.inviter?.id || null });
    return map;
  }

  async load(guild) {
    if (!guild?.invites?.fetch) return null;
    const invites = await guild.invites.fetch().catch((err) => {
      this.app.logger.debug(`تعذر جلب روابط الدعوة لـ ${guild.id}: ${err.message}`);
      return null;
    });
    if (!invites) return null;
    const snap = this._snapshot(invites);
    this.cache.set(guild.id, snap);
    return snap;
  }

  /** تحميل تدريجي عند الإقلاع حتى لا تُرسل مئات الطلبات دفعة واحدة. */
  async warmup(guilds) {
    for (const guild of guilds) {
      if (!this.enabled(guild.id)) continue;
      await this.load(guild);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  onInviteCreate(invite) {
    const snap = this.cache.get(invite.guild?.id);
    if (snap) snap.set(invite.code, { uses: invite.uses || 0, inviterId: invite.inviterId || invite.inviter?.id || null });
  }

  onInviteDelete(invite) {
    this.cache.get(invite.guild?.id)?.delete(invite.code);
  }

  async onMemberAdd(member) {
    if (member.user.bot) return null;
    const guild = member.guild;
    const before = this.cache.get(guild.id);
    const after = await this.load(guild);
    let used = null;
    if (before && after) {
      for (const [code, now] of after) {
        const prev = before.get(code);
        if (now.uses > (prev?.uses || 0)) {
          used = { code, inviterId: now.inviterId };
          break;
        }
      }
      // رابط أحادي الاستخدام يُحذف فور استعماله: موجود قبل ومختفٍ بعد
      if (!used) {
        const gone = [...before.keys()].filter((c) => !after.has(c));
        if (gone.length === 1) used = { code: gone[0], inviterId: before.get(gone[0]).inviterId };
      }
    }
    if (!used && guild.vanityURLCode) used = { code: guild.vanityURLCode, inviterId: null };
    const days = Number(this.app.guildConfig.value(guild.id, "invites.fakeAccountAgeDays") ?? 7);
    const fake = days > 0 && Date.now() - (member.user.createdTimestamp || Date.now()) < days * 86_400_000;
    this.repo.recordJoin({ guildId: guild.id, userId: member.id, inviterId: used?.inviterId === member.id ? null : used?.inviterId, code: used?.code, fake });
    if (used?.inviterId) this.app.bus.emitSafe("invite:joined", { guild, member, inviterId: used.inviterId, code: used.code, fake });
    return used;
  }

  onMemberRemove(member) {
    return this.repo.markLeft(member.guild.id, member.id);
  }

  /** عدد الدعوات الفعلية (يُستخدم في شروط السحوبات). */
  count(guildId, userId, sinceMs = 0) {
    return this.repo.stats(guildId, userId, sinceMs).real;
  }

  payload(guild, user) {
    const t = this.app.i18n.forGuild(guild.id);
    const s = this.repo.stats(guild.id, user.id);
    const by = this.repo.inviterOf(guild.id, user.id);
    const recent = this.repo.recentInvited(guild.id, user.id, 10)
      .map((r) => `<@${r.user_id}> <t:${Math.floor(r.joined_at / 1000)}:R>${r.left_at ? " 🚪" : r.fake ? " ⚠️" : ""}`);
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `📨 ${t("inv.title", { user: user.username || user.id })}`,
        color: "info",
        fields: [
          { name: t("inv.real"), value: `\`${s.real}\``, inline: true },
          { name: t("inv.left"), value: `\`${s.left}\``, inline: true },
          { name: t("inv.fake"), value: `\`${s.fake}\``, inline: true },
          { name: t("inv.invitedBy"), value: by?.inviter_id ? `<@${by.inviter_id}>` : by?.code ? `\`${by.code}\`` : "—", inline: true },
          { name: t("inv.recent"), value: recent.join("\n").slice(0, 1024) || "—" }
        ]
      })],
      allowedMentions: { parse: [] }
    };
  }
}

module.exports = InviteService;
