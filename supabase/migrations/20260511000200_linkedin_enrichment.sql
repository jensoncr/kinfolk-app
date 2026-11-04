create table public.professional_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  linkedin_provider_user_id text,
  linkedin_url text,
  headline text,
  resume_status text not null default 'missing',
  salary_target integer,
  work_mode text not null default 'Unknown',
  start_date text not null default '',
  startup_grind text not null default 'not_sure',
  experiences jsonb not null default '[]'::jsonb,
  education jsonb not null default '[]'::jsonb,
  recent_interactions text[] not null default array[]::text[],
  enrichment_status text not null default 'not_started',
  review_status text not null default 'pending',
  source_provider text,
  source_confidence numeric(5, 2),
  last_enrichment_error text,
  enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_profiles_user_unique unique (user_id),
  constraint professional_profiles_resume_status_check check (resume_status in ('missing', 'uploaded')),
  constraint professional_profiles_startup_grind_check check (startup_grind in ('no', 'not_sure', 'yes')),
  constraint professional_profiles_enrichment_status_check check (
    enrichment_status in ('not_started', 'queued', 'running', 'ready', 'failed', 'skipped', 'source_not_configured')
  ),
  constraint professional_profiles_review_status_check check (review_status in ('pending', 'needs_review', 'reviewed'))
);

create table public.linkedin_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  clerk_user_id text not null,
  provider_user_id text,
  linkedin_url text,
  email text,
  display_name text,
  image_url text,
  idempotency_key text not null unique,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  last_error text,
  locked_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkedin_enrichment_jobs_status_check check (status in ('queued', 'running', 'ready', 'failed', 'skipped'))
);

create table public.profile_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  job_id uuid references public.linkedin_enrichment_jobs(id) on delete set null,
  provider text not null,
  lookup_key_hash text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  payload_version text not null default 'v1',
  created_at timestamptz not null default now()
);

create index professional_profiles_user_id_idx on public.professional_profiles(user_id);
create index professional_profiles_status_idx on public.professional_profiles(enrichment_status, updated_at desc);
create index linkedin_enrichment_jobs_status_idx
  on public.linkedin_enrichment_jobs(status, next_attempt_at, created_at);
create index linkedin_enrichment_jobs_user_idx on public.linkedin_enrichment_jobs(user_id, created_at desc);
create index profile_source_snapshots_user_idx on public.profile_source_snapshots(user_id, created_at desc);

create trigger professional_profiles_set_updated_at
before update on public.professional_profiles
for each row execute function public.set_updated_at();

create trigger linkedin_enrichment_jobs_set_updated_at
before update on public.linkedin_enrichment_jobs
for each row execute function public.set_updated_at();

alter table public.professional_profiles enable row level security;
alter table public.linkedin_enrichment_jobs enable row level security;
alter table public.profile_source_snapshots enable row level security;

create policy "service role manages professional profiles"
on public.professional_profiles for all
to service_role
using (true)
with check (true);

create policy "service role manages linkedin enrichment jobs"
on public.linkedin_enrichment_jobs for all
to service_role
using (true)
with check (true);

create policy "service role manages profile source snapshots"
on public.profile_source_snapshots for all
to service_role
using (true)
with check (true);

do $$
begin
  alter publication supabase_realtime add table public.professional_profiles;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.linkedin_enrichment_jobs;
exception
  when duplicate_object then null;
end $$;
