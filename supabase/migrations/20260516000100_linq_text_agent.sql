create table public.user_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  phone_e164 text not null,
  verified_at timestamptz,
  sms_consent_state text not null default 'not_collected',
  consent_source text,
  last_opt_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_phone_numbers_consent_check check (sms_consent_state in ('not_collected', 'opted_in', 'opted_out')),
  constraint user_phone_numbers_user_phone_unique unique (user_id, phone_e164),
  constraint user_phone_numbers_phone_unique unique (phone_e164)
);

create table public.phone_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  phone_number_id uuid references public.user_phone_numbers(id) on delete set null,
  provider text not null default 'linq',
  code_hash text not null,
  code_hint text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_verification_challenges_provider_check check (provider in ('linq')),
  constraint phone_verification_challenges_attempts_check check (attempt_count >= 0)
);

create table public.text_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.kinfolk_users(id) on delete cascade,
  phone_number_id uuid references public.user_phone_numbers(id) on delete set null,
  provider text not null default 'linq',
  provider_chat_id text,
  from_phone_e164 text not null,
  to_phone_e164 text not null,
  status text not null default 'active',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint text_threads_provider_check check (provider in ('linq')),
  constraint text_threads_status_check check (status in ('active', 'pending_verification', 'opted_out', 'archived')),
  constraint text_threads_provider_chat_unique unique (provider, provider_chat_id)
);

create table public.text_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.text_threads(id) on delete set null,
  user_id uuid references public.kinfolk_users(id) on delete cascade,
  phone_number_id uuid references public.user_phone_numbers(id) on delete set null,
  provider text not null default 'linq',
  provider_event_id text,
  provider_message_id text,
  provider_chat_id text,
  direction text not null,
  from_phone_e164 text not null,
  to_phone_e164 text not null,
  body text not null default '',
  media jsonb not null default '[]'::jsonb,
  delivery_status text,
  service text,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint text_messages_provider_check check (provider in ('linq')),
  constraint text_messages_direction_check check (direction in ('inbound', 'outbound')),
  constraint text_messages_event_unique unique (provider, provider_event_id)
);

create table public.text_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'linq',
  provider_event_id text not null,
  event_type text not null,
  trace_id text,
  status text not null default 'received',
  raw_payload jsonb not null,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint text_webhook_events_provider_check check (provider in ('linq')),
  constraint text_webhook_events_status_check check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  constraint text_webhook_events_provider_event_unique unique (provider, provider_event_id)
);

create table public.text_agent_runs (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.text_messages(id) on delete set null,
  user_id uuid references public.kinfolk_users(id) on delete cascade,
  thread_id uuid references public.text_threads(id) on delete set null,
  run_status text not null default 'queued',
  intent text not null,
  trace_id text,
  result_summary text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint text_agent_runs_status_check check (run_status in ('queued', 'running', 'completed', 'ignored', 'failed'))
);

create table public.profile_update_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  thread_id uuid references public.text_threads(id) on delete set null,
  source_import_id uuid references public.profile_imports(id) on delete cascade,
  summary text not null,
  patch_json jsonb not null,
  risk_level text not null default 'low',
  status text not null default 'pending',
  confirmation_token_hash text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_update_proposals_risk_check check (risk_level in ('low', 'medium', 'high')),
  constraint profile_update_proposals_status_check check (status in ('pending', 'approved', 'rejected', 'needs_review', 'expired'))
);

alter table public.profile_imports
  drop constraint if exists profile_imports_provider_check,
  add constraint profile_imports_provider_check check (provider in ('claude', 'chatgpt', 'manual', 'mcp', 'mock', 'other', 'linq'));

alter table public.profile_imports
  drop constraint if exists profile_imports_method_check,
  add constraint profile_imports_method_check check (method in ('paste', 'upload', 'mcp_tool', 'seed', 'system', 'text_message'));

create index user_phone_numbers_user_idx on public.user_phone_numbers(user_id);
create index phone_verification_challenges_code_idx on public.phone_verification_challenges(code_hash, expires_at) where used_at is null;
create index phone_verification_challenges_user_idx on public.phone_verification_challenges(user_id, created_at desc);
create index text_threads_user_idx on public.text_threads(user_id, last_message_at desc);
create index text_threads_phone_idx on public.text_threads(phone_number_id, last_message_at desc);
create index text_messages_thread_idx on public.text_messages(thread_id, received_at desc);
create index text_messages_user_idx on public.text_messages(user_id, received_at desc);
create index text_messages_provider_message_idx on public.text_messages(provider, provider_message_id);
create index text_webhook_events_type_idx on public.text_webhook_events(event_type, received_at desc);
create index text_agent_runs_user_idx on public.text_agent_runs(user_id, created_at desc);
create index profile_update_proposals_user_pending_idx on public.profile_update_proposals(user_id, status, created_at desc);

create trigger user_phone_numbers_set_updated_at
before update on public.user_phone_numbers
for each row execute function public.set_updated_at();

create trigger phone_verification_challenges_set_updated_at
before update on public.phone_verification_challenges
for each row execute function public.set_updated_at();

create trigger text_threads_set_updated_at
before update on public.text_threads
for each row execute function public.set_updated_at();

create trigger text_messages_set_updated_at
before update on public.text_messages
for each row execute function public.set_updated_at();

create trigger text_webhook_events_set_updated_at
before update on public.text_webhook_events
for each row execute function public.set_updated_at();

create trigger text_agent_runs_set_updated_at
before update on public.text_agent_runs
for each row execute function public.set_updated_at();

create trigger profile_update_proposals_set_updated_at
before update on public.profile_update_proposals
for each row execute function public.set_updated_at();

alter table public.user_phone_numbers enable row level security;
alter table public.phone_verification_challenges enable row level security;
alter table public.text_threads enable row level security;
alter table public.text_messages enable row level security;
alter table public.text_webhook_events enable row level security;
alter table public.text_agent_runs enable row level security;
alter table public.profile_update_proposals enable row level security;

create policy "service role manages user phone numbers"
on public.user_phone_numbers for all
to service_role
using (true)
with check (true);

create policy "service role manages phone verification challenges"
on public.phone_verification_challenges for all
to service_role
using (true)
with check (true);

create policy "service role manages text threads"
on public.text_threads for all
to service_role
using (true)
with check (true);

create policy "service role manages text messages"
on public.text_messages for all
to service_role
using (true)
with check (true);

create policy "service role manages text webhook events"
on public.text_webhook_events for all
to service_role
using (true)
with check (true);

create policy "service role manages text agent runs"
on public.text_agent_runs for all
to service_role
using (true)
with check (true);

create policy "service role manages profile update proposals"
on public.profile_update_proposals for all
to service_role
using (true)
with check (true);

do $$
begin
  begin
    alter publication supabase_realtime add table public.text_threads;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.text_messages;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.profile_update_proposals;
  exception when duplicate_object then null;
  end;
end
$$;
