-- ============================================================
--  تسجيل الدخول اليومي للإداريين والتحذير التلقائي
-- ============================================================

-- سجل حضور يومي. صف واحد لكل إداري في كل يوم، فالتكرار مستحيل بنية الجدول.
CREATE TABLE IF NOT EXISTS staff_checkins (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  day         TEXT NOT NULL,
  checked_at  INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'message',
  PRIMARY KEY (guild_id, user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_checkins_day ON staff_checkins (guild_id, day);
CREATE INDEX IF NOT EXISTS idx_checkins_user ON staff_checkins (guild_id, user_id, day DESC);

-- التحذيرات المُرسلة، حتى لا يتكرر تحذير العضو نفسه في اليوم نفسه
CREATE TABLE IF NOT EXISTS staff_absence_warnings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  day         TEXT NOT NULL,
  missed_days INTEGER NOT NULL,
  sent_at     INTEGER NOT NULL,
  delivered   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (guild_id, user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_absence_warn ON staff_absence_warnings (guild_id, sent_at DESC);
