-- ============================================================
--  رد التفاعلات، المنشورات المميزة، سجل الإصدارات، Webhook GitHub
-- ============================================================

CREATE TABLE IF NOT EXISTS reaction_replies (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  emoji             TEXT NOT NULL,
  reply_text        TEXT,
  embed_id          TEXT,
  role_id           TEXT,
  channels          TEXT NOT NULL DEFAULT '[]',
  dm                INTEGER NOT NULL DEFAULT 0,
  enabled           INTEGER NOT NULL DEFAULT 1,
  uses              INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);
CREATE INDEX IF NOT EXISTS idx_reactionreply_guild ON reaction_replies (guild_id, enabled);

CREATE TABLE IF NOT EXISTS featured_posts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT NOT NULL,
  source_channel   TEXT NOT NULL,
  source_message   TEXT NOT NULL,
  featured_channel TEXT,
  featured_message TEXT,
  author_id        TEXT,
  reason           TEXT,
  featured_by      TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE (guild_id, source_message)
);
CREATE INDEX IF NOT EXISTS idx_featured_guild ON featured_posts (guild_id, created_at DESC);

-- سجل الإصدارات الذي يبثّه المطور لكل السيرفرات
CREATE TABLE IF NOT EXISTS changelogs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  version      TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  published_by TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS changelog_broadcasts (
  guild_id       TEXT NOT NULL,
  channel_id     TEXT,
  enabled        INTEGER NOT NULL DEFAULT 0,
  last_sent_id   INTEGER,
  PRIMARY KEY (guild_id)
);

-- Webhook GitHub لكل سيرفر
CREATE TABLE IF NOT EXISTS github_webhooks (
  guild_id     TEXT PRIMARY KEY,
  channel_id   TEXT NOT NULL,
  secret       TEXT NOT NULL,
  repo_filter  TEXT,
  events       TEXT NOT NULL DEFAULT '["push","pull_request","issues","release"]',
  created_by   TEXT,
  created_at   INTEGER NOT NULL
);
