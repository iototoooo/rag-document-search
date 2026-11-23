-- =====================================================================
-- マイグレーション適用後の確認クエリ（読み取り専用・何も変更しない）
-- Supabase Dashboard > SQL Editor に貼り付けて実行し、各結果を docs/SETUP.md の期待値と照合する。
-- =====================================================================

-- [1] pgvector 拡張が extensions スキーマに入っている（1 行返る）
select extname, extversion, n.nspname as schema
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
where extname = 'vector';

-- [2] 3 テーブルすべてで RLS が有効（rowsecurity がすべて true）
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename in ('app_users', 'documents', 'document_chunks')
order by tablename;

-- [3] ポリシー一覧（すべて cmd = SELECT, roles = {authenticated}。storage.objects に 1 件）
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where (schemaname = 'public' and tablename in ('app_users', 'documents', 'document_chunks'))
   or (schemaname = 'storage' and policyname = 'documents_bucket_select_visible')
order by schemaname, tablename;

-- [4] テーブル権限（anon の行が 0 件、authenticated は SELECT のみ）
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('app_users', 'documents', 'document_chunks')
  and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;

-- [5] 関数の実行権限・セキュリティ種別
--   match_document_chunks : security_definer = false, anon = false, authenticated = true
--   replace_document_with_chunks : authenticated = false, anon = false, service_role = true
--   is_active_app_user : security_definer = true, anon = false
select p.proname,
       p.prosecdef as security_definer,
       p.proconfig as config,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute') as service_role
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('match_document_chunks', 'replace_document_with_chunks', 'is_active_app_user')
order by p.proname;

-- [6] Embedding 列の型が vector(1536)
select a.attname, format_type(a.atttypid, a.atttypmod) as type
from pg_attribute a
where a.attrelid = 'public.document_chunks'::regclass and a.attname = 'embedding';

-- [7] Storage バケット documents が非公開（public = false）
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'documents';

-- [8] 公開範囲ごとの文書数（取り込み後に実行。MVP では internal のみが想定）
select visibility, count(*) from public.documents group by visibility;

-- [9] 利用許可ユーザー数（メールアドレスは表示しない）
select is_active, count(*) from public.app_users group by is_active;
