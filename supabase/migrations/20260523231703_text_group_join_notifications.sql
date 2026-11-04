create table if not exists public.text_group_join_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  requester_user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  thread_id uuid references public.text_threads(id) on delete set null,
  group_id uuid not null references public.apartment_roommate_groups(id) on delete cascade,
  membership_id uuid not null references public.apartment_roommate_group_memberships(id) on delete cascade,
  status text not null default 'sent',
  outbound_message_id text,
  outbound_idempotency_key text not null,
  card_snapshot jsonb,
  reaction_type text,
  reaction_event_id text,
  feedback_value integer not null default 0,
  reacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint text_group_join_notifications_feedback_check check (feedback_value between -1 and 1),
  constraint text_group_join_notifications_status_check
    check (status in ('sent', 'accepted', 'declined', 'reacted', 'failed')),
  constraint text_group_join_notifications_membership_key unique (
    recipient_user_id,
    membership_id,
    outbound_idempotency_key
  )
);

create unique index if not exists text_group_join_notifications_outbound_message_idx
on public.text_group_join_notifications(outbound_message_id)
where outbound_message_id is not null;

create index if not exists text_group_join_notifications_recipient_idx
on public.text_group_join_notifications(recipient_user_id, status, created_at desc);

create index if not exists text_group_join_notifications_membership_idx
on public.text_group_join_notifications(membership_id, status);

create trigger text_group_join_notifications_set_updated_at
before update on public.text_group_join_notifications
for each row execute function public.set_updated_at();

alter table public.text_group_join_notifications enable row level security;

create policy "service role manages text group join notifications"
on public.text_group_join_notifications for all
to service_role
using (true)
with check (true);
