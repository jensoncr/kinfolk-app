create table if not exists public.contact_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  source text not null default 'manual',
  status text not null default 'processed',
  consent_text text not null default '',
  contact_count integer not null default 0,
  selected_count integer not null default 0,
  source_metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_import_batches_source_check
    check (source in ('browser_picker', 'computer_contacts', 'csv', 'google', 'manual', 'microsoft', 'paste', 'vcard')),
  constraint contact_import_batches_status_check
    check (status in ('processed', 'deleted', 'failed')),
  constraint contact_import_batches_contact_count_check
    check (contact_count >= 0),
  constraint contact_import_batches_selected_count_check
    check (selected_count >= 0)
);

create table if not exists public.user_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  import_batch_id uuid references public.contact_import_batches(id) on delete set null,
  contact_key text not null,
  display_name text not null,
  primary_email text,
  primary_phone_e164 text,
  emails jsonb not null default '[]'::jsonb,
  phones jsonb not null default '[]'::jsonb,
  email_hashes text[] not null default array[]::text[],
  phone_hashes text[] not null default array[]::text[],
  matched_user_id uuid references public.kinfolk_users(id) on delete set null,
  trust_state text not null default 'imported',
  source text not null default 'manual',
  last_invited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_contacts_display_name_check
    check (length(btrim(display_name)) > 0),
  constraint user_contacts_trust_state_check
    check (trust_state in ('imported', 'matched', 'invited', 'blocked', 'deleted')),
  constraint user_contacts_source_check
    check (source in ('browser_picker', 'computer_contacts', 'csv', 'google', 'manual', 'microsoft', 'paste', 'vcard')),
  unique (owner_user_id, contact_key)
);

create table if not exists public.kinfolk_social_edges (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.kinfolk_users(id) on delete cascade,
  user_b_id uuid not null references public.kinfolk_users(id) on delete cascade,
  edge_type text not null default 'contact_import',
  created_by_user_id uuid references public.kinfolk_users(id) on delete set null,
  source_contact_id uuid references public.user_contacts(id) on delete set null,
  strength numeric(4, 3) not null default 0.500,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kinfolk_social_edges_pair_check
    check (user_a_id <> user_b_id),
  constraint kinfolk_social_edges_order_check
    check (user_a_id < user_b_id),
  constraint kinfolk_social_edges_type_check
    check (edge_type in ('contact_import', 'invite', 'vouch', 'shared_contact')),
  constraint kinfolk_social_edges_status_check
    check (status in ('active', 'hidden', 'deleted')),
  constraint kinfolk_social_edges_strength_check
    check (strength >= 0 and strength <= 1),
  unique (user_a_id, user_b_id, edge_type, created_by_user_id)
);

create table if not exists public.roommate_contact_groups (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  listing_id uuid references public.apartment_listings(id) on delete set null,
  apartment_group_id uuid references public.apartment_roommate_groups(id) on delete set null,
  share_token text not null unique,
  label text not null,
  target_household_size integer not null default 2,
  status text not null default 'planning',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roommate_contact_groups_household_size_check
    check (target_household_size between 1 and 8),
  constraint roommate_contact_groups_status_check
    check (status in ('planning', 'inviting', 'attached', 'archived'))
);

create table if not exists public.roommate_contact_group_members (
  id uuid primary key default gen_random_uuid(),
  contact_group_id uuid not null references public.roommate_contact_groups(id) on delete cascade,
  contact_id uuid not null references public.user_contacts(id) on delete cascade,
  matched_user_id uuid references public.kinfolk_users(id) on delete set null,
  role text not null default 'invitee',
  status text not null default 'selected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roommate_contact_group_members_role_check
    check (role in ('invitee', 'member')),
  constraint roommate_contact_group_members_status_check
    check (status in ('selected', 'invited', 'accepted', 'declined', 'removed')),
  unique (contact_group_id, contact_id)
);

create table if not exists public.roommate_contact_invites (
  id uuid primary key default gen_random_uuid(),
  contact_group_id uuid not null references public.roommate_contact_groups(id) on delete cascade,
  contact_id uuid references public.user_contacts(id) on delete set null,
  inviter_user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  listing_id uuid references public.apartment_listings(id) on delete set null,
  apartment_group_id uuid references public.apartment_roommate_groups(id) on delete set null,
  invite_token text not null unique,
  channel text not null default 'share_link',
  destination_label text,
  status text not null default 'ready',
  message text,
  sent_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roommate_contact_invites_channel_check
    check (channel in ('email', 'sms', 'share_link')),
  constraint roommate_contact_invites_status_check
    check (status in ('draft', 'ready', 'sent', 'accepted', 'revoked'))
);

create index if not exists contact_import_batches_user_idx
  on public.contact_import_batches(user_id, imported_at desc);

create index if not exists user_contacts_owner_idx
  on public.user_contacts(owner_user_id, updated_at desc)
  where deleted_at is null;

create index if not exists user_contacts_matched_user_idx
  on public.user_contacts(matched_user_id)
  where matched_user_id is not null and deleted_at is null;

create index if not exists user_contacts_email_hashes_idx
  on public.user_contacts using gin(email_hashes);

create index if not exists user_contacts_phone_hashes_idx
  on public.user_contacts using gin(phone_hashes);

create index if not exists kinfolk_social_edges_user_a_idx
  on public.kinfolk_social_edges(user_a_id, status, strength desc);

create index if not exists kinfolk_social_edges_user_b_idx
  on public.kinfolk_social_edges(user_b_id, status, strength desc);

create index if not exists roommate_contact_groups_owner_idx
  on public.roommate_contact_groups(owner_user_id, updated_at desc);

create index if not exists roommate_contact_group_members_group_idx
  on public.roommate_contact_group_members(contact_group_id, status);

create index if not exists roommate_contact_invites_group_idx
  on public.roommate_contact_invites(contact_group_id, status);

drop trigger if exists contact_import_batches_set_updated_at on public.contact_import_batches;
create trigger contact_import_batches_set_updated_at
before update on public.contact_import_batches
for each row execute function public.set_updated_at();

drop trigger if exists user_contacts_set_updated_at on public.user_contacts;
create trigger user_contacts_set_updated_at
before update on public.user_contacts
for each row execute function public.set_updated_at();

drop trigger if exists kinfolk_social_edges_set_updated_at on public.kinfolk_social_edges;
create trigger kinfolk_social_edges_set_updated_at
before update on public.kinfolk_social_edges
for each row execute function public.set_updated_at();

drop trigger if exists roommate_contact_groups_set_updated_at on public.roommate_contact_groups;
create trigger roommate_contact_groups_set_updated_at
before update on public.roommate_contact_groups
for each row execute function public.set_updated_at();

drop trigger if exists roommate_contact_group_members_set_updated_at on public.roommate_contact_group_members;
create trigger roommate_contact_group_members_set_updated_at
before update on public.roommate_contact_group_members
for each row execute function public.set_updated_at();

drop trigger if exists roommate_contact_invites_set_updated_at on public.roommate_contact_invites;
create trigger roommate_contact_invites_set_updated_at
before update on public.roommate_contact_invites
for each row execute function public.set_updated_at();

alter table public.contact_import_batches enable row level security;
alter table public.user_contacts enable row level security;
alter table public.kinfolk_social_edges enable row level security;
alter table public.roommate_contact_groups enable row level security;
alter table public.roommate_contact_group_members enable row level security;
alter table public.roommate_contact_invites enable row level security;

drop policy if exists "service role manages contact import batches" on public.contact_import_batches;
create policy "service role manages contact import batches"
on public.contact_import_batches for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages user contacts" on public.user_contacts;
create policy "service role manages user contacts"
on public.user_contacts for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages social edges" on public.kinfolk_social_edges;
create policy "service role manages social edges"
on public.kinfolk_social_edges for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages roommate contact groups" on public.roommate_contact_groups;
create policy "service role manages roommate contact groups"
on public.roommate_contact_groups for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages roommate contact group members" on public.roommate_contact_group_members;
create policy "service role manages roommate contact group members"
on public.roommate_contact_group_members for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages roommate contact invites" on public.roommate_contact_invites;
create policy "service role manages roommate contact invites"
on public.roommate_contact_invites for all
to service_role
using (true)
with check (true);

do $$
begin
  begin
    alter publication supabase_realtime add table public.user_contacts;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.roommate_contact_groups;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.roommate_contact_invites;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
