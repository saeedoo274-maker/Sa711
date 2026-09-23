const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildEmbed, timestamp, truncate } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");

/**
 * المنشورات الاجتماعية (نمط تويتر) — نطاقها مقصود أن يبقى بسيطًا:
 * نص + إعجاب + إعادة نشر + رد، بلا خوارزميات ترشيح أو أرباح وهمية،
 * لأن هذا امتداد ترفيهي لسيرفر إدارة لا منصة اجتماعية مستقلة.
 *
 * كل منشور يُنشر كرسالة حقيقية في قناة الخلاصة، فيبقى قابلاً للأرشفة
 * والبحث بأدوات ديسكورد العادية، والتفاعلات أزرار حقيقية لا محاكاة.
 */
class SocialService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "social") || {};
  }

  enabled(guildId) {
    const cfg = this.config(guildId);
    return !!cfg.enabled && !!cfg.feedChannelId;
  }

  // ---------------- الحسابات ----------------

  /** يتحقق من صيغة المعرّف: أحرف/أرقام/شرطة سفلية، 3-20 حرفًا، بلا @ في البداية. */
  validHandle(handle) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(handle);
  }

  ensureProfile(guildId, userId, displayName) {
    let profile = this.app.social.getProfile(guildId, userId);
    if (profile) return profile;
    // معرّف مبدئي فريد من آيدي العضو، يقدر يغيّره لاحقًا لو أراد اسمًا مخصصًا
    let handle = `user${userId.slice(-6)}`;
    let suffix = 0;
    while (this.app.social.handleTaken(guildId, handle)) {
      suffix++;
      handle = `user${userId.slice(-6)}${suffix}`;
    }
    return this.app.social.createProfile({ guildId, userId, handle, displayName: displayName || handle });
  }

  // ---------------- بناء بطاقة المنشور ----------------

  postPayload(post, { author, replyToAuthorHandle } = {}) {
    const profile = author || this.app.social.getProfile(post.guild_id, post.author_id);
    const handle = profile?.handle || post.author_id;
    const displayName = profile?.display_name || handle;

    const likes = this.app.social.likeCount(post.id);
    const reposts = this.app.social.repostCount(post.id);
    const replies = this.app.social.replyCount(post.id);

    const text =
      (replyToAuthorHandle ? `↩️ ردًا على @${replyToAuthorHandle}\n\n` : "") +
      `**${displayName}** — @${handle}\n\n` +
      `${truncate(post.content, 2000)}\n\n` +
      `-# ${timestamp(post.created_at, "R")} • ❤️ ${likes} • 🔁 ${reposts} • 💬 ${replies}`;

    const rows = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`social:like:${post.id}`).setLabel(`${likes}`).setEmoji("❤️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`social:repost:${post.id}`).setLabel(`${reposts}`).setEmoji("🔁").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`social:reply:${post.id}`).setLabel("رد").setEmoji("💬").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`social:report:${post.id}`).setLabel("إبلاغ").setEmoji("🚩").setStyle(ButtonStyle.Danger)
      )
    ];

    return containerPayload({ text, color: 0x1D9BF0, rows });
  }

  /** يحدّث بطاقة المنشور المنشورة بعد أي تفاعل (إعجاب/إعادة نشر). */
  async refreshPost(post) {
    if (!post.channel_id || !post.message_id) return;
    const channel = await this.app.client.channels.fetch(post.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(post.message_id).catch(() => null);
    if (!message) return;

    const payload = this.postPayload(post);
    await message.edit({ flags: payload.flags, components: payload.components }).catch(() => {});
  }

  // ---------------- النشر ----------------

  async publish({ guild, author, content, replyTo = null }) {
    const post = this.app.social.createPost({ guildId: guild.id, authorId: author.id, content, replyTo });

    const cfg = this.config(guild.id);
    if (!cfg.feedChannelId) return { ok: true, post, posted: false };

    const channel = await this.app.client.channels.fetch(cfg.feedChannelId).catch(() => null);
    if (!channel?.isTextBased()) return { ok: true, post, posted: false };

    let replyToHandle = null;
    if (replyTo) {
      const original = this.app.social.getPostRaw(replyTo);
      if (original) replyToHandle = this.app.social.getProfile(guild.id, original.author_id)?.handle;
    }

    const payload = this.postPayload(post, { replyToAuthorHandle: replyToHandle });
    const message = await channel.send(payload).catch(() => null);
    if (message) this.app.social.setMessage(post.id, channel.id, message.id);

    return { ok: true, post, posted: !!message };
  }

  // ---------------- العرض ----------------

  profileEmbed(guild, profile, user) {
    const posts = this.app.social.byAuthor(guild.id, profile.user_id, 1000).length;
    return buildEmbed({
      title: `@${profile.handle}`,
      description: `**${profile.display_name}**${profile.bio ? `\n${truncate(profile.bio, 300)}` : ""}`,
      color: this.app.config.color("primary"),
      thumbnail: user?.displayAvatarURL?.() || undefined,
      fields: [
        { name: "المنشورات", value: `\`${posts}\``, inline: true },
        { name: "عضو منذ", value: timestamp(profile.created_at, "R"), inline: true }
      ]
    });
  }

  feedEmbed(guild, posts) {
    if (!posts.length) {
      return buildEmbed({ description: "لا توجد منشورات بعد.", color: this.app.config.color("neutral") });
    }
    return buildEmbed({
      title: "🐦 آخر المنشورات",
      description: posts
        .map((p) => {
          const profile = this.app.social.getProfile(guild.id, p.author_id);
          return `**@${profile?.handle || p.author_id}**: ${truncate(p.content, 150)}\n-# ${timestamp(p.created_at, "R")}`;
        })
        .join("\n\n"),
      color: this.app.config.color("primary")
    });
  }

  leaderboardEmbed(guild, rows, { byLikes = false } = {}) {
    if (!rows.length) {
      return buildEmbed({ description: "لا توجد بيانات كافية بعد.", color: this.app.config.color("neutral") });
    }
    return buildEmbed({
      title: byLikes ? "🏆 الأكثر إعجابًا" : "🏆 الأكثر نشاطًا",
      description: rows
        .map((r, i) => {
          const profile = this.app.social.getProfile(guild.id, r.author_id);
          return `**${i + 1}.** @${profile?.handle || r.author_id} — \`${r.count}\` ${byLikes ? "إعجاب" : "منشور"}`;
        })
        .join("\n"),
      color: this.app.config.color("primary")
    });
  }
}

module.exports = SocialService;
