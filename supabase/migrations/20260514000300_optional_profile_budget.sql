-- Allow a profile to save either side of the budget range independently.
alter table public.matching_profiles
  alter column budget_min drop not null,
  alter column budget_max drop not null;
