-- ============================================================
--  التقارير الدورية ونظام الدلائل
-- ============================================================

CREATE TABLE IF NOT EXISTS report_schedules (
  guild_id        TEXT PRIMARY KEY,
  channel_id      TEXT,
  frequency       TEXT NOT NULL DEFAULT 'weekly',
  hour            INTEGER NOT NULL DEFAULT 12,
  weekday         INTEGER NOT NULL DEFAULT 6,
  mention_role_id TEXT,
  sections        TEXT NOT NULL DEFAULT '[]',
  enabled         INTEGER NOT NULL DEFAULT 0,
  last_run_at     INTEGER,
  last_run_day    TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  number       INTEGER NOT NULL,
  case_number  INTEGER,
  target_id    TEXT NOT NULL,
  officer_id   TEXT NOT NULL,
  kind         TEXT NOT NULL,
  reason       TEXT,
  place        TEXT,
  duration     TEXT,
  links        TEXT NOT NULL DEFAULT '[]',
  note         TEXT,
  channel_id   TEXT,
  message_id   TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_evidence_target ON evidence (guild_id, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence (guild_id, case_number);
