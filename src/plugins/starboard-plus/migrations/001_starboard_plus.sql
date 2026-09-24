-- لوحات إضافية بجانب اللوحة الأصلية (المحفوظة في إعدادات السيرفر كما هي)
CREATE TABLE IF NOT EXISTS starboard_boards (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  channel_id        TEXT NOT NULL,
  emoji             TEXT NOT NULL DEFAULT '⭐',
  threshold         INTEGER NOT NULL DEFAULT 3,
  self_star         INTEGER NOT NULL DEFAULT 0,
  allow_bots        INTEGER NOT NULL DEFAULT 0,
  ignored_channels  TEXT NOT NULL DEFAULT '[]',
  ignored_roles     TEXT NOT NULL DEFAULT '[]',
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);

CREATE TABLE IF NOT EXISTS starboard_board_entries (
  board_id           INTEGER NOT NULL,
  guild_id           TEXT NOT NULL,
  source_message_id  TEXT NOT NULL,
  source_channel_id  TEXT NOT NULL,
  board_message_id   TEXT,
  author_id          TEXT,
  stars              INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (board_id, source_message_id)
);
CREATE INDEX IF NOT EXISTS idx_sb_entries_guild ON starboard_board_entries (guild_id, stars DESC);

-- صوت واحد لكل عضو على كل رسالة في كل لوحة
CREATE TABLE IF NOT EXISTS starboard_votes (
  board_id    INTEGER NOT NULL,
  message_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (board_id, message_id, user_id)
);

-- @down
DROP TABLE IF EXISTS starboard_votes;
DROP TABLE IF EXISTS starboard_board_entries;
DROP TABLE IF EXISTS starboard_boards;
