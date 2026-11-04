-- The living plan is the durable intent object behind /me/plan: where + when a
-- person wants to live, and how ready they are to move. One row per user.
create table if not exists public.living_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  future_cities text[] not null default array[]::text[],
  preferred_areas text[] not null default array[]::text[],
  move_horizon text,
  relocation_flexibility text,
  intent_note text,
  silent_matcher_enabled boolean not null default false,
  intent_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint living_plans_user_unique unique (user_id),
  constraint living_plans_move_horizon_check
    check (move_horizon is null or move_horizon in ('now', 'lt_3mo', '3_6mo', '6_12mo', '1_2yr', 'exploring')),
  constraint living_plans_relocation_flexibility_check
    check (relocation_flexibility is null or relocation_flexibility in ('locked', 'some', 'flexible', 'ready'))
);

-- Saved listings + saved areas: a person's taste signal, captured from the web
-- the same way SMS captures listing reactions. Feeds matching later.
create table if not exists public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  kind text not null,
  listing_id uuid references public.apartment_listings(id) on delete cascade,
  area_label text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_places_kind_check check (kind in ('listing', 'area')),
  constraint saved_places_target_check check (
    (kind = 'listing' and listing_id is not null and area_label is null) or
    (kind = 'area' and area_label is not null and listing_id is null)
  )
);

create unique index if not exists saved_places_user_listing_idx
  on public.saved_places(user_id, listing_id)
  where listing_id is not null;

create unique index if not exists saved_places_user_area_idx
  on public.saved_places(user_id, lower(area_label))
  where area_label is not null;

create index if not exists saved_places_user_idx
  on public.saved_places(user_id, created_at desc);

create index if not exists living_plans_user_idx
  on public.living_plans(user_id);

drop trigger if exists living_plans_set_updated_at on public.living_plans;
create trigger living_plans_set_updated_at
before update on public.living_plans
for each row execute function public.set_updated_at();

drop trigger if exists saved_places_set_updated_at on public.saved_places;
create trigger saved_places_set_updated_at
before update on public.saved_places
for each row execute function public.set_updated_at();

alter table public.living_plans enable row level security;
alter table public.saved_places enable row level security;

drop policy if exists "service role manages living plans" on public.living_plans;
create policy "service role manages living plans"
on public.living_plans for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages saved places" on public.saved_places;
create policy "service role manages saved places"
on public.saved_places for all
to service_role
using (true)
with check (true);
