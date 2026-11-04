create extension if not exists vector with schema extensions;

create table public.kinfolk_users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique,
  display_name text not null,
  email text,
  phone_e164 text,
  phone_verified_at timestamptz,
  linkedin_url text,
  launch_market text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matching_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  status text not null default 'draft',
  target_markets text[] not null default array[]::text[],
  budget_min integer not null,
  budget_max integer not null,
  move_in_start date,
  move_in_end date,
  household_size_min integer not null default 2,
  household_size_max integer not null default 4,
  visibility_mode text not null default 'anonymous',
  completeness_score numeric(5, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matching_profiles_status_check check (status in ('draft', 'active', 'paused', 'matched')),
  constraint matching_profiles_visibility_check check (visibility_mode in ('anonymous', 'limited', 'approved'))
);

create table public.housing_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  profile_id uuid references public.matching_profiles(id) on delete cascade,
  neighborhoods text[] not null default array[]::text[],
  commute_notes text,
  pets text,
  must_haves text[] not null default array[]::text[],
  dealbreakers text[] not null default array[]::text[],
  flexibility_notes text,
  preference_embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roommate_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  profile_id uuid references public.matching_profiles(id) on delete cascade,
  lifestyle_notes text,
  cleanliness text,
  sleep_schedule text,
  social_energy text,
  hosting_expectations text,
  conflict_style text,
  dealbreakers text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matching_interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  profile_id uuid references public.matching_profiles(id) on delete set null,
  status text not null default 'not_started',
  channel text not null default 'voice',
  consent_recorded_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  transcript_path text,
  summary text,
  extraction_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matching_interviews_status_check check (status in ('not_started', 'scheduled', 'in_progress', 'completed', 'needs_review')),
  constraint matching_interviews_channel_check check (channel in ('voice', 'phone')),
  constraint matching_interviews_extraction_check check (extraction_status in ('pending', 'processing', 'ready', 'failed'))
);

create table public.match_queue_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  profile_id uuid references public.matching_profiles(id) on delete cascade,
  candidate_type text not null,
  title text not null,
  subtitle text not null,
  status text not null default 'suggested',
  fit_score numeric(5, 2) not null default 0,
  monthly_rent integer,
  evidence jsonb not null default '[]'::jsonb,
  tradeoffs jsonb not null default '[]'::jsonb,
  next_action text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint match_queue_items_candidate_type_check check (candidate_type in ('roommate_group', 'apartment', 'savings', 'intro')),
  constraint match_queue_items_status_check check (status in ('suggested', 'approved', 'passed', 'preparing', 'expired'))
);

create table public.agent_delegation_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  agent_identifier text not null,
  granted_scopes text[] not null default array[]::text[],
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.agent_action_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  agent_identifier text not null,
  tool_called text not null,
  input_hash text,
  result_summary text,
  approval_state text not null default 'not_required',
  called_at timestamptz not null default now(),
  constraint agent_action_log_approval_state_check check (approval_state in ('not_required', 'pending', 'approved', 'rejected'))
);

create index matching_profiles_user_id_idx on public.matching_profiles(user_id);
create index housing_preferences_user_id_idx on public.housing_preferences(user_id);
create index roommate_preferences_user_id_idx on public.roommate_preferences(user_id);
create index matching_interviews_user_status_idx on public.matching_interviews(user_id, status);
create index match_queue_items_user_status_idx on public.match_queue_items(user_id, status);
create index agent_delegation_consents_user_idx on public.agent_delegation_consents(user_id);
create index agent_action_log_user_called_at_idx on public.agent_action_log(user_id, called_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger kinfolk_users_set_updated_at
before update on public.kinfolk_users
for each row execute function public.set_updated_at();

create trigger matching_profiles_set_updated_at
before update on public.matching_profiles
for each row execute function public.set_updated_at();

create trigger housing_preferences_set_updated_at
before update on public.housing_preferences
for each row execute function public.set_updated_at();

create trigger roommate_preferences_set_updated_at
before update on public.roommate_preferences
for each row execute function public.set_updated_at();

create trigger matching_interviews_set_updated_at
before update on public.matching_interviews
for each row execute function public.set_updated_at();

create trigger match_queue_items_set_updated_at
before update on public.match_queue_items
for each row execute function public.set_updated_at();

alter table public.kinfolk_users enable row level security;
alter table public.matching_profiles enable row level security;
alter table public.housing_preferences enable row level security;
alter table public.roommate_preferences enable row level security;
alter table public.matching_interviews enable row level security;
alter table public.match_queue_items enable row level security;
alter table public.agent_delegation_consents enable row level security;
alter table public.agent_action_log enable row level security;

create policy "service role manages users"
on public.kinfolk_users for all
to service_role
using (true)
with check (true);

create policy "service role manages matching profiles"
on public.matching_profiles for all
to service_role
using (true)
with check (true);

create policy "service role manages housing preferences"
on public.housing_preferences for all
to service_role
using (true)
with check (true);

create policy "service role manages roommate preferences"
on public.roommate_preferences for all
to service_role
using (true)
with check (true);

create policy "service role manages matching interviews"
on public.matching_interviews for all
to service_role
using (true)
with check (true);

create policy "service role manages match queue"
on public.match_queue_items for all
to service_role
using (true)
with check (true);

create policy "service role manages agent consents"
on public.agent_delegation_consents for all
to service_role
using (true)
with check (true);

create policy "service role manages agent logs"
on public.agent_action_log for all
to service_role
using (true)
with check (true);

alter publication supabase_realtime add table public.matching_profiles;
alter publication supabase_realtime add table public.matching_interviews;
alter publication supabase_realtime add table public.match_queue_items;
alter publication supabase_realtime add table public.agent_action_log;
