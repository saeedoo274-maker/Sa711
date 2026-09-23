-- ============================================================
--  إيقاف/تفعيل الخدمات البنكية لكل عضو
--  الحساب المجمَّد يُمنع من التحويل والسحب والإيداع، لكن يبقى قابلاً للقراءة
--  (كشف الحساب يعمل دائماً حتى يعرف العضو سبب التجميد ويتواصل مع الإدارة).
-- ============================================================

ALTER TABLE accounts ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN frozen_reason TEXT;
ALTER TABLE accounts ADD COLUMN frozen_by TEXT;
ALTER TABLE accounts ADD COLUMN frozen_at INTEGER;
