-- ============================================================
--  الهوية الوطنية والأنظمة الحكومية
--  (بطاقة الهوية، مجلس الشورى، التعميمات، التقاعد)
-- ============================================================

CREATE TABLE IF NOT EXISTS identities (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  card_number    INTEGER NOT NULL,
  full_name      TEXT NOT NULL,
  birth_date     TEXT,
  birth_place    TEXT,
  gender         TEXT,
  nationality    TEXT,
  job            TEXT,
  photo_url      TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  reviewer_id    TEXT,
  reviewed_at    INTEGER,
  reject_reason  TEXT,
  issued_at      INTEGER,
  expires_at     INTEGER,
  channel_id     TEXT,
  message_id     TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE (guild_id, user_id),
  UNIQUE (guild_id, card_number)
);
CREATE INDEX IF NOT EXISTS idx_identities_status ON identities (guild_id, status);

CREATE TABLE IF NOT EXISTS identity_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);

-- ---------------- مجلس الشورى ----------------
-- تصويت على مشاريع قرارات (يختلف عن الانتخابات: هنا الخيار موافقة/رفض على مقترح)
CREATE TABLE IF NOT EXISTS shura_projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  number        INTEGER NOT NULL,
  title         TEXT NOT NULL,
  goal          TEXT NOT NULL,
  details       TEXT,
  proposer_id   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  session_time  TEXT,
  decided_by    TEXT,
  decided_at    INTEGER,
  reason        TEXT,
  channel_id    TEXT,
  message_id    TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_shura_status ON shura_projects (guild_id, status);

CREATE TABLE IF NOT EXISTS shura_votes (
  project_id   INTEGER NOT NULL,
  voter_id     TEXT NOT NULL,
  vote         TEXT NOT NULL,
  voted_at     INTEGER NOT NULL,
  PRIMARY KEY (project_id, voter_id)
);

CREATE TABLE IF NOT EXISTS shura_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);

-- ---------------- التعميمات الإدارية ----------------
CREATE TABLE IF NOT EXISTS circulars (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  number        INTEGER NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  issuer_id     TEXT NOT NULL,
  authority     TEXT,
  channel_id    TEXT,
  message_id    TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_circulars_guild ON circulars (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS circular_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);

-- ---------------- التقاعد ----------------
-- يختلف عن الاستقالة: إنهاء خدمة مشرّف بسجل يحفظ الرتب والمدة
CREATE TABLE IF NOT EXISTS retirements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  number         INTEGER NOT NULL,
  user_id        TEXT NOT NULL,
  reason         TEXT,
  honor          TEXT,
  saved_roles    TEXT NOT NULL DEFAULT '[]',
  service_ms     INTEGER,
  retired_by     TEXT NOT NULL,
  channel_id     TEXT,
  message_id     TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_retirements_user ON retirements (guild_id, user_id);

CREATE TABLE IF NOT EXISTS retirement_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);
