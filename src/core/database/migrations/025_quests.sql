-- ============================================================
--  نظام مهام الإدارة
--  المهام تُعرَّف مرة، وتُنشر كدورات، ويتحقق البوت من إنجازها آليًا.
-- ============================================================

-- تعريف المهمة: قابل للتعديل الكامل، ويحدد كم شخصًا يقدر ينفذها
CREATE TABLE IF NOT EXISTS quests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  key            TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  kind           TEXT NOT NULL DEFAULT 'daily',
  -- نوع التحقق: manual | messages | voice_minutes | tickets_claimed |
  -- tickets_closed | ratings | rating_average | violations | checkins | points
  verify_type    TEXT NOT NULL DEFAULT 'manual',
  verify_target  INTEGER NOT NULL DEFAULT 1,
  -- كم شخصًا يقدر ينفذها في الدورة الواحدة (0 = بلا حد)
  max_claims     INTEGER NOT NULL DEFAULT 1,
  reward_points  INTEGER NOT NULL DEFAULT 0,
  reward_money   INTEGER NOT NULL DEFAULT 0,
  difficulty     TEXT NOT NULL DEFAULT 'normal',
  emoji          TEXT,
  timeout_ms     INTEGER,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE (guild_id, key)
);
CREATE INDEX IF NOT EXISTS idx_quests_kind ON quests (guild_id, kind, enabled);

-- دورة نشر: كل نشر يفتح دورة جديدة فتُعاد المهمة دون خلط سجلات القديمة
CREATE TABLE IF NOT EXISTS quest_cycles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  quest_id     INTEGER NOT NULL,
  channel_id   TEXT,
  message_id   TEXT,
  opened_at    INTEGER NOT NULL,
  closes_at    INTEGER,
  closed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cycles_open ON quest_cycles (guild_id, quest_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_cycles_msg ON quest_cycles (message_id);

-- استلام المهمة. اللقطة (snapshot) تُخزَّن عند الاستلام ليُقاس التقدّم منها.
CREATE TABLE IF NOT EXISTS quest_claims (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  cycle_id       INTEGER NOT NULL,
  quest_id       INTEGER NOT NULL,
  user_id        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'claimed',
  baseline       INTEGER NOT NULL DEFAULT 0,
  progress       INTEGER NOT NULL DEFAULT 0,
  claimed_at     INTEGER NOT NULL,
  deadline_at    INTEGER,
  completed_at   INTEGER,
  verified_by    TEXT,
  note           TEXT,
  UNIQUE (cycle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_claims_cycle ON quest_claims (cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_user ON quest_claims (guild_id, user_id, status);

-- سجل الإنجاز، يبقى بعد إغلاق الدورات لحساب الإحصاءات
CREATE TABLE IF NOT EXISTS quest_completions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  quest_id      INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  points        INTEGER NOT NULL DEFAULT 0,
  money         INTEGER NOT NULL DEFAULT 0,
  verify_type   TEXT,
  completed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_completions ON quest_completions (guild_id, user_id, completed_at DESC);
