create table if not exists public.apartment_roommate_groups (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.apartment_listings(id) on delete cascade,
  floor_plan_key text not null,
  floor_plan_name text not null,
  target_unit_name text,
  bedrooms numeric(4, 1),
  max_size integer not null,
  monthly_rent integer,
  status text not null default 'forming',
  source text not null default 'user',
  seed_key text,
  created_by_user_id uuid references public.kinfolk_users(id) on delete set null,
  preferences jsonb not null default '{}'::jsonb,
  match_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apartment_roommate_groups_status_check
    check (status in ('forming', 'ready', 'touring', 'closed')),
  constraint apartment_roommate_groups_source_check
    check (source in ('seeded', 'user')),
  constraint apartment_roommate_groups_max_size_check
    check (max_size between 1 and 8),
  constraint apartment_roommate_groups_floor_plan_key_check
    check (length(btrim(floor_plan_key)) > 0)
);

create table if not exists public.apartment_roommate_group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.apartment_roommate_groups(id) on delete cascade,
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  status text not null default 'requested',
  role text not null default 'member',
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apartment_roommate_group_memberships_status_check
    check (status in ('requested', 'member', 'left', 'declined', 'removed')),
  constraint apartment_roommate_group_memberships_role_check
    check (role in ('creator', 'member')),
  unique (group_id, user_id)
);

create unique index if not exists apartment_roommate_groups_seed_key_idx
  on public.apartment_roommate_groups(listing_id, floor_plan_key, seed_key)
  where seed_key is not null;

create index if not exists apartment_roommate_groups_listing_idx
  on public.apartment_roommate_groups(listing_id, floor_plan_key, status, updated_at desc);

create index if not exists apartment_roommate_groups_creator_idx
  on public.apartment_roommate_groups(created_by_user_id, status, updated_at desc)
  where created_by_user_id is not null;

create unique index if not exists apartment_roommate_groups_active_creator_plan_idx
  on public.apartment_roommate_groups(listing_id, floor_plan_key, created_by_user_id)
  where created_by_user_id is not null and status in ('forming', 'ready', 'touring');

create index if not exists apartment_roommate_group_memberships_group_idx
  on public.apartment_roommate_group_memberships(group_id, status);

create index if not exists apartment_roommate_group_memberships_user_idx
  on public.apartment_roommate_group_memberships(user_id, status, updated_at desc);

create trigger apartment_roommate_groups_set_updated_at
before update on public.apartment_roommate_groups
for each row execute function public.set_updated_at();

create trigger apartment_roommate_group_memberships_set_updated_at
before update on public.apartment_roommate_group_memberships
for each row execute function public.set_updated_at();

alter table public.apartment_roommate_groups enable row level security;
alter table public.apartment_roommate_group_memberships enable row level security;

create policy "service role manages apartment roommate groups"
on public.apartment_roommate_groups for all
to service_role
using (true)
with check (true);

create policy "service role manages apartment roommate group memberships"
on public.apartment_roommate_group_memberships for all
to service_role
using (true)
with check (true);

create or replace function public.kinfolk_fnv1a_32(input text)
returns bigint
language plpgsql
immutable
strict
as $$
declare
  h bigint := 2166136261;
  i integer;
begin
  for i in 1..length(input) loop
    h := ((h # ascii(substr(input, i, 1))) * 16777619) % 4294967296;
  end loop;
  return h;
end;
$$;

with eligible_listings as (
  select
    l.id as listing_id,
    l.address_line,
    l.provider_market,
    floor(coalesce(l.bedrooms, l.bedrooms_max, l.bedrooms_min, 0))::integer as bedrooms,
    coalesce(l.effective_monthly_rent, l.monthly_rent, l.rent_min, l.rent_max)::integer as monthly_rent
  from public.apartment_listings l
  where l.listing_status = 'active'
    and floor(coalesce(l.bedrooms, l.bedrooms_max, l.bedrooms_min, 0)) >= 2
    and public.kinfolk_fnv1a_32(l.id::text) % 4 = 0
),
listing_candidates as (
  select
    l.listing_id,
    l.address_line,
    l.bedrooms,
    l.monthly_rent,
    p.user_id,
    row_number() over (
      partition by l.listing_id
      order by public.kinfolk_fnv1a_32(l.listing_id::text || ':' || p.user_id::text)
    ) as candidate_rank
  from eligible_listings l
  join public.matching_profiles p
    on p.status = 'active'
   and p.target_markets @> array[l.provider_market]
   and p.budget_max is not null
   and least(4, l.bedrooms) between p.household_size_min and p.household_size_max
   and (
     l.monthly_rent is null
     or ceil(l.monthly_rent::numeric / least(4, l.bedrooms))::integer <= p.budget_max + 150
   )
),
selected_candidates as (
  select *
  from listing_candidates
  where candidate_rank <= greatest(1, least(4, bedrooms) - 1)
),
group_inputs as (
  select
    listing_id,
    address_line,
    bedrooms,
    monthly_rent,
    count(*) as member_count
  from selected_candidates
  group by listing_id, address_line, bedrooms, monthly_rent
),
inserted_groups as (
  insert into public.apartment_roommate_groups (
    listing_id,
    floor_plan_key,
    floor_plan_name,
    target_unit_name,
    bedrooms,
    max_size,
    monthly_rent,
    status,
    source,
    seed_key,
    preferences,
    match_summary
  )
  select
    listing_id,
    'kinfolk:whole-unit',
    address_line,
    null,
    bedrooms,
    least(4, bedrooms),
    monthly_rent,
    'forming',
    'seeded',
    'seeded:summary:0',
    '{}'::jsonb,
    null
  from group_inputs
  where member_count > 0
  on conflict do nothing
  returning id, listing_id
)
insert into public.apartment_roommate_group_memberships (
  group_id,
  user_id,
  status,
  role,
  approved_at
)
select
  g.id,
  c.user_id,
  'member',
  'member',
  now()
from inserted_groups g
join selected_candidates c on c.listing_id = g.listing_id
on conflict (group_id, user_id) do nothing;

do $$
begin
  alter publication supabase_realtime add table public.apartment_roommate_groups;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.apartment_roommate_group_memberships;
exception
  when duplicate_object then null;
end $$;
