-- الإعلانات: مسودات (بانتظار التأكيد)، مجدولة، مرسلة، قوالب
CREATE TABLE IF NOT EXISTS announcements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT NOT NULL,
  status           TEXT NOT NULL,            -- draft | scheduled | sending | sent | cancelled | failed | template
  name             TEXT,                     -- اسم القالب
  target           TEXT NOT NULL DEFAULT 'channel',  -- channel | dm
  channel_id       TEXT,
  dm_role_id       TEXT,
  spec             TEXT NOT NULL,            -- JSON: نص، عنوان، صورة، لون، إمبيد، أزرار، منشن
  run_at           INTEGER,
  repeat           TEXT,                     -- JSON لـ nextOccurrence أو NULL
  created_by       TEXT,
  created_at       INTEGER NOT NULL,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  last_sent_at     INTEGER,
  last_message_id  TEXT,
  last_result      TEXT
);
CREATE INDEX IF NOT EXISTS idx_announcements_guild ON announcements (guild_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_announcements_template ON announcements (guild_id, name) WHERE status = 'template';

-- @down
DROP INDEX IF EXISTS idx_announcements_template;
DROP INDEX IF EXISTS idx_announcements_guild;
DROP TABLE IF EXISTS announcements;
