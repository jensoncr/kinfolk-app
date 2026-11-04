create table public.apartment_listings (
  id uuid primary key default gen_random_uuid(),
  external_source text not null,
  external_id text not null,
  source_url text,
  address_line text not null,
  unit text,
  city text not null,
  state text not null,
  postal_code text,
  neighborhood text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  monthly_rent integer not null,
  bedrooms numeric(4, 1) not null,
  bathrooms numeric(4, 1) not null,
  square_feet integer,
  available_at date,
  description text,
  amenities text[] not null default array[]::text[],
  no_fee boolean not null default false,
  concession_months numeric(4, 2) not null default 0,
  concession_note text,
  source_updated_at timestamptz,
  scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_source, external_id),
  constraint apartment_listings_source_check check (external_source in ('redfin', 'zillow', 'manual_seed'))
);

create table public.apartment_listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.apartment_listings(id) on delete cascade,
  url text not null,
  position integer not null default 0,
  alt text,
  created_at timestamptz not null default now()
);

create table public.apartment_listing_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  profile_id uuid references public.matching_profiles(id) on delete cascade,
  listing_id uuid not null references public.apartment_listings(id) on delete cascade,
  status text not null default 'suggested',
  fit_score numeric(5, 2) not null default 0,
  recommended_household_size integer not null default 1,
  per_person_rent integer not null,
  effective_per_person_rent integer not null,
  split_strategy text not null default 'equal',
  split_breakdown jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  tradeoffs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, profile_id, listing_id),
  constraint apartment_listing_matches_status_check check (status in ('suggested', 'saved', 'touring', 'passed', 'applied')),
  constraint apartment_listing_matches_split_strategy_check check (split_strategy in ('equal', 'income_weighted', 'room_weighted'))
);

create index apartment_listings_market_idx on public.apartment_listings(city, state, monthly_rent);
create index apartment_listings_geo_idx on public.apartment_listings(latitude, longitude);
create index apartment_listing_photos_listing_idx on public.apartment_listing_photos(listing_id, position);
create index apartment_listing_matches_user_status_idx on public.apartment_listing_matches(user_id, status);

create trigger apartment_listings_set_updated_at
before update on public.apartment_listings
for each row execute function public.set_updated_at();

create trigger apartment_listing_matches_set_updated_at
before update on public.apartment_listing_matches
for each row execute function public.set_updated_at();

alter table public.apartment_listings enable row level security;
alter table public.apartment_listing_photos enable row level security;
alter table public.apartment_listing_matches enable row level security;

create policy "service role manages apartment listings"
on public.apartment_listings for all
to service_role
using (true)
with check (true);

create policy "service role manages apartment listing photos"
on public.apartment_listing_photos for all
to service_role
using (true)
with check (true);

create policy "service role manages apartment listing matches"
on public.apartment_listing_matches for all
to service_role
using (true)
with check (true);

alter publication supabase_realtime add table public.apartment_listings;
alter publication supabase_realtime add table public.apartment_listing_matches;
