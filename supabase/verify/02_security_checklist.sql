-- =====================================================================
-- セキュリティ設定の一括チェック（読み取り専用・何も変更しない）
-- SQL Editor に全文を貼り付けて Run すると、1 つの表に全項目の
-- 「期待値 / 実際の値 / 判定(OK・NG)」が表示される。
-- result 列がすべて OK なら正常。NG の行があれば no と actual を控えて相談する。
-- =====================================================================

with checks (no, category, item, expected, actual) as (
  -- ---------- 拡張 ----------
  select 1, '拡張', 'pgvector が extensions スキーマにある', 'extensions',
    coalesce((select n.nspname::text from pg_extension e
              join pg_namespace n on n.oid = e.extnamespace
              where e.extname = 'vector'), '(なし)')

  -- ---------- RLS ----------
  union all select 2, 'RLS', 'app_users の RLS が有効', 'true',
    coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.app_users')), '(テーブルなし)')
  union all select 3, 'RLS', 'documents の RLS が有効', 'true',
    coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.documents')), '(テーブルなし)')
  union all select 4, 'RLS', 'document_chunks の RLS が有効', 'true',
    coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.document_chunks')), '(テーブルなし)')
  union all select 5, 'RLS', 'public スキーマに RLS 無効のテーブルがない', '0',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity)
  union all select 6, 'RLS', 'storage.objects の RLS が有効', 'true',
    coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('storage.objects')), '(なし)')

  -- ---------- ポリシー ----------
  union all select 7, 'ポリシー', '3 テーブルのポリシー数', '3',
    (select count(*)::text from pg_policies
     where schemaname = 'public' and tablename in ('app_users', 'documents', 'document_chunks'))
  union all select 8, 'ポリシー', 'SELECT 以外（INSERT/UPDATE/DELETE/ALL）のポリシー数', '0',
    (select count(*)::text from pg_policies
     where schemaname = 'public' and tablename in ('app_users', 'documents', 'document_chunks')
       and cmd <> 'SELECT')
  union all select 9, 'ポリシー', 'authenticated 以外のロール向けポリシー数', '0',
    (select count(*)::text from pg_policies
     where schemaname = 'public' and tablename in ('app_users', 'documents', 'document_chunks')
       and roles <> array['authenticated']::name[])
  union all select 10, 'ポリシー', 'documents は internal のみ許可（department/restricted を含まない）', 'true',
    coalesce((select (qual like '%''internal''%' and qual like '%is_active_app_user%'
                      and qual not like '%department%' and qual not like '%restricted%')::text
              from pg_policies
              where schemaname = 'public' and tablename = 'documents'
                and policyname = 'documents_select_internal'), '(ポリシーなし)')
  union all select 11, 'ポリシー', 'app_users は自分の行のみ（auth.uid() で絞り込み）', 'true',
    coalesce((select (qual like '%auth.uid()%')::text from pg_policies
              where schemaname = 'public' and tablename = 'app_users'
                and policyname = 'app_users_select_self'), '(ポリシーなし)')

  -- ---------- Storage ----------
  union all select 12, 'Storage', 'documents バケットが非公開', 'false',
    coalesce((select public::text from storage.buckets where id = 'documents'), '(バケットなし)')
  union all select 13, 'Storage', '閲覧ポリシー（SELECT・authenticated）がある', 'SELECT:authenticated',
    coalesce((select cmd || ':' || array_to_string(roles, ',') from pg_policies
              where schemaname = 'storage' and tablename = 'objects'
                and policyname = 'documents_bucket_select_visible'), '(ポリシーなし)')
  union all select 14, 'Storage', 'documents バケットへの書き込みポリシー数', '0',
    (select count(*)::text from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and cmd <> 'SELECT'
       and (coalesce(qual, '') like '%documents%' or coalesce(with_check, '') like '%documents%'))
  union all select 15, 'Storage', 'anon 向けの storage.objects ポリシーで documents を参照するもの', '0',
    (select count(*)::text from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and ('anon' = any (roles) or 'public' = any (roles))
       and (coalesce(qual, '') like '%documents%' or coalesce(with_check, '') like '%documents%'))

  -- ---------- テーブル権限 ----------
  union all select 16, '権限', 'anon が何らかの権限を持つテーブル数（3 テーブル中）', '0',
    (select count(*)::text from unnest(array['public.app_users', 'public.documents', 'public.document_chunks']) t
     where has_table_privilege('anon', t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
  union all select 17, '権限', 'authenticated が SELECT できるテーブル数', '3',
    (select count(*)::text from unnest(array['public.app_users', 'public.documents', 'public.document_chunks']) t
     where has_table_privilege('authenticated', t, 'SELECT'))
  union all select 18, '権限', 'authenticated が SELECT 以外の権限を持つテーブル数', '0',
    (select count(*)::text from unnest(array['public.app_users', 'public.documents', 'public.document_chunks']) t
     where has_table_privilege('authenticated', t, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))

  -- ---------- 検索 RPC ----------
  union all select 19, '検索RPC', 'match_document_chunks が security invoker（definer でない）', 'false',
    coalesce((select prosecdef::text from pg_proc
              where oid = to_regprocedure('public.match_document_chunks(extensions.vector, double precision, integer)')), '(関数なし)')
  union all select 20, '検索RPC', 'match_document_chunks の search_path が空に固定', 'true',
    coalesce((select (array_to_string(proconfig, ',') like '%search_path=""%')::text from pg_proc
              where oid = to_regprocedure('public.match_document_chunks(extensions.vector, double precision, integer)')), '(関数なし)')
  union all select 21, '検索RPC', 'anon が match_document_chunks を実行できない', 'false',
    coalesce(has_function_privilege('anon', to_regprocedure('public.match_document_chunks(extensions.vector, double precision, integer)'), 'EXECUTE')::text, '(関数なし)')
  union all select 22, '検索RPC', 'authenticated が match_document_chunks を実行できる', 'true',
    coalesce(has_function_privilege('authenticated', to_regprocedure('public.match_document_chunks(extensions.vector, double precision, integer)'), 'EXECUTE')::text, '(関数なし)')

  -- ---------- 取り込み RPC ----------
  union all select 23, '取り込みRPC', 'anon が replace_document_with_chunks を実行できない', 'false',
    coalesce(has_function_privilege('anon', to_regprocedure('public.replace_document_with_chunks(jsonb, jsonb)'), 'EXECUTE')::text, '(関数なし)')
  union all select 24, '取り込みRPC', 'authenticated が replace_document_with_chunks を実行できない', 'false',
    coalesce(has_function_privilege('authenticated', to_regprocedure('public.replace_document_with_chunks(jsonb, jsonb)'), 'EXECUTE')::text, '(関数なし)')
  union all select 25, '取り込みRPC', 'service_role が replace_document_with_chunks を実行できる', 'true',
    coalesce(has_function_privilege('service_role', to_regprocedure('public.replace_document_with_chunks(jsonb, jsonb)'), 'EXECUTE')::text, '(関数なし)')
  union all select 26, '取り込みRPC', 'replace_document_with_chunks が security invoker', 'false',
    coalesce((select prosecdef::text from pg_proc
              where oid = to_regprocedure('public.replace_document_with_chunks(jsonb, jsonb)')), '(関数なし)')

  -- ---------- 認可関数 ----------
  union all select 27, '認可関数', 'is_active_app_user が security definer', 'true',
    coalesce((select prosecdef::text from pg_proc
              where oid = to_regprocedure('public.is_active_app_user()')), '(関数なし)')
  union all select 28, '認可関数', 'is_active_app_user の search_path が空に固定', 'true',
    coalesce((select (array_to_string(proconfig, ',') like '%search_path=""%')::text from pg_proc
              where oid = to_regprocedure('public.is_active_app_user()')), '(関数なし)')
  union all select 29, '認可関数', 'anon が is_active_app_user を実行できない', 'false',
    coalesce(has_function_privilege('anon', to_regprocedure('public.is_active_app_user()'), 'EXECUTE')::text, '(関数なし)')
  -- 許可リスト方式: 下記 2 関数（引数なし）以外の security definer 関数が public にあれば NG。
  --   is_active_app_user … 本システムの認可判定（No.27〜29 で設定を個別検証）
  --   rls_auto_enable    … Supabase が提供する「新規テーブルの RLS 自動有効化」用イベントトリガー関数（No.31 で検証）
  -- 想定外の関数があると、その「関数名(引数)」が actual に表示される。
  union all select 30, '認可関数', 'public スキーマに想定外の security definer 関数がない（許可: is_active_app_user, rls_auto_enable）', '(なし)',
    coalesce((select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef
                and not (p.proname in ('is_active_app_user', 'rls_auto_enable')
                         and pg_get_function_identity_arguments(p.oid) = '')), '(なし)')
  -- rls_auto_enable は存在しないプロジェクトもあるため、存在しない場合も OK。
  -- 存在する場合は security definer・search_path=pg_catalog 固定・イベントトリガー専用（RPC として呼べない）であること。
  union all select 31, '認可関数', 'rls_auto_enable（存在する場合）が definer・search_path=pg_catalog・イベントトリガー関数', 'OK',
    coalesce((select case
                       when p.prosecdef
                        and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=pg_catalog'
                        and p.prorettype = 'event_trigger'::regtype
                       then 'OK'
                       else 'definer=' || p.prosecdef::text
                            || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(なし)')
                            || ' returns=' || format_type(p.prorettype, null)
                     end
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'rls_auto_enable'
                and pg_get_function_identity_arguments(p.oid) = ''), 'OK')

  -- ---------- テーブル構造 ----------
  union all select 32, '構造', 'embedding 列が vector(1536)', 'true',
    coalesce((select (format_type(atttypid, atttypmod) like '%vector(1536)')::text from pg_attribute
              where attrelid = to_regclass('public.document_chunks') and attname = 'embedding'), '(列なし)')
  union all select 33, '構造', 'embedding の HNSW（コサイン）インデックス数', '1',
    (select count(*)::text from pg_indexes
     where schemaname = 'public' and tablename = 'document_chunks'
       and indexdef ilike '%using hnsw%' and indexdef ilike '%vector_cosine_ops%')
  union all select 34, '構造', 'documents.visibility の既定値が restricted', 'true',
    coalesce((select (pg_get_expr(d.adbin, d.adrelid) like '%restricted%')::text
              from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
              where d.adrelid = to_regclass('public.documents') and a.attname = 'visibility'), '(既定値なし)')
  union all select 35, '構造', 'document_chunks → documents の削除連動（cascade）', 'c',
    coalesce((select confdeltype::text from pg_constraint
              where conrelid = to_regclass('public.document_chunks') and contype = 'f'
                and confrelid = to_regclass('public.documents')), '(外部キーなし)')
  union all select 36, '構造', 'chunk_key の一意制約がある', 'true',
    (select (count(*) > 0)::text from pg_indexes
     where schemaname = 'public' and tablename = 'document_chunks'
       and indexdef ilike '%unique%' and indexdef ilike '%(chunk_key)%')
  union all select 37, '構造', 'documents.source_key の一意制約がある', 'true',
    (select (count(*) > 0)::text from pg_indexes
     where schemaname = 'public' and tablename = 'documents'
       and indexdef ilike '%unique%' and indexdef ilike '%(source_key)%')

  -- ---------- データ件数（現時点の状態確認。取り込み・ユーザー登録前は 0 が正常） ----------
  union all select 38, 'データ', 'documents の件数（取り込み前）', '0',
    (select count(*)::text from public.documents)
  union all select 39, 'データ', 'internal 以外の文書数（MVP では 0）', '0',
    (select count(*)::text from public.documents where visibility <> 'internal')
  union all select 40, 'データ', 'app_users の件数（Auth 設定前）', '0',
    (select count(*)::text from public.app_users)

  -- ---------- 取り込み権限（20261123000000_service_role_ingest_grants.sql 適用後に OK） ----------
  -- 不足している「テーブル:権限」を列挙する。すべてそろっていれば (なし)
  union all select 41, '取り込み権限', 'service_role が documents・document_chunks を読み書きできる', '(なし)',
    coalesce((select string_agg(t.name || ':' || p.priv, ', ' order by t.name, p.priv)
              from unnest(array['public.documents', 'public.document_chunks']) as t(name)
              cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
              where to_regclass(t.name) is null
                 or not has_table_privilege('service_role', to_regclass(t.name), p.priv)), '(なし)')
)
select no, category, item, expected, actual,
       case when actual = expected then 'OK' else 'NG' end as result
from checks
order by no;
