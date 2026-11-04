alter table public.text_agent_runs
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists estimated_cost_usd numeric(12, 8),
  add column if not exists latency_ms integer,
  add column if not exists policy_outcome text,
  add column if not exists limit_bucket text,
  add column if not exists queued_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists extraction_result_json jsonb;

alter table public.text_agent_runs
  add constraint text_agent_runs_attempt_count_check check (attempt_count >= 0);

alter table public.text_agent_runs
  add constraint text_agent_runs_policy_outcome_check
  check (
    policy_outcome is null
    or policy_outcome in (
      'allowed_low_risk',
      'needs_review_sensitive',
      'blocked_protected',
      'unsupported',
      'rate_limited',
      'clarification_needed',
      'verified',
      'opted_out',
      'error'
    )
  );

alter table public.text_messages
  add column if not exists outbound_idempotency_key text;

create unique index if not exists text_messages_outbound_idempotency_unique
on public.text_messages(provider, outbound_idempotency_key)
where direction = 'outbound' and outbound_idempotency_key is not null;

create table if not exists public.text_agent_rate_limits (
  id uuid primary key default gen_random_uuid(),
  bucket_key text not null,
  bucket_type text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  cost_usd numeric(12, 8) not null default 0,
  last_hit_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint text_agent_rate_limits_count_check check (count >= 0),
  constraint text_agent_rate_limits_cost_check check (cost_usd >= 0),
  constraint text_agent_rate_limits_bucket_unique unique (bucket_type, bucket_key, window_start)
);

create table if not exists public.text_thread_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  thread_id uuid not null references public.text_threads(id) on delete cascade,
  summary_json jsonb not null default '{}'::jsonb,
  known_preferences_json jsonb not null default '{}'::jsonb,
  open_questions_json jsonb not null default '[]'::jsonb,
  updated_from_message_id uuid references public.text_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint text_thread_summaries_thread_unique unique (thread_id)
);

alter table public.text_thread_summaries
  add column if not exists user_id uuid references public.kinfolk_users(id) on delete cascade;

update public.text_thread_summaries summary
set user_id = thread.user_id
from public.text_threads thread
where summary.thread_id = thread.id
  and summary.user_id is null
  and thread.user_id is not null;

delete from public.text_thread_summaries
where user_id is null;

alter table public.text_thread_summaries
  alter column user_id set not null;

create table if not exists public.text_agent_eval_cases (
  id uuid primary key default gen_random_uuid(),
  input_text text not null,
  expected_facts_json jsonb not null default '[]'::jsonb,
  expected_policy_outcome text,
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create index if not exists text_agent_runs_queue_idx
on public.text_agent_runs(run_status, queued_at, next_retry_at)
where run_status = 'queued';

create index if not exists text_agent_runs_policy_idx
on public.text_agent_runs(policy_outcome, created_at desc);

create index if not exists text_agent_rate_limits_bucket_idx
on public.text_agent_rate_limits(bucket_type, bucket_key, window_start desc);

create index if not exists text_thread_summaries_user_thread_idx
on public.text_thread_summaries(user_id, thread_id);

create index if not exists text_agent_eval_cases_source_idx
on public.text_agent_eval_cases(source, created_at desc);

create or replace function public.hit_text_agent_rate_limit(
  p_bucket_type text,
  p_bucket_key text,
  p_window_start timestamptz,
  p_limit integer
)
returns table(allowed boolean, bucket_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  hit_count integer;
begin
  insert into public.text_agent_rate_limits (
    bucket_key,
    bucket_type,
    count,
    last_hit_at,
    window_start
  )
  values (
    p_bucket_key,
    p_bucket_type,
    1,
    now(),
    p_window_start
  )
  on conflict (bucket_type, bucket_key, window_start)
  do update
  set
    count = public.text_agent_rate_limits.count + 1,
    last_hit_at = now()
  where public.text_agent_rate_limits.count < p_limit
  returning count into hit_count;

  if hit_count is null then
    select count into hit_count
    from public.text_agent_rate_limits
    where bucket_type = p_bucket_type
      and bucket_key = p_bucket_key
      and window_start = p_window_start;

    return query select false, coalesce(hit_count, p_limit);
    return;
  end if;

  return query select hit_count <= p_limit, hit_count;
end;
$$;

grant execute on function public.hit_text_agent_rate_limit(text, text, timestamptz, integer)
to service_role;

create trigger text_agent_rate_limits_set_updated_at
before update on public.text_agent_rate_limits
for each row execute function public.set_updated_at();

create trigger text_thread_summaries_set_updated_at
before update on public.text_thread_summaries
for each row execute function public.set_updated_at();

alter table public.text_agent_rate_limits enable row level security;
alter table public.text_thread_summaries enable row level security;
alter table public.text_agent_eval_cases enable row level security;

create policy "service role manages text agent rate limits"
on public.text_agent_rate_limits for all
to service_role
using (true)
with check (true);

create policy "service role manages text thread summaries"
on public.text_thread_summaries for all
to service_role
using (true)
with check (true);

create policy "service role manages text agent eval cases"
on public.text_agent_eval_cases for all
to service_role
using (true)
with check (true);
