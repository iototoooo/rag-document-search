-- =====================================================================
-- 社内文書検索AI（RAG）基本スキーマ
--  - pgvector によるチャンク検索
--  - RLS: 認可済みユーザー（app_users.is_active）だけが、閲覧可能な文書のみ参照できる
--  - MVP では visibility = 'internal' の文書だけを閲覧可能とし、
--    'department' / 'restricted' はどのポリシーでも許可しない（権限検証完了まで利用対象外）
--  - 書き込みは service_role（取り込み CLI）のみ。authenticated / anon に書き込み権限なし
-- 注意: 本番環境への適用は手動で確認してから行うこと。
-- =====================================================================

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- 利用許可ユーザー（管理者がダッシュボード / service_role で登録する）
-- ---------------------------------------------------------------------
create table public.app_users (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  is_active   boolean not null default false,
  role        text not null default 'member' check (role in ('member', 'admin')),
  departments text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.app_users enable row level security;

-- 自分の行だけ参照可。insert / update / delete のポリシーは作らない（= 不可）
create policy app_users_select_self on public.app_users
  for select to authenticated
  using (user_id = (select auth.uid()));

-- RLS ポリシー内で使う認可判定。security definer だが、参照するのは呼び出しユーザー自身の行のみ。
create function public.is_active_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_users
    where user_id = (select auth.uid()) and is_active
  );
$$;

revoke execute on function public.is_active_app_user() from public, anon;
grant execute on function public.is_active_app_user() to authenticated;

-- ---------------------------------------------------------------------
-- 文書
-- ---------------------------------------------------------------------
create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  source_key      text not null unique,
  file_name       text not null,
  title           text not null,
  mime_type       text not null check (mime_type in ('application/pdf', 'text/markdown')),
  content_hash    text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  page_count      integer check (page_count is null or page_count > 0),
  storage_path    text unique,
  -- 既定は最も厳しい 'restricted'。取り込み時に明示的に 'internal' を指定した文書だけが検索対象
  visibility      text not null default 'restricted'
                  check (visibility in ('internal', 'department', 'restricted')),
  department      text,
  embedding_model text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.documents enable row level security;

create policy documents_select_internal on public.documents
  for select to authenticated
  using (visibility = 'internal' and (select public.is_active_app_user()));

-- ---------------------------------------------------------------------
-- チャンク
-- ---------------------------------------------------------------------
create table public.document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents (id) on delete cascade,
  chunk_key    text not null unique,
  chunk_index  integer not null check (chunk_index >= 0),
  page_number  integer not null check (page_number >= 1),
  page_end     integer not null,
  section      text,
  content      text not null,
  token_count  integer not null check (token_count > 0),
  content_hash text not null,
  embedding    extensions.vector(1536) not null,
  created_at   timestamptz not null default now(),
  unique (document_id, chunk_index),
  check (page_end >= page_number)
);

create index document_chunks_document_id_idx on public.document_chunks (document_id);
create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.document_chunks enable row level security;

-- 親文書が見える場合のみチャンクも見える（サブクエリ側にも documents の RLS が適用される）
create policy document_chunks_select_visible on public.document_chunks
  for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));

-- ---------------------------------------------------------------------
-- 権限の明示（anon には一切付与しない）
-- ---------------------------------------------------------------------
-- Supabase の既定権限（anon / authenticated への ALL 付与）を打ち消し、
-- authenticated には SELECT のみを付与する（行の可視範囲は RLS で制御）
revoke all on public.app_users, public.documents, public.document_chunks from public, anon, authenticated;
grant select on public.app_users, public.documents, public.document_chunks to authenticated;

-- ---------------------------------------------------------------------
-- ベクトル検索関数
-- security invoker: 呼び出しユーザーの権限で実行されるため RLS を迂回しない。
-- 閲覧不可の文書は結果に一切含まれず、件数・存在も推測できない。
-- ---------------------------------------------------------------------
create function public.match_document_chunks(
  query_embedding extensions.vector(1536),
  match_threshold double precision,
  match_count integer
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  chunk_key   text,
  file_name   text,
  title       text,
  page_number integer,
  section     text,
  content     text,
  similarity  double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.document_id,
    c.chunk_key,
    d.file_name,
    d.title,
    c.page_number,
    c.section,
    c.content,
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where 1 - (c.embedding operator(extensions.<=>) query_embedding) >= greatest(match_threshold, 0)
  order by c.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke execute on function public.match_document_chunks(extensions.vector, double precision, integer) from public, anon;
grant execute on function public.match_document_chunks(extensions.vector, double precision, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 原本 PDF 用の非公開 Storage バケット
-- 公開 URL は発行しない。閲覧は Route Handler 経由でユーザー権限のクライアントからのみ。
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 20971520, array['application/pdf', 'text/markdown'])
on conflict (id) do update set public = false;

create policy documents_bucket_select_visible on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (select 1 from public.documents d where d.storage_path = storage.objects.name)
  );
-- insert / update / delete ポリシーは作らない（service_role のみがアップロード可能）
