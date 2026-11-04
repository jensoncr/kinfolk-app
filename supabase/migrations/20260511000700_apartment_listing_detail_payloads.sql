alter table public.apartment_listings
  add column if not exists provider_detail_payload jsonb not null default '{}'::jsonb,
  add column if not exists provider_detail_payload_hash text,
  add column if not exists detail_enrichment_status text not null default 'pending',
  add column if not exists detail_enriched_at timestamptz,
  add column if not exists detail_enrichment_error text;

alter table public.apartment_listings
  drop constraint if exists apartment_listings_detail_enrichment_status_check;

alter table public.apartment_listings
  add constraint apartment_listings_detail_enrichment_status_check
  check (detail_enrichment_status in ('pending', 'ready', 'failed', 'skipped'));

create index if not exists apartment_listings_detail_enrichment_idx
  on public.apartment_listings(provider_market, detail_enrichment_status, detail_enriched_at);
