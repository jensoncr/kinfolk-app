alter table public.roommate_preferences
  add column if not exists preferred_age_min integer,
  add column if not exists preferred_age_max integer,
  add column if not exists preferred_age_strict boolean not null default false,
  add constraint roommate_preferences_preferred_age_min_check
    check (preferred_age_min is null or preferred_age_min between 18 and 100),
  add constraint roommate_preferences_preferred_age_max_check
    check (preferred_age_max is null or preferred_age_max between 18 and 100),
  add constraint roommate_preferences_preferred_age_range_check
    check (
      preferred_age_min is null
      or preferred_age_max is null
      or preferred_age_min <= preferred_age_max
    );
