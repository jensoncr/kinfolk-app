-- First-party in-app chat substrate (the "Hearth" feature).
--
-- Three durable product objects, kept deliberately separate from the SMS/iMessage
-- transport tables (text_threads/text_messages). A roomId is only a LOCATOR, never
-- authorization: every read/write is gated in app code by active membership and a
-- per-member history window. See docs/research/kinfolk-chat/01-chat-substrate-plan.md.

-- A durable conversation. Exactly one of compatibility_edge_id (match DM) or
-- apartment_group_id (apartment group) is set, keyed by room_type.
create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  room_type text not null,
  status text not null default 'active',
  -- CASCADE (not SET NULL): the anchor CHECK requires a match_dm room to keep a
  -- non-null compatibility_edge_id, so nulling it would always violate the check and
  -- block the edge delete. Deleting the edge therefore removes the room (and cascades
  -- to its members/messages), mirroring the apartment_group_id anchor below.
  compatibility_edge_id uuid references public.compatibility_edges(id) on delete cascade,
  apartment_group_id uuid references public.apartment_roommate_groups(id) on delete cascade,
  listing_id uuid references public.apartment_listings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_rooms_room_type_check
    check (room_type in ('match_dm', 'apartment_group')),
  constraint chat_rooms_status_check
    check (status in ('active', 'frozen', 'archived')),
  -- exactly one anchor, matching the room_type
  constraint chat_rooms_anchor_check check (
    (room_type = 'match_dm'
       and compatibility_edge_id is not null
       and apartment_group_id is null)
    or
    (room_type = 'apartment_group'
       and apartment_group_id is not null
       and compatibility_edge_id is null)
  )
);

-- One room per match edge and one room per apartment group, for the room's lifetime.
create unique index if not exists chat_rooms_compatibility_edge_idx
  on public.chat_rooms(compatibility_edge_id)
  where compatibility_edge_id is not null;

create unique index if not exists chat_rooms_apartment_group_idx
  on public.chat_rooms(apartment_group_id)
  where apartment_group_id is not null;

-- Authorization + per-user visibility window + notification settings.
-- One row per (room_id, user_id); leave/rejoin updates the same row.
create table if not exists public.chat_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  history_visible_from timestamptz not null default now(),
  last_read_at timestamptz,
  text_notifications_enabled boolean not null default false,
  last_text_notified_at timestamptz,
  last_notified_message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_room_members_role_check check (role in ('member', 'owner')),
  constraint chat_room_members_status_check
    check (status in ('active', 'left', 'removed', 'blocked')),
  constraint chat_room_members_room_user_unique unique (room_id, user_id)
);

create index if not exists chat_room_members_user_idx
  on public.chat_room_members(user_id, status, updated_at desc);

create index if not exists chat_room_members_room_idx
  on public.chat_room_members(room_id, status);

-- Product chat messages. sent_via records provenance: 'manual' or 'kinfolk_agent'
-- (a message the user told Kinfolk to send from iMessage, rendered as theirs with
-- a "sent via Kinfolk" mark). No updated_at — edits/deletes use edited_at/deleted_at.
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_user_id uuid references public.kinfolk_users(id) on delete set null,
  body text not null,
  sent_via text not null default 'manual',
  agent_run_id uuid references public.text_agent_runs(id) on delete set null,
  source_text_message_id uuid references public.text_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint chat_messages_sent_via_check
    check (sent_via in ('manual', 'kinfolk_agent')),
  constraint chat_messages_body_length_check
    check (char_length(btrim(body)) > 0 and char_length(body) <= 4000)
);

-- Primary read: a room's messages newest-first, windowed by history_visible_from.
create index if not exists chat_messages_room_idx
  on public.chat_messages(room_id, created_at desc);

create index if not exists chat_messages_sender_idx
  on public.chat_messages(sender_user_id, created_at desc)
  where sender_user_id is not null;

create index if not exists chat_messages_source_text_message_idx
  on public.chat_messages(source_text_message_id)
  where source_text_message_id is not null;

drop trigger if exists chat_rooms_set_updated_at on public.chat_rooms;
create trigger chat_rooms_set_updated_at
before update on public.chat_rooms
for each row execute function public.set_updated_at();

drop trigger if exists chat_room_members_set_updated_at on public.chat_room_members;
create trigger chat_room_members_set_updated_at
before update on public.chat_room_members
for each row execute function public.set_updated_at();

alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_messages enable row level security;

-- Access is enforced entirely in app code via the service-role client. These
-- policies keep the tables locked to that client only (no anon/authenticated path).
drop policy if exists "service role manages chat rooms" on public.chat_rooms;
create policy "service role manages chat rooms"
on public.chat_rooms for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages chat room members" on public.chat_room_members;
create policy "service role manages chat room members"
on public.chat_room_members for all
to service_role
using (true)
with check (true);

drop policy if exists "service role manages chat messages" on public.chat_messages;
create policy "service role manages chat messages"
on public.chat_messages for all
to service_role
using (true)
with check (true);
