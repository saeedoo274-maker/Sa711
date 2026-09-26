CREATE TABLE IF NOT EXISTS appeals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  case_number  INTEGER NOT NULL,
  user_id      TEXT NOT NULL,
  type         TEXT NOT NULL,
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | rejected
  reviewer_id  TEXT,
  reviewed_at  INTEGER,
  note         TEXT,
  channel_id   TEXT,
  message_id   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appeals_case ON appeals (guild_id, case_number);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals (guild_id, status, id);
-- استئناف معلّق واحد فقط لكل قضية (يمنع التكرار حتى مع الضغط المتزامن)
CREATE UNIQUE INDEX IF NOT EXISTS idx_appeals_one_pending ON appeals (guild_id, case_number) WHERE status = 'pending';

-- @down
DROP INDEX IF EXISTS idx_appeals_one_pending;
DROP INDEX IF EXISTS idx_appeals_status;
DROP INDEX IF EXISTS idx_appeals_case;
DROP TABLE IF EXISTS appeals;
