create table if not exists public.agent_context_documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  owner_user_id uuid references public.kinfolk_users(id) on delete cascade,
  subject_user_id uuid references public.kinfolk_users(id) on delete cascade,
  listing_id uuid references public.apartment_listings(id) on delete cascade,
  unit_id uuid references public.apartment_listing_units(id) on delete cascade,
  group_id uuid references public.apartment_roommate_groups(id) on delete cascade,
  thread_id uuid references public.text_threads(id) on delete cascade,
  visibility_scope text not null default 'service_only',
  status text not null default 'active',
  title text not null default '',
  summary text not null default '',
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '')
    )
  ) stored,
  embedding extensions.vector(1536),
  embedding_model text,
  content_hash text not null,
  source_version text not null default 'agent-context-v1',
  source_updated_at timestamptz,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_context_documents_entity_type_check
    check (entity_type in ('roommate_profile', 'roommate_fact', 'compatibility_edge', 'apartment_listing', 'apartment_unit', 'roommate_group', 'text_thread')),
  constraint agent_context_documents_visibility_check
    check (visibility_scope in ('service_only', 'owner_private', 'match_visible', 'public_listing')),
  constraint agent_context_documents_status_check
    check (status in ('active', 'stale', 'deleted'))
);

alter table public.agent_context_documents
  drop constraint if exists agent_context_documents_entity_unique;

create table if not exists public.agent_context_evidence (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.agent_context_documents(id) on delete cascade,
  claim_key text not null,
  claim_text text not null,
  source_table text,
  source_pk text,
  source_column text,
  source_json_path text,
  source_fact_ids uuid[] not null default array[]::uuid[],
  source_import_id uuid references public.profile_imports(id) on delete set null,
  text_message_id uuid references public.text_messages(id) on delete set null,
  thread_id uuid references public.text_threads(id) on delete set null,
  listing_id uuid references public.apartment_listings(id) on delete cascade,
  unit_id uuid references public.apartment_listing_units(id) on delete cascade,
  group_id uuid references public.apartment_roommate_groups(id) on delete cascade,
  external_source text,
  external_id text,
  source_url text,
  provider_payload_hash text,
  evidence_excerpt text,
  confidence numeric(4, 3) not null default 0.500,
  observed_at timestamptz,
  extracted_at timestamptz not null default now(),
  sensitivity_level text not null default 'standard',
  matching_eligible boolean not null default true,
  is_user_confirmed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agent_context_evidence_sensitivity_check
    check (sensitivity_level in ('standard', 'sensitive', 'protected', 'high_risk')),
  constraint agent_context_evidence_matching_sensitivity_check
    check (sensitivity_level = 'standard' or matching_eligible = false),
  constraint agent_context_evidence_confidence_check
    check (confidence >= 0 and confidence <= 1)
);

create index if not exists agent_context_documents_owner_idx
  on public.agent_context_documents(owner_user_id, entity_type, status, refreshed_at desc);

create unique index if not exists agent_context_documents_owned_entity_unique_idx
  on public.agent_context_documents(entity_type, entity_id, owner_user_id, source_version)
  where owner_user_id is not null;

create unique index if not exists agent_context_documents_global_entity_unique_idx
  on public.agent_context_documents(entity_type, entity_id, source_version)
  where owner_user_id is null;

create index if not exists agent_context_documents_subject_idx
  on public.agent_context_documents(subject_user_id, entity_type, status);

create index if not exists agent_context_documents_listing_idx
  on public.agent_context_documents(listing_id, entity_type, status);

create index if not exists agent_context_documents_search_idx
  on public.agent_context_documents using gin(search_vector);

create index if not exists agent_context_documents_embedding_idx
  on public.agent_context_documents using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create index if not exists agent_context_evidence_document_idx
  on public.agent_context_evidence(document_id, claim_key);

create index if not exists agent_context_evidence_listing_idx
  on public.agent_context_evidence(listing_id, matching_eligible);

create index if not exists agent_context_evidence_source_idx
  on public.agent_context_evidence(source_table, source_pk, source_column);

drop trigger if exists agent_context_documents_set_updated_at
on public.agent_context_documents;

create trigger agent_context_documents_set_updated_at
before update on public.agent_context_documents
for each row execute function public.set_updated_at();

alter table public.agent_context_documents enable row level security;
alter table public.agent_context_evidence enable row level security;

drop policy if exists "service role manages agent context documents"
on public.agent_context_documents;

create policy "service role manages agent context documents"
on public.agent_context_documents for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages agent context evidence"
on public.agent_context_evidence;

create policy "service role manages agent context evidence"
on public.agent_context_evidence for all
to service_role
using (true)
with check (true);
