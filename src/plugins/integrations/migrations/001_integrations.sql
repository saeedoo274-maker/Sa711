CREATE TABLE IF NOT EXISTS integration_subs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT NOT NULL,
  provider         TEXT NOT NULL,
  source           TEXT NOT NULL,          -- رابط/معرّف/عنوان حسب المزوّد
  options          TEXT NOT NULL DEFAULT '{}',
  channel_id       TEXT,
  mention_role_id  TEXT,
  template         TEXT,
  interval_ms      INTEGER NOT NULL DEFAULT 600000,
  state            TEXT NOT NULL DEFAULT '{}', -- آخر العناصر المرئية / آخر حالة
  enabled          INTEGER NOT NULL DEFAULT 1,
  fail_count       INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  last_checked_at  INTEGER,
  next_check_at    INTEGER NOT NULL,
  created_by       TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integration_due ON integration_subs (enabled, next_check_at);
CREATE INDEX IF NOT EXISTS idx_integration_guild ON integration_subs (guild_id);

-- @down
DROP INDEX IF EXISTS idx_integration_guild;
DROP INDEX IF EXISTS idx_integration_due;
DROP TABLE IF EXISTS integration_subs;
