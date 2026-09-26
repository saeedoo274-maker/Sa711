-- ============================================================
--  توسعة التقديمات كمنشئ نماذج: نافذة فتح/إغلاق، حد إجمالي، حد لكل عضو.
--  القيم الافتراضية (NULL/0) تعني "بلا قيد" فلا يتغير سلوك الأنواع الحالية.
-- ============================================================
ALTER TABLE application_types ADD COLUMN opens_at INTEGER;
ALTER TABLE application_types ADD COLUMN closes_at INTEGER;
ALTER TABLE application_types ADD COLUMN max_submissions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE application_types ADD COLUMN per_user_limit INTEGER NOT NULL DEFAULT 0;

-- @down
ALTER TABLE application_types DROP COLUMN per_user_limit;
ALTER TABLE application_types DROP COLUMN max_submissions;
ALTER TABLE application_types DROP COLUMN closes_at;
ALTER TABLE application_types DROP COLUMN opens_at;
