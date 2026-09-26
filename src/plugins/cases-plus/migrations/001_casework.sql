-- ملاحظات وأحداث القضايا والبلاغات (خط زمني موحّد)
CREATE TABLE IF NOT EXISTS casework_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  scope       TEXT NOT NULL,          -- case | report
  ref         INTEGER NOT NULL,       -- رقم القضية أو رقم البلاغ
  author_id   TEXT,
  kind        TEXT NOT NULL,          -- note | evidence | status | link | assign | priority | escalate | sla
  content     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_casework_notes ON casework_notes (guild_id, scope, ref, id);

-- قضايا مرتبطة (a < b دائمًا لمنع التكرار)
CREATE TABLE IF NOT EXISTS case_links (
  guild_id    TEXT NOT NULL,
  a           INTEGER NOT NULL,
  b           INTEGER NOT NULL,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, a, b)
);

-- دورة حياة البلاغات على الإداريين (أعمدة اختيارية على الجدول الموجود)
ALTER TABLE admin_reports ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE admin_reports ADD COLUMN assignee_id TEXT;
ALTER TABLE admin_reports ADD COLUMN escalated_at INTEGER;
ALTER TABLE admin_reports ADD COLUMN sla_due_at INTEGER;
ALTER TABLE admin_reports ADD COLUMN sla_breached INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_cases_moderator ON cases (guild_id, moderator_id, case_number);

-- @down
DROP INDEX IF EXISTS idx_cases_moderator;
ALTER TABLE admin_reports DROP COLUMN sla_breached;
ALTER TABLE admin_reports DROP COLUMN sla_due_at;
ALTER TABLE admin_reports DROP COLUMN escalated_at;
ALTER TABLE admin_reports DROP COLUMN assignee_id;
ALTER TABLE admin_reports DROP COLUMN priority;
DROP TABLE IF EXISTS case_links;
DROP INDEX IF EXISTS idx_casework_notes;
DROP TABLE IF EXISTS casework_notes;
