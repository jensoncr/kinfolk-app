-- Two effective profile visibility states: 'public' (full profile visible on
-- listing groups and match recommendations) and everything else (anonymous
-- until unlocked by group acceptance or a mutual intro). 'limited'/'approved'
-- remain valid legacy values and behave as anonymous.
alter table matching_profiles
  drop constraint if exists matching_profiles_visibility_check;

alter table matching_profiles
  add constraint matching_profiles_visibility_check
  check (visibility_mode in ('anonymous', 'limited', 'approved', 'public'));
