-- Self-serve profile fields editable by the user on /me/profile.
alter table public.kinfolk_users
  add column if not exists about_text text,
  add column if not exists interests text[] not null default array[]::text[],
  add column if not exists occupation_title text,
  add column if not exists occupation_company text,
  add column if not exists education_summary text;

create table if not exists public.kinfolk_user_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  position integer not null default 0,
  is_primary boolean not null default false,
  width integer,
  height integer,
  content_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists kinfolk_user_photos_user_position_idx
  on public.kinfolk_user_photos (user_id, position);

create index if not exists kinfolk_user_photos_user_idx
  on public.kinfolk_user_photos (user_id);

create trigger kinfolk_user_photos_set_updated_at
before update on public.kinfolk_user_photos
for each row execute function public.set_updated_at();

alter table public.kinfolk_user_photos enable row level security;

create policy "service role manages user photos"
on public.kinfolk_user_photos for all
to service_role
using (true)
with check (true);

-- Public bucket so profile photos render via direct URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  true,
  10485760, -- 10 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The Next.js server uses the service-role key for uploads, so only the
-- service-role bypass policy is required. Public reads work through the
-- bucket's public flag.
drop policy if exists "service role manages profile photo objects" on storage.objects;
create policy "service role manages profile photo objects"
on storage.objects for all
to service_role
using (bucket_id = 'profile-photos')
with check (bucket_id = 'profile-photos');
