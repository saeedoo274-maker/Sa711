CREATE TABLE IF NOT EXISTS guild_backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'manual',   -- manual | scheduled | imported
  data        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  summary     TEXT,
  created_by  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guild_backups ON guild_backups (guild_id, id DESC);

-- @down
DROP INDEX IF EXISTS idx_guild_backups;
DROP TABLE IF EXISTS guild_backups;
