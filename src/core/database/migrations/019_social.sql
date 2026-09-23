-- ============================================================
--  المنشورات الاجتماعية (نمط تويتر داخل السيرفر)
--  حساب اختياري لكل عضو باسم عرض ومعرّف فريد، ومنشورات نصية
--  بتفاعلات إعجاب وإعادة نشر وردود، ونظام إبلاغ يصل للإدارة.
-- ============================================================

CREATE TABLE IF NOT EXISTS social_profiles (
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  handle        TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  bio           TEXT,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id),
  UNIQUE (guild_id, handle)
);

CREATE TABLE IF NOT EXISTS social_posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  content       TEXT NOT NULL,
  reply_to      INTEGER,
  channel_id    TEXT,
  message_id    TEXT,
  deleted       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_posts_author ON social_posts (guild_id, author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_reply ON social_posts (reply_to);
CREATE INDEX IF NOT EXISTS idx_social_posts_feed ON social_posts (guild_id, deleted, created_at DESC);

CREATE TABLE IF NOT EXISTS social_likes (
  post_id     INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_social_likes_post ON social_likes (post_id);

CREATE TABLE IF NOT EXISTS social_reposts (
  post_id     INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_social_reposts_post ON social_reposts (post_id);

-- تقارير إساءة على منشور، تصل قناة مراجعة الإدارة
CREATE TABLE IF NOT EXISTS social_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  post_id      INTEGER NOT NULL,
  reporter_id  TEXT NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_reports_post ON social_reports (post_id);
