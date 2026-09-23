-- ============================================================
--  الردود التلقائية و Starboard
-- ============================================================

CREATE TABLE IF NOT EXISTS auto_replies (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  triggers          TEXT NOT NULL DEFAULT '[]',
  match_type        TEXT NOT NULL DEFAULT 'contains',
  reply_text        TEXT,
  embed_id          TEXT,
  reply_to          INTEGER NOT NULL DEFAULT 1,
  delete_trigger    INTEGER NOT NULL DEFAULT 0,
  channels          TEXT NOT NULL DEFAULT '[]',
  ignored_channels  TEXT NOT NULL DEFAULT '[]',
  role_ids          TEXT NOT NULL DEFAULT '[]',
  cooldown_ms       INTEGER NOT NULL DEFAULT 0,
  chance            INTEGER NOT NULL DEFAULT 100,
  enabled           INTEGER NOT NULL DEFAULT 1,
  uses              INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT,
  created_at        INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);
CREATE INDEX IF NOT EXISTS idx_autoreply_guild ON auto_replies (guild_id, enabled);

CREATE TABLE IF NOT EXISTS starboard_entries (
  guild_id           TEXT NOT NULL,
  source_message_id  TEXT NOT NULL,
  source_channel_id  TEXT NOT NULL,
  board_message_id   TEXT,
  author_id          TEXT,
  stars              INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (guild_id, source_message_id)
);
CREATE INDEX IF NOT EXISTS idx_starboard_guild ON starboard_entries (guild_id, stars DESC);
