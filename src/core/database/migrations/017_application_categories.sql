-- ============================================================
--  تصنيف التقديمات إلى فئات (مثل: وزارة الداخلية، العصابات، وزارة الإعلام)
--  فئة فارغة (NULL) تعني أن النوع يظهر مباشرة بلا تصنيف، للتوافق مع الأنواع الموجودة.
-- ============================================================

ALTER TABLE application_types ADD COLUMN category TEXT;
CREATE INDEX IF NOT EXISTS idx_app_types_category ON application_types (guild_id, category);
