CREATE TABLE IF NOT EXISTS verification_log (
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  verified_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_verification_time ON verification_log (guild_id, verified_at);

-- @down
DROP TABLE IF EXISTS verification_log;
