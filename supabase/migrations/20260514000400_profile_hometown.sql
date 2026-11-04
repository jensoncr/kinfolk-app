-- Free-text hometown ("city, state") for the profile. Distinct from
-- launch_market: launch_market is where the user wants to live next;
-- hometown is where they're from.
alter table public.kinfolk_users
  add column if not exists hometown text;
