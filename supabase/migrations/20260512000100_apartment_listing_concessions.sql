alter table public.apartment_listings
  add column if not exists concession_lease_months numeric(4, 1) not null default 12,
  add column if not exists effective_monthly_rent integer;

alter table public.apartment_listing_units
  add column if not exists concession_months numeric(4, 2) not null default 0,
  add column if not exists concession_lease_months numeric(4, 1) not null default 12,
  add column if not exists concession_note text,
  add column if not exists effective_monthly_rent integer;

create index if not exists apartment_listings_active_effective_rent_idx
  on public.apartment_listings(provider_market, listing_status, effective_monthly_rent);

create index if not exists apartment_listing_units_effective_rent_idx
  on public.apartment_listing_units(listing_id, unit_status, effective_monthly_rent);
