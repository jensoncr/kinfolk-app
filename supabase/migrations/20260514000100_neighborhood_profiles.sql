create table public.neighborhood_profiles (
  id uuid primary key default gen_random_uuid(),
  market text not null,
  name text not null,
  display_name text not null,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  listing_count integer not null default 0,
  median_rent integer,
  rent_min integer,
  rent_max integer,
  bedroom_distribution jsonb not null default '{}'::jsonb,
  common_amenities text[] not null default array[]::text[],
  poi_summary jsonb,
  poi_enriched_at timestamptz,
  stats_computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market, name)
);

create index neighborhood_profiles_market_idx on public.neighborhood_profiles(market);

create trigger neighborhood_profiles_set_updated_at
before update on public.neighborhood_profiles
for each row execute function public.set_updated_at();

alter table public.neighborhood_profiles enable row level security;

create policy "service role manages neighborhood profiles"
on public.neighborhood_profiles for all
to service_role
using (true)
with check (true);

alter publication supabase_realtime add table public.neighborhood_profiles;
