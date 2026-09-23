-- ============================================================
--  الاقتصاد: البنك، المخالفات، الطيران
--  كل الأرصدة أعداد صحيحة (لا كسور) لتفادي أخطاء الفاصلة العائمة
-- ============================================================

CREATE TABLE IF NOT EXISTS accounts (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  wallet      INTEGER NOT NULL DEFAULT 0,
  bank        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_accounts_bank ON accounts (guild_id, bank DESC);

-- سجل كل حركة مالية. لا يُعدَّل ولا يُحذف، للمراجعة والتدقيق.
CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  type            TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  wallet_after    INTEGER NOT NULL,
  bank_after      INTEGER NOT NULL,
  counterparty_id TEXT,
  actor_id        TEXT,
  reason          TEXT,
  ref_type        TEXT,
  ref_id          TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions (guild_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS loans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  remaining    INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  reason       TEXT,
  reviewed_by  TEXT,
  created_at   INTEGER NOT NULL,
  closed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans (guild_id, user_id, status);

-- ---------------- المخالفات ----------------

CREATE TABLE IF NOT EXISTS violations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  number      INTEGER NOT NULL,
  target_id   TEXT NOT NULL,
  officer_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'unpaid',
  notes       TEXT,
  paid_at     INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_violations_target ON violations (guild_id, target_id, status);

CREATE TABLE IF NOT EXISTS violation_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);

-- ---------------- الطيران ----------------

CREATE TABLE IF NOT EXISTS flights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  code          TEXT NOT NULL,
  destination   TEXT NOT NULL,
  price         INTEGER NOT NULL DEFAULT 0,
  seats         INTEGER NOT NULL DEFAULT 0,
  seats_taken   INTEGER NOT NULL DEFAULT 0,
  captain_id    TEXT,
  departure_at  INTEGER,
  status        TEXT NOT NULL DEFAULT 'open',
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (guild_id, code)
);
CREATE INDEX IF NOT EXISTS idx_flights_status ON flights (guild_id, status);

CREATE TABLE IF NOT EXISTS flight_bookings (
  flight_id   INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  seat_no     INTEGER NOT NULL,
  paid        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (flight_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_flight ON flight_bookings (flight_id);
