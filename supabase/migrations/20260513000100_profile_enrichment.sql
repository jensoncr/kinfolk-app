create table public.profile_dimensions (
  key text primary key,
  label text not null,
  dimension_group text not null,
  data_type text not null default 'text',
  matching_role text not null,
  default_weight numeric(5, 4) not null default 0.1,
  sensitivity_level text not null default 'standard',
  created_at timestamptz not null default now(),
  constraint profile_dimensions_sensitivity_check check (sensitivity_level in ('standard', 'sensitive', 'protected', 'high_risk')),
  constraint profile_dimensions_role_check check (matching_role in ('hard_filter', 'similarity', 'complementarity', 'trust', 'explanation', 'blocked'))
);

create table public.profile_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  provider text not null,
  method text not null,
  source_label text,
  status text not null default 'draft',
  raw_payload jsonb not null,
  payload_hash text not null,
  schema_version text not null default 'profile-import-v1',
  consent_recorded_at timestamptz,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_imports_provider_check check (provider in ('claude', 'chatgpt', 'manual', 'mcp', 'mock', 'other')),
  constraint profile_imports_method_check check (method in ('paste', 'upload', 'mcp_tool', 'seed', 'system')),
  constraint profile_imports_status_check check (status in ('draft', 'processed', 'needs_review', 'approved', 'deleted', 'failed')),
  constraint profile_imports_user_payload_unique unique (user_id, payload_hash)
);

create table public.profile_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  source_import_id uuid not null references public.profile_imports(id) on delete cascade,
  dimension text not null,
  fact_key text not null,
  value_json jsonb not null,
  normalized_value text not null,
  assertion_type text not null default 'imported',
  confidence numeric(4, 3) not null default 0.500,
  importance numeric(4, 3) not null default 0.500,
  sensitivity_level text not null default 'standard',
  matching_eligible boolean not null default true,
  evidence_excerpt text,
  recency_at timestamptz,
  user_review_state text not null default 'pending',
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_facts_assertion_check check (assertion_type in ('explicit', 'inferred', 'imported', 'user_confirmed')),
  constraint profile_facts_sensitivity_check check (sensitivity_level in ('standard', 'sensitive', 'protected', 'high_risk')),
  constraint profile_facts_review_state_check check (user_review_state in ('pending', 'approved', 'edited', 'rejected', 'deleted', 'revoked')),
  constraint profile_facts_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint profile_facts_importance_check check (importance >= 0 and importance <= 1),
  constraint profile_facts_matching_sensitivity_check check (sensitivity_level = 'standard' or matching_eligible = false)
);

create table public.profile_fact_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  source_import_id uuid references public.profile_imports(id) on delete cascade,
  fact_a_id uuid references public.profile_facts(id) on delete cascade,
  fact_b_id uuid references public.profile_facts(id) on delete cascade,
  conflict_type text not null,
  resolution_state text not null default 'open',
  resolved_fact_id uuid references public.profile_facts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_fact_conflicts_type_check check (conflict_type in ('contradiction', 'stale', 'low_confidence', 'sensitive_proxy')),
  constraint profile_fact_conflicts_state_check check (resolution_state in ('open', 'ignored', 'resolved'))
);

create table public.profile_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  fact_id uuid references public.profile_facts(id) on delete cascade,
  dimension text not null,
  embedding vector(1536),
  embedding_text text not null,
  embedding_model text not null,
  created_at timestamptz not null default now()
);

create table public.compatibility_edges (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.kinfolk_users(id) on delete cascade,
  user_b_id uuid not null references public.kinfolk_users(id) on delete cascade,
  score numeric(5, 2) not null,
  score_components jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compatibility_edges_pair_check check (user_a_id <> user_b_id),
  constraint compatibility_edges_status_check check (status in ('active', 'stale', 'hidden')),
  constraint compatibility_edges_score_check check (score >= 0 and score <= 100),
  constraint compatibility_edges_pair_unique unique (user_a_id, user_b_id)
);

create table public.match_feedback_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid,
  compatibility_edge_id uuid references public.compatibility_edges(id) on delete set null,
  actor_user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  event_type text not null,
  reason_codes text[] not null default array[]::text[],
  free_text text,
  created_at timestamptz not null default now(),
  constraint match_feedback_events_type_check check (event_type in ('viewed', 'approved_intro', 'passed', 'saved', 'reported', 'post_intro_rating'))
);

create index profile_imports_user_status_idx on public.profile_imports(user_id, status, created_at desc);
create index profile_facts_user_review_idx on public.profile_facts(user_id, user_review_state, matching_eligible);
create index profile_facts_import_idx on public.profile_facts(source_import_id);
create index profile_facts_dimension_idx on public.profile_facts(dimension, fact_key);
create index profile_fact_conflicts_user_state_idx on public.profile_fact_conflicts(user_id, resolution_state);
create index profile_embeddings_user_dimension_idx on public.profile_embeddings(user_id, dimension);
create index compatibility_edges_user_a_idx on public.compatibility_edges(user_a_id, score desc);
create index compatibility_edges_user_b_idx on public.compatibility_edges(user_b_id, score desc);
create index match_feedback_events_actor_idx on public.match_feedback_events(actor_user_id, created_at desc);

create trigger profile_imports_set_updated_at
before update on public.profile_imports
for each row execute function public.set_updated_at();

create trigger profile_facts_set_updated_at
before update on public.profile_facts
for each row execute function public.set_updated_at();

create trigger profile_fact_conflicts_set_updated_at
before update on public.profile_fact_conflicts
for each row execute function public.set_updated_at();

create trigger compatibility_edges_set_updated_at
before update on public.compatibility_edges
for each row execute function public.set_updated_at();

alter table public.profile_dimensions enable row level security;
alter table public.profile_imports enable row level security;
alter table public.profile_facts enable row level security;
alter table public.profile_fact_conflicts enable row level security;
alter table public.profile_embeddings enable row level security;
alter table public.compatibility_edges enable row level security;
alter table public.match_feedback_events enable row level security;

create policy "service role manages profile dimensions"
on public.profile_dimensions for all
to service_role
using (true)
with check (true);

create policy "service role manages profile imports"
on public.profile_imports for all
to service_role
using (true)
with check (true);

create policy "service role manages profile facts"
on public.profile_facts for all
to service_role
using (true)
with check (true);

create policy "service role manages profile fact conflicts"
on public.profile_fact_conflicts for all
to service_role
using (true)
with check (true);

create policy "service role manages profile embeddings"
on public.profile_embeddings for all
to service_role
using (true)
with check (true);

create policy "service role manages compatibility edges"
on public.compatibility_edges for all
to service_role
using (true)
with check (true);

create policy "service role manages match feedback"
on public.match_feedback_events for all
to service_role
using (true)
with check (true);

insert into public.profile_dimensions (key, label, dimension_group, data_type, matching_role, default_weight, sensitivity_level)
values
  ('target_market', 'Target market', 'feasibility', 'text_array', 'hard_filter', 1.0000, 'standard'),
  ('budget', 'Budget', 'feasibility', 'number_range', 'hard_filter', 1.0000, 'standard'),
  ('move_in_window', 'Move-in window', 'feasibility', 'date_range', 'hard_filter', 1.0000, 'standard'),
  ('household_size', 'Household size', 'feasibility', 'number_range', 'hard_filter', 1.0000, 'standard'),
  ('pets', 'Pets', 'feasibility', 'text', 'hard_filter', 0.9000, 'standard'),
  ('sleep_schedule', 'Sleep schedule', 'daily_rhythm', 'text', 'similarity', 0.9000, 'standard'),
  ('work_from_home', 'Work-from-home pattern', 'daily_rhythm', 'text', 'similarity', 0.6500, 'standard'),
  ('noise_tolerance', 'Noise tolerance', 'environment_tolerance', 'text', 'similarity', 0.8500, 'standard'),
  ('cleanliness', 'Cleanliness', 'home_labor', 'text', 'similarity', 0.8500, 'standard'),
  ('chores', 'Chore style', 'home_labor', 'text', 'complementarity', 0.7000, 'standard'),
  ('guests', 'Guest expectations', 'social_boundary', 'text', 'similarity', 0.8000, 'standard'),
  ('social_energy', 'Home energy budget', 'social_boundary', 'text', 'similarity', 0.7000, 'standard'),
  ('communication_style', 'Communication style', 'communication', 'text', 'similarity', 0.8500, 'standard'),
  ('conflict_repair', 'Conflict repair pattern', 'communication', 'text', 'similarity', 0.8000, 'standard'),
  ('location_tradeoff', 'Location tradeoff', 'preference_elasticity', 'text', 'similarity', 0.5500, 'standard'),
  ('rent_tradeoff', 'Rent tradeoff', 'preference_elasticity', 'text', 'similarity', 0.5500, 'standard'),
  ('trust_context', 'Trust context', 'trust_context', 'text_array', 'trust', 0.6500, 'standard'),
  ('sensitive_profile', 'Sensitive profile detail', 'disallowed', 'text', 'blocked', 0.0000, 'sensitive'),
  ('protected_attribute', 'Protected attribute', 'disallowed', 'text', 'blocked', 0.0000, 'protected')
on conflict (key) do update set
  label = excluded.label,
  dimension_group = excluded.dimension_group,
  data_type = excluded.data_type,
  matching_role = excluded.matching_role,
  default_weight = excluded.default_weight,
  sensitivity_level = excluded.sensitivity_level;

do $$
begin
  begin
    alter publication supabase_realtime add table public.profile_imports;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.profile_facts;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.compatibility_edges;
  exception when duplicate_object then null;
  end;
end;
$$;
