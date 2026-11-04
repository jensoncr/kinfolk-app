-- Atomic single-key merge into apartment_listings.provider_detail_payload.
--
-- rent-context's RentCast cache previously read the whole provider_detail_payload
-- JSON column, spread a new `rentcast` key in, and wrote the entire column back.
-- Two concurrent rent-context resolutions for the same listing — or a concurrent
-- detail scraper writing a different sub-key — would read the same old payload
-- and the last writer would clobber the other's changes (lost update).
--
-- This RPC sets exactly one top-level key via jsonb_set in a single statement, so
-- concurrent writers to distinct keys no longer lose each other's data. It does
-- NOT touch provider_payload_hash, so the detail-enrichment reset trigger
-- (which fires `before update of provider_payload_hash`) is not triggered.
create or replace function public.merge_listing_provider_detail_payload(
  p_listing_id uuid,
  p_key text,
  p_value jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.apartment_listings
  set provider_detail_payload = jsonb_set(
    coalesce(provider_detail_payload, '{}'::jsonb),
    array[p_key],
    p_value,
    true
  )
  where id = p_listing_id;
$$;

grant execute on function public.merge_listing_provider_detail_payload(uuid, text, jsonb)
to service_role;
