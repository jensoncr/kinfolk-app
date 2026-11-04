create unique index if not exists apartment_listing_ingestion_runs_one_running_idx
  on public.apartment_listing_ingestion_runs(provider, market)
  where status = 'running';
