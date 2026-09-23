-- ============================================================
--  دورة حياة الطاقم: الإجازات، الاستقالات، البلاغات على الإداريين
--  مأخوذة مفهوميًا من نظام c2 وأُعيدت كتابتها بعزل كامل لكل سيرفر
-- ============================================================

CREATE TABLE IF NOT EXISTS lifecycle_counters (
  guild_id     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  last_number  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, kind)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  number       INTEGER NOT NULL,
  user_id      TEXT NOT NULL,
  reason       TEXT,
  duration_ms  INTEGER,
  ends_at      INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending',
  reviewer_id  TEXT,
  reviewed_at  INTEGER,
  note         TEXT,
  saved_roles  TEXT NOT NULL DEFAULT '[]',
  channel_id   TEXT,
  message_id   TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests (guild_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_due  ON leave_requests (status, ends_at);

CREATE TABLE IF NOT EXISTS resignations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  number       INTEGER NOT NULL,
  user_id      TEXT NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  reviewer_id  TEXT,
  reviewed_at  INTEGER,
  note         TEXT,
  saved_roles  TEXT NOT NULL DEFAULT '[]',
  channel_id   TEXT,
  message_id   TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_resign_user ON resignations (guild_id, user_id, status);

CREATE TABLE IF NOT EXISTS admin_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  number         INTEGER NOT NULL,
  reporter_id    TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  reason         TEXT NOT NULL,
  incident_at    TEXT,
  place          TEXT,
  evidence       TEXT NOT NULL DEFAULT '[]',
  witnesses      TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  reviewer_id    TEXT,
  reviewed_at    INTEGER,
  note           TEXT,
  warning_level  INTEGER,
  channel_id     TEXT,
  message_id     TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_reports_target   ON admin_reports (guild_id, target_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON admin_reports (guild_id, reporter_id, created_at DESC);
