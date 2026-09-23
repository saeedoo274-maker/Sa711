-- ============================================================
--  النظام العسكري / الشرطي
--  ثلاثة أنظمة مترابطة: نقاط العسكريين، مركز العمليات (الدوام)، والبلاغات.
--
--  النقاط هنا تُمنح يدويًا من المسؤولين (بخلاف staff_activity الذي يقيس
--  النشاط تلقائيًا من الرسائل والصوت) — فهما نظامان مختلفان لا يتداخلان.
-- ============================================================

CREATE TABLE IF NOT EXISTS military_points (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  points      INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mil_points_top ON military_points (guild_id, points DESC);

-- سجل كل تعديل على النقاط، للمساءلة ومعرفة من منح ومن سحب
CREATE TABLE IF NOT EXISTS military_point_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mil_log_user ON military_point_log (guild_id, user_id, created_at DESC);

-- مركز العمليات: نوبة دوام واحدة مفتوحة لكل عسكري في كل لحظة
CREATE TABLE IF NOT EXISTS military_shifts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  duration_ms  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mil_shifts_open ON military_shifts (guild_id, user_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_mil_shifts_user ON military_shifts (guild_id, user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS military_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  number        INTEGER NOT NULL,
  reporter_id   TEXT NOT NULL,
  kind          TEXT NOT NULL,
  details       TEXT NOT NULL,
  location      TEXT,
  suspect       TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  handler_id    TEXT,
  handled_at    INTEGER,
  channel_id    TEXT,
  message_id    TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_mil_reports_status ON military_reports (guild_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS military_report_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);
