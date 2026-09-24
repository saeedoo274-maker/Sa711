-- حالة الغياب: صف واحد لكل عضو في كل سيرفر
CREATE TABLE IF NOT EXISTS afk_status (
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  reason          TEXT,
  since           INTEGER NOT NULL,
  expires_at      INTEGER,
  mentions        INTEGER NOT NULL DEFAULT 0,
  original_nick   TEXT,
  nick_changed    INTEGER NOT NULL DEFAULT 0,
  last_active_at  INTEGER,
  PRIMARY KEY (guild_id, user_id)
);

-- من منشن العضو أثناء غيابه (آخر 25 فقط لكل عضو)
CREATE TABLE IF NOT EXISTS afk_mentions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  excerpt     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_afk_mentions ON afk_mentions (guild_id, user_id, id DESC);

-- @down
DROP TABLE IF EXISTS afk_mentions;
DROP TABLE IF EXISTS afk_status;
