const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { truncate, formatDuration } = require("../../core/utils/common");

const DAY = 86_400_000;

/**
 * التوسعة الاجتماعية. كل علاقة تحترم الحظر والخصوصية:
 *  - من حظرك لا تستطيع متابعته أو مصادقته أو التعليق على ملفه أو منحه سمعة
 *  - الحظر يلغي المتابعة والصداقة القائمة بين الطرفين
 *  - الخصوصية: عام / للأصدقاء / خاص، وتحكم بالتعليقات وطلبات الصداقة والسمعة
 */
class SocialPlusService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  config(guildId) {
    return { repDailyLimit: 3, repCooldownMs: DAY, maxFriends: 200, maxCommentsPerDay: 10, ...(this.app.guildConfig.value(guildId, "socialPlus") || {}) };
  }

  /** يُستخدم في متغير {REPUTATION} ولوحة المتصدرين. */
  reputation(guildId, userId) {
    return this.repo.repCount(guildId, userId);
  }

  blockedEither(guildId, x, y) {
    return this.repo.has(guildId, x, y, "block") || this.repo.has(guildId, y, x, "block");
  }

  _basic(actor, target) {
    if (!target || target.bot) return { ok: false, reason: "invalidTarget" };
    if (actor.id === target.id) return { ok: false, reason: "self" };
    return null;
  }

  giveRep(guild, actor, target, reason = null) {
    const bad = this._basic(actor, target);
    if (bad) return bad;
    if (this.blockedEither(guild.id, actor.id, target.id)) return { ok: false, reason: "blocked" };
    if (!this.repo.privacy(guild.id, target.id).allow_reps) return { ok: false, reason: "privacy" };
    const cfg = this.config(guild.id);
    if (this.repo.repsGivenSince(guild.id, actor.id, Date.now() - DAY) >= cfg.repDailyLimit) return { ok: false, reason: "dailyLimit", max: cfg.repDailyLimit };
    const last = this.repo.lastRepTo(guild.id, actor.id, target.id);
    if (Date.now() - last < cfg.repCooldownMs) return { ok: false, reason: "cooldown", wait: cfg.repCooldownMs - (Date.now() - last) };
    this.repo.addRep(guild.id, actor.id, target.id, reason ? String(reason).slice(0, 200) : null);
    this.app.bus.emitSafe("social:reputation", { guildId: guild.id, guild, userId: target.id, giverId: actor.id });
    return { ok: true, total: this.repo.repCount(guild.id, target.id) };
  }

  toggleFollow(guild, actor, target) {
    const bad = this._basic(actor, target);
    if (bad) return bad;
    if (this.repo.unfollow(guild.id, actor.id, target.id)) return { ok: true, following: false };
    if (this.blockedEither(guild.id, actor.id, target.id)) return { ok: false, reason: "blocked" };
    this.repo.follow(guild.id, actor.id, target.id);
    return { ok: true, following: true };
  }

  async requestFriend(guild, actor, target) {
    const bad = this._basic(actor, target);
    if (bad) return bad;
    if (this.blockedEither(guild.id, actor.id, target.id)) return { ok: false, reason: "blocked" };
    const existing = this.repo.friendship(guild.id, actor.id, target.id);
    if (existing?.status === "accepted") return { ok: false, reason: "alreadyFriends" };
    // طلب معاكس معلّق = قبول مباشر
    if (existing?.status === "pending" && existing.requester_id === target.id) return this.acceptFriend(guild, actor, target);
    if (existing) return { ok: false, reason: "alreadyRequested" };
    if (!this.repo.privacy(guild.id, target.id).allow_friend_requests) return { ok: false, reason: "privacy" };
    if (this.repo.friendCount(guild.id, actor.id) >= this.config(guild.id).maxFriends) return { ok: false, reason: "maxFriends" };
    this.repo.requestFriend(guild.id, actor.id, target.id);
    const t = this.app.i18n.forGuild(guild.id);
    await this.app.notifications.notify({
      guildId: guild.id, userId: target.id, category: "social", targets: ["dm"],
      payload: {
        content: `👋 ${t("soc.friendRequestDm", { user: `<@${actor.id}>`, server: guild.name })}`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`soc:faccept:${guild.id}:${actor.id}`).setLabel(t("soc.accept")).setEmoji("✅").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`soc:fdecline:${guild.id}:${actor.id}`).setLabel(t("soc.decline")).setStyle(ButtonStyle.Secondary)
        )],
        allowedMentions: { parse: [] }
      }
    });
    return { ok: true, pending: true };
  }

  acceptFriend(guild, actor, requester) {
    if (this.blockedEither(guild.id, actor.id, requester.id)) return { ok: false, reason: "blocked" };
    if (!this.repo.acceptFriend(guild.id, actor.id, requester.id)) return { ok: false, reason: "noRequest" };
    this.app.bus.emitSafe("social:friend", { guildId: guild.id, guild, userId: actor.id, friendId: requester.id });
    return { ok: true, accepted: true };
  }

  declineFriend(guild, actor, requesterId) {
    const f = this.repo.friendship(guild.id, actor.id, requesterId);
    if (!f || f.status !== "pending" || f.requester_id !== requesterId) return { ok: false, reason: "noRequest" };
    this.repo.removeFriend(guild.id, actor.id, requesterId);
    return { ok: true };
  }

  removeFriend(guild, actor, target) {
    return this.repo.removeFriend(guild.id, actor.id, target.id) ? { ok: true } : { ok: false, reason: "notFriends" };
  }

  /** الحظر يلغي العلاقات القائمة بين الطرفين في الاتجاهين. */
  toggleBlock(guild, actor, target, kind = "block") {
    const bad = this._basic(actor, target);
    if (bad) return bad;
    const on = this.repo.toggleRelation(guild.id, actor.id, target.id, kind);
    if (on && kind === "block") {
      this.repo.unfollow(guild.id, actor.id, target.id);
      this.repo.unfollow(guild.id, target.id, actor.id);
      this.repo.removeFriend(guild.id, actor.id, target.id);
    }
    return { ok: true, on };
  }

  comment(guild, actor, target, text) {
    const bad = this._basic(actor, target);
    if (bad) return bad;
    const content = String(text || "").trim();
    if (!content) return { ok: false, reason: "empty" };
    if (this.blockedEither(guild.id, actor.id, target.id)) return { ok: false, reason: "blocked" };
    const p = this.repo.privacy(guild.id, target.id);
    if (!p.allow_comments) return { ok: false, reason: "privacy" };
    if (p.visibility !== "public" && this.repo.friendship(guild.id, actor.id, target.id)?.status !== "accepted") return { ok: false, reason: "privacy" };
    if (this.repo.commentsBySince(guild.id, actor.id, Date.now() - DAY) >= this.config(guild.id).maxCommentsPerDay) return { ok: false, reason: "dailyLimit", max: this.config(guild.id).maxCommentsPerDay };
    const id = this.repo.addComment(guild.id, target.id, actor.id, content.slice(0, 300));
    return { ok: true, id };
  }

  /** حذف تعليق: كاتبه، أو صاحب الملف، أو المشرفون. */
  deleteComment(guild, actor, id) {
    const c = this.repo.comment(id);
    if (!c || c.guild_id !== guild.id || c.deleted) return { ok: false, reason: "notFound" };
    const staff = this.app.permissions.resolveLevel(actor) >= 2;
    if (c.author_id !== actor.id && c.profile_user_id !== actor.id && !staff) return { ok: false, reason: "noPermission" };
    this.repo.deleteComment(id);
    return { ok: true };
  }

  /** هل يستطيع العارض رؤية الملف؟ */
  canView(guildId, viewer, ownerId) {
    if (viewer.id === ownerId || this.app.permissions.resolveLevel(viewer) >= 2) return true;
    if (this.repo.has(guildId, ownerId, viewer.id, "block")) return false;
    const { visibility } = this.repo.privacy(guildId, ownerId);
    if (visibility === "public") return true;
    if (visibility === "friends") return this.repo.friendship(guildId, viewer.id, ownerId)?.status === "accepted";
    return false;
  }

  /** حقول إضافية لإمبيد الملف الموجود في SocialService. */
  profileFields(guildId, userId) {
    const t = this.app.i18n.forGuild(guildId);
    const f = this.repo.followCounts(guildId, userId);
    const comments = this.repo.comments(guildId, userId, 3).map((c) => `\`#${c.id}\` <@${c.author_id}>: ${truncate(c.content, 100)}`);
    return [
      { name: `👍 ${t("soc.reputation")}`, value: `\`${this.repo.repCount(guildId, userId)}\``, inline: true },
      { name: `👥 ${t("soc.followers")}`, value: `\`${f.followers}\` / \`${f.following}\``, inline: true },
      { name: `🤝 ${t("soc.friends")}`, value: `\`${this.repo.friendCount(guildId, userId)}\``, inline: true },
      ...(comments.length ? [{ name: `💬 ${t("soc.comments")}`, value: comments.join("\n").slice(0, 1024) }] : [])
    ];
  }

  describe(res, t) {
    if (res.reason === "cooldown") return t("soc.err.cooldown", { time: formatDuration(res.wait) });
    return t(`soc.err.${res.reason}`, { max: res.max ?? "" });
  }
}

module.exports = SocialPlusService;
