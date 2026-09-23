-- ============================================================
--  البنية التحتية للمنصة: حالة النظام، الصيانة، المجدول، الطابور،
--  الإشعارات، وإعدادات المستخدم (المنطقة الزمنية).
--  جداول جديدة فقط — لا تعديل على أي جدول قائم.
-- ============================================================

-- مخزن مفتاح/قيمة لحالة البوت العامة (الصيانة، الأعلام العامة، حالة الإضافات)
CREATE TABLE IF NOT EXISTS system_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- سجل كل تغيير على وضع الصيانة
CREATE TABLE IF NOT EXISTS maintenance_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT NOT NULL,          -- global | module | command
  target      TEXT,                   -- اسم النظام أو الأمر
  action      TEXT NOT NULL,          -- enable | disable | schedule | expire
  message     TEXT,
  actor_id    TEXT,
  starts_at   INTEGER,
  ends_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maintenance_log_time ON maintenance_log (created_at DESC);

-- المجدول المركزي: كل مهمة مؤجلة أو متكررة تنجو من إعادة التشغيل
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT,
  type          TEXT NOT NULL,
  unique_key    TEXT UNIQUE,
  payload       TEXT NOT NULL DEFAULT '{}',
  run_at        INTEGER NOT NULL,
  repeat        TEXT,                 -- JSON: { kind, everyMs | time, tz, weekday, dayOfMonth }
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed | cancelled
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  last_run_at   INTEGER,
  last_error    TEXT,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON scheduled_jobs (status, run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_guild ON scheduled_jobs (guild_id, type, status);

-- طابور المهام الثقيلة (إذاعة، رسائل جماعية، نسخ احتياطي، استعادة، تقارير)
CREATE TABLE IF NOT EXISTS queue_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  queue         TEXT NOT NULL,
  guild_id      TEXT,
  payload       TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed | cancelled
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  available_at  INTEGER NOT NULL,
  progress      INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  result        TEXT,
  error         TEXT,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  finished_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_queue_next ON queue_jobs (queue, status, available_at);
CREATE INDEX IF NOT EXISTS idx_queue_guild ON queue_jobs (guild_id, created_at DESC);

-- تفضيلات الإشعارات لكل عضو في كل سيرفر وكل فئة
CREATE TABLE IF NOT EXISTS notification_prefs (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  category    TEXT NOT NULL,
  dm          INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, category)
);

-- إعدادات المستخدم العابرة للسيرفرات (المنطقة الزمنية)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id     TEXT PRIMARY KEY,
  timezone    TEXT,
  updated_at  INTEGER NOT NULL
);

-- @down
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS notification_prefs;
DROP TABLE IF EXISTS queue_jobs;
DROP TABLE IF EXISTS scheduled_jobs;
DROP TABLE IF EXISTS maintenance_log;
DROP TABLE IF EXISTS system_state;
