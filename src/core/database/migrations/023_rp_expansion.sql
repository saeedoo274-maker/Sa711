-- ============================================================
--  توسعة RP: الشخصيات المتعددة، الممتلكات، الاعتقال، الترقية الآلية
--  (مستوحاة من تحليل بوتات خارجية، وأُعيدت كتابتها بمعايير المشروع)
-- ============================================================

-- ---------------- الشخصيات المتعددة ----------------
-- كل عضو له عدة شخصيات، كل واحدة برصيد وحقيبة وهوية مستقلة.
-- الشخصية النشطة واحدة في كل لحظة، وكل عمليات RP تُنسب إليها.
CREATE TABLE IF NOT EXISTS rp_characters (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  slot         INTEGER NOT NULL,
  name         TEXT,
  active       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  UNIQUE (guild_id, user_id, slot)
);
CREATE INDEX IF NOT EXISTS idx_rp_chars_active ON rp_characters (guild_id, user_id, active);

-- ---------------- الممتلكات ----------------
-- كتالوج المعروض للبيع (بيوت/مركبات) — يُعرَّف من الأوامر
CREATE TABLE IF NOT EXISTS rp_properties (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  key          TEXT NOT NULL,
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'vehicle',
  price        INTEGER NOT NULL,
  emoji        TEXT,
  image_url    TEXT,
  location     TEXT,
  stock        INTEGER,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  UNIQUE (guild_id, key)
);
CREATE INDEX IF NOT EXISTS idx_rp_props ON rp_properties (guild_id, kind, enabled);

-- ملكية الأعضاء. مرتبطة بالشخصية (slot) لا بالعضو فقط.
CREATE TABLE IF NOT EXISTS rp_ownership (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  slot          INTEGER NOT NULL DEFAULT 1,
  property_key  TEXT NOT NULL,
  plate         TEXT,
  bought_at     INTEGER NOT NULL,
  bought_price  INTEGER NOT NULL,
  confiscated   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rp_own_user ON rp_ownership (guild_id, user_id, slot, confiscated);

-- ---------------- الاعتقال (الكلبشة) ----------------
-- حالة اعتقال مؤقتة تمنع أوامر RP، أخف من السجن ولا تسحب رتبًا.
CREATE TABLE IF NOT EXISTS rp_cuffs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  officer_id   TEXT NOT NULL,
  reason       TEXT,
  released_at  INTEGER,
  released_by  TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rp_cuffs_active ON rp_cuffs (guild_id, user_id, released_at);

-- سجل المصادرات، ليُعرف ما صودر ومن صادره
CREATE TABLE IF NOT EXISTS rp_seizures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  officer_id   TEXT NOT NULL,
  item_key     TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  reason       TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rp_seiz ON rp_seizures (guild_id, user_id, created_at DESC);

-- ---------------- سلّم الرتب العسكرية بالنقاط ----------------
-- ترقية آلية: العضو يستلم رتبته حين تبلغ نقاطه الحد المطلوب.
CREATE TABLE IF NOT EXISTS military_ranks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  role_id       TEXT NOT NULL,
  label         TEXT NOT NULL,
  points        INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (guild_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_mil_ranks ON military_ranks (guild_id, points ASC);
