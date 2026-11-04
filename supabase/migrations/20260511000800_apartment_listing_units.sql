create table if not exists public.apartment_listing_units (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.apartment_listings(id) on delete cascade,
  provider_unit_id text not null,
  unit_name text,
  unit_status text not null default 'unknown',
  bedrooms numeric(4, 1),
  bathrooms numeric(4, 1),
  square_feet integer,
  monthly_rent integer,
  deposit integer,
  available_at date,
  amenities text[] not null default array[]::text[],
  provider_payload jsonb not null default '{}'::jsonb,
  provider_payload_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  inactive_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, provider_unit_id),
  constraint apartment_listing_units_status_check
    check (unit_status in ('available', 'unavailable', 'inactive', 'unknown'))
);

create index if not exists apartment_listing_units_listing_idx
  on public.apartment_listing_units(listing_id, unit_status, monthly_rent);

create index if not exists apartment_listing_units_seen_idx
  on public.apartment_listing_units(last_seen_at desc);

drop trigger if exists apartment_listing_units_set_updated_at on public.apartment_listing_units;

create trigger apartment_listing_units_set_updated_at
before update on public.apartment_listing_units
for each row execute function public.set_updated_at();

alter table public.apartment_listing_units enable row level security;

drop policy if exists "service role manages apartment listing units"
on public.apartment_listing_units;

create policy "service role manages apartment listing units"
on public.apartment_listing_units for all
to service_role
using (true)
with check (true);
