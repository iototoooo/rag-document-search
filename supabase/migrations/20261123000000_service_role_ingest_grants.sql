-- =====================================================================
-- 取り込み CLI（service_role）にテーブル権限を明示的に付与する
--
-- 背景: 新しい Supabase プロジェクトでは public スキーマのテーブルに
--   既定の権限が自動付与されない場合がある。最初のマイグレーションでは
--   authenticated への SELECT だけを付与していたため、service_role が
--   documents を読めず取り込みが失敗した（42501 permission denied）。
--
-- 方針（最小権限）:
--   - 付与先は service_role のみ（anon / authenticated の権限は変更しない）
--   - 対象は取り込みで使う documents / document_chunks のみ
--     （app_users は SQL Editor から管理するため付与しない）
--   - service_role は RLS を迂回するキーであり、取り込み CLI（管理者 PC）専用
-- 注意: 本番環境への適用は手動で確認してから行うこと。
-- =====================================================================

grant select, insert, update, delete on public.documents, public.document_chunks to service_role;
