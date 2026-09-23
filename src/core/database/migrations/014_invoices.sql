-- ============================================================
--  الفواتير: سجل مبيعات يدوي يوثّقه البائع لكل عملية بيع
--  (منقول بمفهومه من نظام مرجعي خارجي، وأُعيدت كتابته بترقيم آمن ومعاملات ذرّية)
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  number         INTEGER NOT NULL,
  seller_id      TEXT NOT NULL,
  client_name    TEXT NOT NULL,
  product        TEXT NOT NULL,
  amount         INTEGER NOT NULL,
  method         TEXT NOT NULL,
  channel_id     TEXT,
  message_id     TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_seller ON invoices (guild_id, seller_id, created_at DESC);

-- عدّاد مستقل لكل سيرفر، بنفس نمط عدادات القضايا والتذاكر في المشروع
CREATE TABLE IF NOT EXISTS invoice_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);
