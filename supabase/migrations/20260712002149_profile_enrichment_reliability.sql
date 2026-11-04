-- Keep assistant-import provenance available for review and recency-aware scoring.
alter table public.profile_facts
  add column if not exists source_type text,
  add column if not exists observed_vs_self_reported text,
  add column if not exists recency_hint text;

-- A failed ingestion is retryable. Only active, successfully persisted imports
-- should prevent the same payload from being submitted again.
drop index if exists public.profile_imports_user_payload_active_unique;

create unique index if not exists profile_imports_user_payload_active_unique
on public.profile_imports(user_id, payload_hash)
where status not in ('deleted', 'failed');

-- Profile questions are TCPA-sensitive and therefore remain explicitly opt-in.
alter table public.match_notification_prefs
  add column if not exists profile_questions_enabled boolean not null default false;

alter table public.match_notifications
  drop constraint if exists match_notifications_kind_check;

alter table public.match_notifications
  add constraint match_notifications_kind_check
  check (kind in ('apartment_match', 'roommate_match', 'group_ready', 'profile_question'));

-- Projection and compatibility refreshes are durable. Request writes enqueue
-- work synchronously; Next after() and the cron route both consume this queue.
create table if not exists public.profile_matching_refresh_jobs (
  user_id uuid primary key references public.kinfolk_users(id) on delete cascade,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  requested_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_matching_refresh_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  constraint profile_matching_refresh_jobs_attempt_count_check
    check (attempt_count >= 0)
);

create index if not exists profile_matching_refresh_jobs_due_idx
on public.profile_matching_refresh_jobs(status, next_attempt_at, requested_at);

drop trigger if exists profile_matching_refresh_jobs_set_updated_at
on public.profile_matching_refresh_jobs;

create trigger profile_matching_refresh_jobs_set_updated_at
before update on public.profile_matching_refresh_jobs
for each row execute function public.set_updated_at();

alter table public.profile_matching_refresh_jobs enable row level security;

drop policy if exists "service role manages profile matching refresh jobs"
on public.profile_matching_refresh_jobs;

create policy "service role manages profile matching refresh jobs"
on public.profile_matching_refresh_jobs for all
to service_role
using (true)
with check (true);

create or replace function public.enqueue_profile_matching_refresh(p_user_id uuid)
returns public.profile_matching_refresh_jobs
language sql
security invoker
set search_path = public
as $$
  insert into public.profile_matching_refresh_jobs (
    user_id,
    status,
    attempt_count,
    requested_at,
    next_attempt_at,
    locked_at,
    completed_at,
    last_error
  ) values (
    p_user_id,
    'queued',
    0,
    now(),
    now(),
    null,
    null,
    null
  )
  on conflict (user_id) do update set
    status = 'queued',
    attempt_count = 0,
    requested_at = now(),
    next_attempt_at = now(),
    locked_at = null,
    completed_at = null,
    last_error = null
  returning *;
$$;

create or replace function public.claim_profile_matching_refresh_jobs(p_limit integer default 25)
returns setof public.profile_matching_refresh_jobs
language sql
security invoker
set search_path = public
as $$
  with candidates as (
    select jobs.user_id
    from public.profile_matching_refresh_jobs as jobs
    where (
      jobs.status = 'queued'
      and jobs.next_attempt_at <= now()
    ) or (
      jobs.status = 'running'
      and jobs.locked_at <= now() - interval '10 minutes'
    )
    order by jobs.next_attempt_at asc, jobs.requested_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 200))
  )
  update public.profile_matching_refresh_jobs as jobs
  set
    status = 'running',
    attempt_count = jobs.attempt_count + 1,
    locked_at = now(),
    completed_at = null,
    last_error = null
  from candidates
  where jobs.user_id = candidates.user_id
  returning jobs.*;
$$;

revoke all on function public.enqueue_profile_matching_refresh(uuid) from public, anon, authenticated;
revoke all on function public.claim_profile_matching_refresh_jobs(integer) from public, anon, authenticated;
grant execute on function public.enqueue_profile_matching_refresh(uuid) to service_role;
grant execute on function public.claim_profile_matching_refresh_jobs(integer) to service_role;
