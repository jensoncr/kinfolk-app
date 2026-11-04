-- Align profile_embeddings with OpenRouter openai/text-embedding-3-small.
-- This replaces the unused deterministic/Ollama experiment with one aggregate
-- 1536-d profile vector per user.

delete from public.profile_embeddings;

drop index if exists public.profile_embeddings_embedding_hnsw_idx;
drop index if exists public.profile_embeddings_aggregate_unique_idx;
drop trigger if exists profile_embeddings_set_updated_at on public.profile_embeddings;

alter table public.profile_embeddings
  alter column embedding type extensions.vector(1536)
  using null::extensions.vector(1536);

alter table public.profile_embeddings
  add column if not exists content_hash text,
  add column if not exists source_fact_ids uuid[] not null default '{}'::uuid[],
  add column if not exists updated_at timestamptz not null default now();

create trigger profile_embeddings_set_updated_at
before update on public.profile_embeddings
for each row execute function public.set_updated_at();

create unique index if not exists profile_embeddings_aggregate_unique_idx
on public.profile_embeddings(user_id, dimension, embedding_model)
where fact_id is null;

create index if not exists profile_embeddings_embedding_hnsw_idx
on public.profile_embeddings
using hnsw (embedding extensions.vector_cosine_ops)
where embedding is not null;

create or replace function public.match_roommates_by_embedding(
  p_viewer_id uuid,
  p_query_embedding extensions.vector(1536),
  p_match_count int default 150,
  p_min_cosine double precision default 0.25,
  p_embedding_model text default 'openai/text-embedding-3-small'
)
returns table (
  user_id uuid,
  cosine_similarity double precision
)
language sql
stable
as $$
  select
    profile_embeddings.user_id,
    1 - (profile_embeddings.embedding <=> p_query_embedding) as cosine_similarity
  from public.profile_embeddings
  where profile_embeddings.fact_id is null
    and profile_embeddings.dimension = 'profile'
    and profile_embeddings.embedding_model = p_embedding_model
    and profile_embeddings.embedding is not null
    and profile_embeddings.user_id <> p_viewer_id
    and 1 - (profile_embeddings.embedding <=> p_query_embedding) >= p_min_cosine
  order by profile_embeddings.embedding <=> p_query_embedding
  limit least(greatest(p_match_count, 1), 500);
$$;
