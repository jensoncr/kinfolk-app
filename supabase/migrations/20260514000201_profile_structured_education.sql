-- Break Education into structured fields so the profile page can display
-- school / degree / major / graduation year separately.
alter table public.kinfolk_users
  add column if not exists education_school text,
  add column if not exists education_degree text,
  add column if not exists education_major text,
  add column if not exists education_year text;
