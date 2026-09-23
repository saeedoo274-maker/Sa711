/**
 * المنشورات الاجتماعية داخل السيرفر (نمط تويتر).
 *
 * الإعجاب وإعادة النشر مبنيان على مفتاح مركّب (post_id, user_id)،
 * فمحاولة إعجاب مكرر تُرفض ذرّيًا عبر `INSERT OR IGNORE` بلا فحص منفصل.
 */
class SocialRepository {
  constructor(db) {
    this.db = db;
  }

  // ---------------- الحسابات ----------------

  createProfile({ guildId, userId, handle, displayName, bio }) {
    const info = this.db
      .prepare(
        `INSERT INTO social_profiles (guild_id, user_id, handle, display_name, bio, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(guildId, userId, handle, displayName, bio || null, Date.now());
    return this.getProfile(guildId, userId);
  }

  getProfile(guildId, userId) {
    return this.db.prepare("SELECT * FROM social_profiles WHERE guild_id = ? AND user_id = ?").get(guildId, userId) || null;
  }

  getProfileByHandle(guildId, handle) {
    return this.db.prepare("SELECT * FROM social_profiles WHERE guild_id = ? AND handle = ?").get(guildId, handle) || null;
  }

  handleTaken(guildId, handle) {
    return !!this.getProfileByHandle(guildId, handle);
  }

  updateBio(guildId, userId, bio) {
    this.db.prepare("UPDATE social_profiles SET bio = ? WHERE guild_id = ? AND user_id = ?").run(bio || null, guildId, userId);
    return this.getProfile(guildId, userId);
  }

  updateHandle(guildId, userId, handle, displayName) {
    this.db
      .prepare("UPDATE social_profiles SET handle = ?, display_name = ? WHERE guild_id = ? AND user_id = ?")
      .run(handle, displayName, guildId, userId);
    return this.getProfile(guildId, userId);
  }

  // ---------------- المنشورات ----------------

  createPost({ guildId, authorId, content, replyTo }) {
    const info = this.db
      .prepare(
        `INSERT INTO social_posts (guild_id, author_id, content, reply_to, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(guildId, authorId, content, replyTo || null, Date.now());
    return this.getPost(info.lastInsertRowid);
  }

  getPost(id) {
    return this.db.prepare("SELECT * FROM social_posts WHERE id = ? AND deleted = 0").get(id) || null;
  }

  /** يجلب المنشور حتى لو محذوفًا — للاستخدام الإداري فقط. */
  getPostRaw(id) {
    return this.db.prepare("SELECT * FROM social_posts WHERE id = ?").get(id) || null;
  }

  setMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE social_posts SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  /** حذف ذرّي: ينجح مرة واحدة فقط، فلا تُحذف نفس التغريدة مرتين بلا داعٍ. */
  deletePost(id, guildId) {
    return this.db.prepare("UPDATE social_posts SET deleted = 1 WHERE id = ? AND guild_id = ? AND deleted = 0").run(id, guildId).changes === 1;
  }

  feed(guildId, { limit = 20, before = null } = {}) {
    // نرتّب بـ id لا created_at: منشوران قد يُنشآن بنفس المللي ثانية،
    // بينما id متسلسل ومضمون عدم التعادل (نفس درس listCategories في التقديمات).
    const sql = before
      ? "SELECT * FROM social_posts WHERE guild_id = ? AND deleted = 0 AND id < ? ORDER BY id DESC LIMIT ?"
      : "SELECT * FROM social_posts WHERE guild_id = ? AND deleted = 0 ORDER BY id DESC LIMIT ?";
    return before
      ? this.db.prepare(sql).all(guildId, before, limit)
      : this.db.prepare(sql).all(guildId, limit);
  }

  byAuthor(guildId, authorId, limit = 15) {
    return this.db
      .prepare("SELECT * FROM social_posts WHERE guild_id = ? AND author_id = ? AND deleted = 0 ORDER BY id DESC LIMIT ?")
      .all(guildId, authorId, limit);
  }

  replies(postId, limit = 20) {
    return this.db
      .prepare("SELECT * FROM social_posts WHERE reply_to = ? AND deleted = 0 ORDER BY id ASC LIMIT ?")
      .all(postId, limit);
  }

  // ---------------- التفاعلات ----------------

  /** إعجاب/إلغاء إعجاب بالتبديل. يُرجع true إذا أُضيف الإعجاب. */
  toggleLike(postId, userId) {
    const existing = this.db.prepare("SELECT 1 FROM social_likes WHERE post_id = ? AND user_id = ?").get(postId, userId);
    if (existing) {
      this.db.prepare("DELETE FROM social_likes WHERE post_id = ? AND user_id = ?").run(postId, userId);
      return false;
    }
    this.db.prepare("INSERT INTO social_likes (post_id, user_id, created_at) VALUES (?, ?, ?)").run(postId, userId, Date.now());
    return true;
  }

  hasLiked(postId, userId) {
    return !!this.db.prepare("SELECT 1 FROM social_likes WHERE post_id = ? AND user_id = ?").get(postId, userId);
  }

  likeCount(postId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM social_likes WHERE post_id = ?").get(postId).c;
  }

  /** إعادة نشر: ذرّي عبر INSERT OR IGNORE، فمحاولة إعادة النشر مرتين لا تفشل بخطأ بل تُتجاهل بصمت. */
  repost(postId, userId) {
    const res = this.db
      .prepare("INSERT OR IGNORE INTO social_reposts (post_id, user_id, created_at) VALUES (?, ?, ?)")
      .run(postId, userId, Date.now());
    return res.changes === 1;
  }

  hasReposted(postId, userId) {
    return !!this.db.prepare("SELECT 1 FROM social_reposts WHERE post_id = ? AND user_id = ?").get(postId, userId);
  }

  repostCount(postId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM social_reposts WHERE post_id = ?").get(postId).c;
  }

  replyCount(postId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM social_posts WHERE reply_to = ? AND deleted = 0").get(postId).c;
  }

  // ---------------- الصدارة ----------------

  /** أكثر الأعضاء نشاطًا حسب عدد المنشورات أو مجموع الإعجابات المستلمة. */
  topByPosts(guildId, limit = 10) {
    return this.db
      .prepare(
        `SELECT author_id, COUNT(*) AS count FROM social_posts
         WHERE guild_id = ? AND deleted = 0 GROUP BY author_id ORDER BY count DESC LIMIT ?`
      )
      .all(guildId, limit);
  }

  topByLikes(guildId, limit = 10) {
    return this.db
      .prepare(
        `SELECT p.author_id AS author_id, COUNT(l.user_id) AS count
         FROM social_posts p LEFT JOIN social_likes l ON l.post_id = p.id
         WHERE p.guild_id = ? AND p.deleted = 0
         GROUP BY p.author_id ORDER BY count DESC LIMIT ?`
      )
      .all(guildId, limit);
  }

  // ---------------- الإبلاغ ----------------

  createReport({ guildId, postId, reporterId, reason }) {
    const info = this.db
      .prepare("INSERT INTO social_reports (guild_id, post_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(guildId, postId, reporterId, reason || null, Date.now());
    return this.db.prepare("SELECT * FROM social_reports WHERE id = ?").get(info.lastInsertRowid);
  }

  hasReported(postId, reporterId) {
    return !!this.db.prepare("SELECT 1 FROM social_reports WHERE post_id = ? AND reporter_id = ?").get(postId, reporterId);
  }
}

module.exports = SocialRepository;
