CREATE TABLE IF NOT EXISTS staff_departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  role_id     TEXT,
  lead_id     TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);

-- كل إداري في قسم واحد على الأكثر
CREATE TABLE IF NOT EXISTS staff_department_members (
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  department_id  INTEGER NOT NULL,
  joined_at      INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_dept_members ON staff_department_members (department_id);

CREATE TABLE IF NOT EXISTS staff_shifts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id          TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',   -- active | break | ended
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER,
  break_ms          INTEGER NOT NULL DEFAULT 0,
  break_started_at  INTEGER,
  ended_by          TEXT
);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_user ON staff_shifts (guild_id, user_id, started_at DESC);
-- مناوبة مفتوحة واحدة فقط لكل إداري
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_shifts_open ON staff_shifts (guild_id, user_id) WHERE status != 'ended';

CREATE TABLE IF NOT EXISTS staff_rank_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  actor_id    TEXT,
  direction   TEXT NOT NULL,     -- promote | demote
  details     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_rank_history ON staff_rank_history (guild_id, user_id, id DESC);

CREATE TABLE IF NOT EXISTS staff_evaluations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  evaluator_id  TEXT NOT NULL,
  score         INTEGER NOT NULL,
  notes         TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_evaluations ON staff_evaluations (guild_id, user_id, created_at DESC);

-- @down
DROP TABLE IF EXISTS staff_evaluations;
DROP TABLE IF EXISTS staff_rank_history;
DROP INDEX IF EXISTS idx_staff_shifts_open;
DROP TABLE IF EXISTS staff_shifts;
DROP TABLE IF EXISTS staff_department_members;
DROP TABLE IF EXISTS staff_departments;
