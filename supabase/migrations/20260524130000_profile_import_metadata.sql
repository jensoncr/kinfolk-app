alter table public.profile_imports
  add column if not exists import_metadata jsonb not null default '{}'::jsonb;
