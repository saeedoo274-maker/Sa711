-- جلسات الألعاب التفاعلية: الرهان محجوز حتى تنتهي الجلسة. أي جلسة نشطة عند
-- الإقلاع (توقف البوت أثناء اللعب) يُعاد رهانها لأصحابها تلقائيًا.
CREATE TABLE IF NOT EXISTS game_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT,
  host_id     TEXT NOT NULL,
  game        TEXT NOT NULL,
  bet         INTEGER NOT NULL DEFAULT 0,
  players     TEXT NOT NULL DEFAULT '[]',
  state       TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'active', -- active | finished | refunded | cancelled
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_active ON game_sessions (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_game_sessions_host ON game_sessions (guild_id, host_id, status);

CREATE TABLE IF NOT EXISTS game_stats (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  game       TEXT NOT NULL,
  played     INTEGER NOT NULL DEFAULT 0,
  won        INTEGER NOT NULL DEFAULT 0,
  lost       INTEGER NOT NULL DEFAULT 0,
  draw       INTEGER NOT NULL DEFAULT 0,
  wagered    INTEGER NOT NULL DEFAULT 0,
  profit     INTEGER NOT NULL DEFAULT 0,
  best_win   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, game)
);
CREATE INDEX IF NOT EXISTS idx_game_stats_profit ON game_stats (guild_id, profit DESC);

-- @down
DROP TABLE IF EXISTS game_stats;
DROP TABLE IF EXISTS game_sessions;
