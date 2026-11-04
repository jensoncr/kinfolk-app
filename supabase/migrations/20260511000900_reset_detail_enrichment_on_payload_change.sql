create or replace function public.reset_apartment_listing_detail_enrichment()
returns trigger
language plpgsql
as $$
begin
  if old.provider_payload_hash is distinct from new.provider_payload_hash then
    new.detail_enrichment_status := 'pending';
    new.detail_enriched_at := null;
    new.detail_enrichment_error := null;
    new.provider_detail_payload := '{}'::jsonb;
    new.provider_detail_payload_hash := null;
  end if;

  return new;
end;
$$;

drop trigger if exists apartment_listings_reset_detail_enrichment on public.apartment_listings;

create trigger apartment_listings_reset_detail_enrichment
before update of provider_payload_hash on public.apartment_listings
for each row execute function public.reset_apartment_listing_detail_enrichment();
