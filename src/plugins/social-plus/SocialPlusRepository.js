const pair = (x, y) => (x < y ? [x, y] : [y, x]);

class SocialPlusRepository {
  constructor(db) {
    this.db = db;
  }

  // ---------- السمعة ----------
  addRep(guildId, giverId, receiverId, reason) {
    this.db.prepare("INSERT INTO social_reputation (guild_id, giver_id, receiver_id, reason, created_at) VALUES (?, ?, ?, ?, ?)").run(guildId, giverId, receiverId, reason, Date.now());
  }

  repCount(guildId, userId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM social_reputation WHERE guild_id = ? AND receiver_id = ?").get(guildId, userId).c;
  }

  repsGivenSince(guildId, giverId, since) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM social_reputation WHERE guild_id = ? AND giver_id = ? AND created_at >= ?").get(guildId, giverId, since).c;
  }

  lastRepTo(guildId, giverId, receiverId) {
    return this.db.prepare("SELECT MAX(created_at) AS t FROM social_reputation WHERE guild_id = ? AND giver_id = ? AND receiver_id = ?").get(guildId, giverId, receiverId).t || 0;
  }

  recentReps(guildId, userId, limit = 5) {
    return this.db.prepare("SELECT giver_id, reason, created_at FROM social_reputation WHERE guild_id = ? AND receiver_id = ? ORDER BY id DESC LIMIT ?").all(guildId, userId, limit);
  }

  // ---------- المتابعة ----------
  follow(guildId, follower, followee) {
    return this.db.prepare("INSERT OR IGNORE INTO social_follows (guild_id, follower_id, followee_id, created_at) VALUES (?, ?, ?, ?)").run(guildId, follower, followee, Date.now()).changes === 1;
  }

  unfollow(guildId, follower, followee) {
    return this.db.prepare("DELETE FROM social_follows WHERE guild_id = ? AND follower_id = ? AND followee_id = ?").run(guildId, follower, followee).changes === 1;
  }

  followCounts(guildId, userId) {
    return {
      followers: this.db.prepare("SELECT COUNT(*) AS c FROM social_follows WHERE guild_id = ? AND followee_id = ?").get(guildId, userId).c,
      following: this.db.prepare("SELECT COUNT(*) AS c FROM social_follows WHERE guild_id = ? AND follower_id = ?").get(guildId, userId).c
    };
  }

  followers(guildId, userId, limit = 500) {
    return this.db.prepare("SELECT follower_id FROM social_follows WHERE guild_id = ? AND followee_id = ? LIMIT ?").all(guildId, userId, limit).map((r) => r.follower_id);
  }

  // ---------- الصداقات ----------
  friendship(guildId, x, y) {
    const [a, b] = pair(x, y);
    return this.db.prepare("SELECT * FROM social_friends WHERE guild_id = ? AND a = ? AND b = ?").get(guildId, a, b) || null;
  }

  requestFriend(guildId, from, to) {
    const [a, b] = pair(from, to);
    return this.db.prepare("INSERT OR IGNORE INTO social_friends (guild_id, a, b, status, requester_id, created_at) VALUES (?, ?, ?, 'pending', ?, ?)").run(guildId, a, b, from, Date.now()).changes === 1;
  }

  /** القبول ذرّي، ومن الطرف المستقبِل فقط. */
  acceptFriend(guildId, accepter, requester) {
    const [a, b] = pair(accepter, requester);
    return this.db.prepare("UPDATE social_friends SET status = 'accepted' WHERE guild_id = ? AND a = ? AND b = ? AND status = 'pending' AND requester_id = ?").run(guildId, a, b, requester).changes === 1;
  }

  removeFriend(guildId, x, y) {
    const [a, b] = pair(x, y);
    return this.db.prepare("DELETE FROM social_friends WHERE guild_id = ? AND a = ? AND b = ?").run(guildId, a, b).changes === 1;
  }

  friends(guildId, userId, limit = 50) {
    return this.db
      .prepare("SELECT CASE WHEN a = ? THEN b ELSE a END AS friend FROM social_friends WHERE guild_id = ? AND (a = ? OR b = ?) AND status = 'accepted' LIMIT ?")
      .all(userId, guildId, userId, userId, limit).map((r) => r.friend);
  }

  friendCount(guildId, userId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM social_friends WHERE guild_id = ? AND (a = ? OR b = ?) AND status = 'accepted'").get(guildId, userId, userId).c;
  }

  incomingRequests(guildId, userId, limit = 25) {
    return this.db
      .prepare("SELECT requester_id, created_at FROM social_friends WHERE guild_id = ? AND (a = ? OR b = ?) AND status = 'pending' AND requester_id != ? ORDER BY created_at DESC LIMIT ?")
      .all(guildId, userId, userId, userId, limit);
  }

  // ---------- الحظر والكتم ----------
  toggleRelation(guildId, userId, targetId, kind) {
    const removed = this.db.prepare("DELETE FROM social_blocks WHERE guild_id = ? AND user_id = ? AND target_id = ? AND kind = ?").run(guildId, userId, targetId, kind).changes === 1;
    if (removed) return false;
    this.db.prepare("INSERT INTO social_blocks (guild_id, user_id, target_id, kind, created_at) VALUES (?, ?, ?, ?, ?)").run(guildId, userId, targetId, kind, Date.now());
    return true;
  }

  has(guildId, userId, targetId, kind) {
    return !!this.db.prepare("SELECT 1 FROM social_blocks WHERE guild_id = ? AND user_id = ? AND target_id = ? AND kind = ?").get(guildId, userId, targetId, kind);
  }

  // ---------- التعليقات ----------
  addComment(guildId, profileUserId, authorId, content) {
    return this.db.prepare("INSERT INTO social_comments (guild_id, profile_user_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)").run(guildId, profileUserId, authorId, content, Date.now()).lastInsertRowid;
  }

  comment(id) {
    return this.db.prepare("SELECT * FROM social_comments WHERE id = ?").get(id) || null;
  }

  deleteComment(id) {
    return this.db.prepare("UPDATE social_comments SET deleted = 1 WHERE id = ? AND deleted = 0").run(id).changes === 1;
  }

  comments(guildId, profileUserId, limit = 5) {
    return this.db.prepare("SELECT * FROM social_comments WHERE guild_id = ? AND profile_user_id = ? AND deleted = 0 ORDER BY id DESC LIMIT ?").all(guildId, profileUserId, limit);
  }

  commentsBySince(guildId, authorId, since) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM social_comments WHERE guild_id = ? AND author_id = ? AND created_at >= ?").get(guildId, authorId, since).c;
  }

  // ---------- الخصوصية ----------
  privacy(guildId, userId) {
    return this.db.prepare("SELECT * FROM social_privacy WHERE guild_id = ? AND user_id = ?").get(guildId, userId) || { visibility: "public", allow_comments: 1, allow_friend_requests: 1, allow_reps: 1 };
  }

  setPrivacy(guildId, userId, fields) {
    const current = this.privacy(guildId, userId);
    const next = { ...current, ...fields };
    this.db.prepare(
      `INSERT INTO social_privacy (guild_id, user_id, visibility, allow_comments, allow_friend_requests, allow_reps) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET visibility = excluded.visibility, allow_comments = excluded.allow_comments,
         allow_friend_requests = excluded.allow_friend_requests, allow_reps = excluded.allow_reps`
    ).run(guildId, userId, next.visibility, next.allow_comments ? 1 : 0, next.allow_friend_requests ? 1 : 0, next.allow_reps ? 1 : 0);
    return this.privacy(guildId, userId);
  }
}

module.exports = SocialPlusRepository;
