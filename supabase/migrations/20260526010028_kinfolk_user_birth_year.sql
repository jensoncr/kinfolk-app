alter table public.kinfolk_users
  add column if not exists birth_year integer,
  add constraint kinfolk_users_birth_year_check
    check (birth_year is null or birth_year between 1900 and 2100);
