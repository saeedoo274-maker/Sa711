-- فهارس زمنية على جداول قائمة لتسريع استعلامات الفترات. لا تغيير على البيانات.
CREATE INDEX IF NOT EXISTS idx_an_tickets_created ON tickets (guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_an_tickets_closed ON tickets (guild_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_an_applications_created ON applications (guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_an_transactions_created ON transactions (guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_an_giveaways_created ON giveaways (guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_an_staff_activity_day ON staff_activity (guild_id, day);

-- @down
DROP INDEX IF EXISTS idx_an_tickets_created;
DROP INDEX IF EXISTS idx_an_tickets_closed;
DROP INDEX IF EXISTS idx_an_applications_created;
DROP INDEX IF EXISTS idx_an_transactions_created;
DROP INDEX IF EXISTS idx_an_giveaways_created;
DROP INDEX IF EXISTS idx_an_staff_activity_day;
