alter table public.apartment_listings add column poi_summary jsonb;
alter table public.apartment_listings add column poi_enriched_at timestamptz;
