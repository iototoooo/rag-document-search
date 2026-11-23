-- =====================================================================
-- T-1〜T-3 セキュリティテストの状態確認（読み取り専用・何も変更しない）
-- テストデータ作成の前・作成後・削除後に SQL Editor で全文を Run し、件数を控える。
--
-- 想定値:
--                         作成前   作成後（T-1 ユーザー作成済み）   削除後（ユーザー削除済み）
--   documents               5       7                               5
--   document_chunks        14      16                              14
--   app_users               1       1（未登録ユーザーは追加しない）    1
--   auth.users              1       2                               1
--   テスト用 文書/チャンク/Storage   0/0/0   2/2/2                   0/0/0
--   app_users 未登録の Auth ユーザー  0   1                           0
-- =====================================================================

select 1 as no, '文書（documents）' as item, count(*)::text as value from public.documents
union all select 2, 'チャンク（document_chunks）', count(*)::text from public.document_chunks
union all select 3, '利用許可（app_users）', count(*)::text from public.app_users
union all select 4, 'Auth ユーザー（auth.users）', count(*)::text from auth.users
union all select 5, 'テスト用文書（zz-sectest-）', count(*)::text
  from public.documents where source_key like 'zz-sectest-%'
union all select 6, 'テスト用チャンク', count(*)::text
  from public.document_chunks c join public.documents d on d.id = c.document_id
  where d.source_key like 'zz-sectest-%'
union all select 7, 'テスト用 Storage ファイル', count(*)::text
  from storage.objects where bucket_id = 'documents' and name like 'zz-sectest-%'
union all select 8, 'app_users 未登録の Auth ユーザー', count(*)::text
  from auth.users u where not exists (select 1 from public.app_users a where a.user_id = u.id)
union all select 9, 'internal 以外の文書（テスト用を除く）', count(*)::text
  from public.documents where visibility <> 'internal' and source_key not like 'zz-sectest-%'
union all select 10, '既存テストユーザーの is_active / role', coalesce(string_agg(is_active::text || ' / ' || role, ', '), '(なし)')
  from public.app_users
union all select 11, 'テスト用文書の ID（' || source_key || '）', id::text
  from public.documents where source_key like 'zz-sectest-%'
order by no;
