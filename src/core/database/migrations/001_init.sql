-- ============================================================
--  المخطط الأولي لقاعدة البيانات
--  كل جدول مرتبط بـ guild_id لضمان العزل الكامل بين السيرفرات
-- ============================================================

CREATE TABLE IF NOT EXISTS guilds (
  id          TEXT PRIMARY KEY,
  config      TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- السلم الإداري: كل صف رتبة واحدة بترتيب محدد داخل سيرفر واحد
CREATE TABLE IF NOT EXISTS staff_ranks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  role_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  level       INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  UNIQUE (guild_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_ranks_guild ON staff_ranks (guild_id, position);

-- القضايا الإدارية: رقم متسلسل مستقل لكل سيرفر
CREATE TABLE IF NOT EXISTS cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  case_number   INTEGER NOT NULL,
  type          TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  target_tag    TEXT,
  moderator_id  TEXT NOT NULL,
  moderator_tag TEXT,
  reason        TEXT,
  duration_ms   INTEGER,
  expires_at    INTEGER,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  UNIQUE (guild_id, case_number)
);
CREATE INDEX IF NOT EXISTS idx_cases_target ON cases (guild_id, target_id, active);
CREATE INDEX IF NOT EXISTS idx_cases_type   ON cases (guild_id, type, active);

-- عدّاد القضايا لكل سيرفر (يُحدَّث داخل transaction لمنع التكرار)
CREATE TABLE IF NOT EXISTS case_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);

-- التذاكر (تُستخدم في المرحلة 6 - المخطط جاهز مسبقًا للانتقال بدون هجرة)
CREATE TABLE IF NOT EXISTS tickets (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id             TEXT NOT NULL,
  channel_id           TEXT NOT NULL UNIQUE,
  panel_id             TEXT,
  owner_id             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'open',
  claimed_by           TEXT,
  claimed_at           INTEGER,
  attachments_allowed  INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  closed_at            INTEGER,
  closed_by            TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets (guild_id, status);

CREATE TABLE IF NOT EXISTS ticket_members (
  ticket_id  INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  added_by   TEXT NOT NULL,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, user_id)
);

-- نشاط الطاقم الإداري (المرحلة 5)
CREATE TABLE IF NOT EXISTS staff_activity (
  guild_id         TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  day              TEXT NOT NULL,
  messages         INTEGER NOT NULL DEFAULT 0,
  voice_seconds    INTEGER NOT NULL DEFAULT 0,
  tickets_claimed  INTEGER NOT NULL DEFAULT 0,
  tickets_closed   INTEGER NOT NULL DEFAULT 0,
  last_active_at   INTEGER,
  PRIMARY KEY (guild_id, user_id, day)
);

-- سجل الأخطاء
CREATE TABLE IF NOT EXISTS error_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  error_id    TEXT NOT NULL UNIQUE,
  guild_id    TEXT,
  user_id     TEXT,
  system      TEXT,
  command     TEXT,
  message     TEXT NOT NULL,
  stack       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_created ON error_logs (created_at DESC);
