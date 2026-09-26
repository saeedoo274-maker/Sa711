CREATE TABLE IF NOT EXISTS social_reputation (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  giver_id     TEXT NOT NULL,
  receiver_id  TEXT NOT NULL,
  reason       TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_rep_receiver ON social_reputation (guild_id, receiver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_social_rep_giver ON social_reputation (guild_id, giver_id, created_at);

CREATE TABLE IF NOT EXISTS social_follows (
  guild_id     TEXT NOT NULL,
  follower_id  TEXT NOT NULL,
  followee_id  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_social_follows_followee ON social_follows (guild_id, followee_id);

-- a < b دائمًا؛ requester_id يحدد من أرسل الطلب
CREATE TABLE IF NOT EXISTS social_friends (
  guild_id      TEXT NOT NULL,
  a             TEXT NOT NULL,
  b             TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  requester_id  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (guild_id, a, b)
);

CREATE TABLE IF NOT EXISTS social_blocks (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,   -- block | mute
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, target_id, kind)
);

CREATE TABLE IF NOT EXISTS social_comments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT NOT NULL,
  profile_user_id  TEXT NOT NULL,
  author_id        TEXT NOT NULL,
  content          TEXT NOT NULL,
  deleted          INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_comments_profile ON social_comments (guild_id, profile_user_id, deleted, id DESC);
CREATE INDEX IF NOT EXISTS idx_social_comments_author ON social_comments (guild_id, author_id, created_at);

CREATE TABLE IF NOT EXISTS social_privacy (
  guild_id               TEXT NOT NULL,
  user_id                TEXT NOT NULL,
  visibility             TEXT NOT NULL DEFAULT 'public',  -- public | friends | private
  allow_comments         INTEGER NOT NULL DEFAULT 1,
  allow_friend_requests  INTEGER NOT NULL DEFAULT 1,
  allow_reps             INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id, user_id)
);

-- @down
DROP TABLE IF EXISTS social_privacy;
DROP TABLE IF EXISTS social_comments;
DROP TABLE IF EXISTS social_blocks;
DROP TABLE IF EXISTS social_friends;
DROP TABLE IF EXISTS social_follows;
DROP TABLE IF EXISTS social_reputation;
