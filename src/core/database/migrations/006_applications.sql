-- ============================================================
--  التقديمات واختبار التفعيل
-- ============================================================

CREATE TABLE IF NOT EXISTS application_types (
  id                 TEXT PRIMARY KEY,
  guild_id           TEXT NOT NULL,
  name               TEXT NOT NULL,
  label              TEXT NOT NULL,
  description        TEXT,
  emoji              TEXT,
  questions          TEXT NOT NULL DEFAULT '[]',
  review_channel_id  TEXT,
  accept_role_id     TEXT,
  remove_role_id     TEXT,
  accept_message     TEXT,
  reject_message     TEXT,
  collect_mode       TEXT NOT NULL DEFAULT 'modal',
  cooldown_ms        INTEGER NOT NULL DEFAULT 0,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);
CREATE INDEX IF NOT EXISTS idx_app_types_guild ON application_types (guild_id);

CREATE TABLE IF NOT EXISTS applications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  number       INTEGER NOT NULL,
  type_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  answers      TEXT NOT NULL DEFAULT '{}',
  image_url    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  reviewer_id  TEXT,
  reviewed_at  INTEGER,
  note         TEXT,
  channel_id   TEXT,
  message_id   TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_apps_user ON applications (guild_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_apps_type ON applications (guild_id, type_id, status);

CREATE TABLE IF NOT EXISTS application_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);

-- ---------------- اختبار التفعيل ----------------

CREATE TABLE IF NOT EXISTS quiz_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  correct     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quiz_guild ON quiz_questions (guild_id, position);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  passed      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts ON quiz_attempts (guild_id, user_id, created_at DESC);
