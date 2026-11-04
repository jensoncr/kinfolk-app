-- Typed-first work/school entry: the picker stores the resolved organization
-- domain alongside the label. The domain is the stable key (two people who
-- both picked "Blue Harbor" share blueharbor.com regardless of how they typed
-- it); the logo URL is a rendering cache we re-host ourselves so profile views
-- never hotlink a third-party CDN.

alter table public.kinfolk_users
  add column if not exists occupation_company_domain text,
  add column if not exists occupation_company_logo_url text,
  add column if not exists education_school_domain text,
  add column if not exists education_school_logo_url text;

comment on column public.kinfolk_users.occupation_company_domain is
  'Resolved employer domain (e.g. blueharbor.com) from the org picker. Null when the user typed a free-text company.';
comment on column public.kinfolk_users.education_school_domain is
  'Resolved school domain (e.g. nd.edu) from the org picker. Null when the user typed a free-text school.';

-- Same-employer / same-school lookups run off the domain.
create index if not exists kinfolk_users_occupation_company_domain_idx
  on public.kinfolk_users (occupation_company_domain)
  where occupation_company_domain is not null;

create index if not exists kinfolk_users_education_school_domain_idx
  on public.kinfolk_users (education_school_domain)
  where education_school_domain is not null;

-- Public bucket so org logos render via direct URL. Keyed by domain, so one
-- fetch serves every user at that organization.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-logos',
  'org-logos',
  true,
  1048576, -- 1 MiB
  -- No SVG: these bytes come from a third party and are served from a public
  -- origin at a guessable URL, where direct navigation would execute any script
  -- the document carries.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "service role manages org logo objects" on storage.objects;
create policy "service role manages org logo objects"
on storage.objects for all
to service_role
using (bucket_id = 'org-logos')
with check (bucket_id = 'org-logos');
