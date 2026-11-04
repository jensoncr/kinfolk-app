-- Historical migration already applied to the hosted project. The following
-- migration, profile_embeddings_openai_1536, immediately supersedes this
-- 1024-d local embedding experiment for production matching.

delete from public.profile_embeddings;

drop index if exists public.profile_embeddings_embedding_hnsw_idx;
drop index if exists public.profile_embeddings_aggregate_unique_idx;

alter table public.profile_embeddings
  alter column embedding type extensions.vector(1024)
  using null::extensions.vector(1024);

alter table public.profile_embeddings
  add column if not exists source_fact_ids uuid[] not null default '{}'::uuid[],
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists profile_embeddings_aggregate_unique_idx
on public.profile_embeddings(user_id, dimension, embedding_model)
where fact_id is null;

create index if not exists profile_embeddings_embedding_hnsw_idx
on public.profile_embeddings
using hnsw (embedding vector_cosine_ops)
where embedding is not null;
