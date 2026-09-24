-- من دعا من: صف لكل دخول. left_at يُملأ عند المغادرة فلا تُحسب الدعوة.
CREATE TABLE IF NOT EXISTS invite_joins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  inviter_id  TEXT,
  code        TEXT,
  fake        INTEGER NOT NULL DEFAULT 0,
  joined_at   INTEGER NOT NULL,
  left_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invite_joins_inviter ON invite_joins (guild_id, inviter_id, left_at);
CREATE INDEX IF NOT EXISTS idx_invite_joins_user ON invite_joins (guild_id, user_id, id);

-- @down
DROP TABLE IF EXISTS invite_joins;
