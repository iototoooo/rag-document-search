-- =====================================================================
-- ⚠ 開発用プロジェクト専用のロールバック（マイグレーションを途中で失敗した・やり直したい場合）
-- 本番・データ投入済みの環境では絶対に実行しないこと。取り込んだ文書・チャンク・利用許可がすべて消える。
-- Storage のバケット・ファイルは SQL で直接削除しない（Supabase は Storage テーブルへの直接 DELETE を
-- 禁止している場合がある）。必要なら Dashboard > Storage で documents バケットを空にしてから削除する。
-- =====================================================================

begin;

drop policy if exists documents_bucket_select_visible on storage.objects;

drop function if exists public.replace_document_with_chunks(jsonb, jsonb);
drop function if exists public.match_document_chunks(extensions.vector, double precision, integer);

drop table if exists public.document_chunks;
drop table if exists public.documents;

drop function if exists public.is_active_app_user();
drop table if exists public.app_users;

-- vector 拡張は他で使っている可能性があるため削除しない
commit;
