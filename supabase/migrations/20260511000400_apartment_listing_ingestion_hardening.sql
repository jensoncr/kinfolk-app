alter table public.apartment_listings
  add column if not exists property_type text not null default 'apartment',
  add column if not exists listing_status text not null default 'active',
  add column if not exists provider_market text not null default 'unknown',
  add column if not exists rent_min integer,
  add column if not exists rent_max integer,
  add column if not exists bedrooms_min numeric(4, 1),
  add column if not exists bedrooms_max numeric(4, 1),
  add column if not exists bathrooms_min numeric(4, 1),
  add column if not exists bathrooms_max numeric(4, 1),
  add column if not exists lease_terms text[],
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists provider_payload jsonb not null default '{}'::jsonb,
  add column if not exists provider_payload_hash text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists inactive_at timestamptz,
  add column if not exists ingestion_run_id uuid;

alter table public.apartment_listings
  drop constraint if exists apartment_listings_source_check;

alter table public.apartment_listings
  add constraint apartment_listings_source_check
  check (external_source in ('redfin', 'zillow', 'mls_grid', 'reso_web_api', 'mits_feed', 'licensed_feed', 'manual_seed'));

alter table public.apartment_listings
  drop constraint if exists apartment_listings_listing_status_check;

alter table public.apartment_listings
  add constraint apartment_listings_listing_status_check
  check (listing_status in ('active', 'pending', 'inactive', 'unknown'));

alter table public.apartment_listing_photos
  add column if not exists provider_photo_id text,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists provider_payload jsonb not null default '{}'::jsonb;

create table if not exists public.apartment_listing_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  market text not null,
  source_url text,
  status text not null default 'running',
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  listings_seen integer not null default 0,
  listings_upserted integer not null default 0,
  listings_marked_inactive integer not null default 0,
  pages_fetched integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint apartment_listing_ingestion_runs_status_check
    check (status in ('running', 'completed', 'failed'))
);

create index if not exists apartment_listings_active_market_idx
  on public.apartment_listings(provider_market, listing_status, last_seen_at desc);

create index if not exists apartment_listings_source_market_idx
  on public.apartment_listings(external_source, provider_market, source_updated_at desc);

create index if not exists apartment_listings_payload_hash_idx
  on public.apartment_listings(provider_payload_hash);

create index if not exists apartment_listing_ingestion_runs_provider_market_idx
  on public.apartment_listing_ingestion_runs(provider, market, requested_at desc);

alter table public.apartment_listing_ingestion_runs enable row level security;

drop policy if exists "service role manages apartment listing ingestion runs"
on public.apartment_listing_ingestion_runs;

create policy "service role manages apartment listing ingestion runs"
on public.apartment_listing_ingestion_runs for all
to service_role
using (true)
with check (true);
