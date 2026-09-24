CREATE TABLE IF NOT EXISTS reminders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  target          TEXT NOT NULL DEFAULT 'dm' CHECK (target IN ('dm', 'channel')),
  channel_id      TEXT,
  mention_role_id TEXT,
  staff           INTEGER NOT NULL DEFAULT 0,
  content         TEXT NOT NULL,
  run_at          INTEGER NOT NULL,
  repeat          TEXT,
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  active          INTEGER NOT NULL DEFAULT 1,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  last_sent_at    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders (guild_id, user_id, active);
CREATE INDEX IF NOT EXISTS idx_reminders_staff ON reminders (guild_id, staff, active);

-- @down
DROP TABLE IF EXISTS reminders;
