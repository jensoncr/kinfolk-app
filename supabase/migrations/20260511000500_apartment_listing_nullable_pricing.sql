alter table public.apartment_listings
  alter column monthly_rent drop not null,
  alter column bedrooms drop not null,
  alter column bathrooms drop not null;
