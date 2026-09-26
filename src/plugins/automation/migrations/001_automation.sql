CREATE TABLE IF NOT EXISTS automations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  name         TEXT NOT NULL,
  trigger      TEXT NOT NULL,             -- JSON { type, value }
  conditions   TEXT NOT NULL DEFAULT '[]',
  actions      TEXT NOT NULL DEFAULT '[]',
  enabled      INTEGER NOT NULL DEFAULT 1,
  cooldown_ms  INTEGER NOT NULL DEFAULT 0,
  runs         INTEGER NOT NULL DEFAULT 0,
  last_run_at  INTEGER,
  last_error   TEXT,
  created_by   TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);
CREATE INDEX IF NOT EXISTS idx_automations_guild ON automations (guild_id, enabled);

-- @down
DROP INDEX IF EXISTS idx_automations_guild;
DROP TABLE IF EXISTS automations;
