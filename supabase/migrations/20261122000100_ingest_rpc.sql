-- =====================================================================
-- 取り込み用 RPC: 文書メタデータとチャンクを 1 トランザクションで置き換える
--  - documents を source_key で upsert
--  - 当該文書の既存チャンクを削除してから新チャンクを挿入（再取り込みで重複しない）
--  - security invoker: 実行者（service_role）の権限で動作する
--  - service_role 以外（public / anon / authenticated）は実行不可
-- 注意: 本番環境への適用は手動で確認してから行うこと。
-- =====================================================================

create function public.replace_document_with_chunks(p_document jsonb, p_chunks jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_document_id uuid;
begin
  if p_document is null or jsonb_typeof(p_document) <> 'object' then
    raise exception 'p_document must be an object';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception 'p_chunks must be a non-empty array';
  end if;
  -- 公開範囲は必ず明示させる（既定値に頼らない）
  if coalesce(p_document->>'visibility', '') = '' then
    raise exception 'visibility is required';
  end if;

  insert into public.documents (
    source_key, file_name, title, mime_type, content_hash, page_count,
    storage_path, visibility, department, embedding_model
  )
  values (
    p_document->>'source_key',
    p_document->>'file_name',
    p_document->>'title',
    p_document->>'mime_type',
    p_document->>'content_hash',
    (p_document->>'page_count')::integer,
    p_document->>'storage_path',
    p_document->>'visibility',
    p_document->>'department',
    p_document->>'embedding_model'
  )
  on conflict (source_key) do update set
    file_name       = excluded.file_name,
    title           = excluded.title,
    mime_type       = excluded.mime_type,
    content_hash    = excluded.content_hash,
    page_count      = excluded.page_count,
    storage_path    = excluded.storage_path,
    visibility      = excluded.visibility,
    department      = excluded.department,
    embedding_model = excluded.embedding_model,
    updated_at      = now()
  returning id into v_document_id;

  delete from public.document_chunks where document_id = v_document_id;

  insert into public.document_chunks (
    document_id, chunk_key, chunk_index, page_number, page_end, section,
    content, token_count, content_hash, embedding
  )
  select
    v_document_id,
    c->>'chunk_key',
    (c->>'chunk_index')::integer,
    (c->>'page_number')::integer,
    (c->>'page_end')::integer,
    c->>'section',
    c->>'content',
    (c->>'token_count')::integer,
    c->>'content_hash',
    (c->'embedding')::text::extensions.vector(1536)
  from jsonb_array_elements(p_chunks) as c;

  return v_document_id;
end;
$$;

revoke execute on function public.replace_document_with_chunks(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_document_with_chunks(jsonb, jsonb) to service_role;
