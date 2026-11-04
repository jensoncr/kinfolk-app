-- Per-user notification preferences (conservative opt-in defaults — TCPA-sensitive).
-- Users must explicitly enable each notification type; no auto-enrollment.
create table if not exists public.match_notification_prefs (
  user_id uuid primary key references public.kinfolk_users(id) on delete cascade,
  apartment_matches_enabled boolean not null default false,
  roommate_matches_enabled boolean not null default false,
  group_ready_enabled boolean not null default false,
  quiet_hours_start smallint not null default 21,
  quiet_hours_end smallint not null default 9,
  timezone text not null default 'America/New_York',
  daily_send_cap smallint not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint match_notification_prefs_quiet_start_check
    check (quiet_hours_start between 0 and 23),
  constraint match_notification_prefs_quiet_end_check
    check (quiet_hours_end between 0 and 23),
  constraint match_notification_prefs_daily_cap_check
    check (daily_send_cap between 0 and 50)
);

create trigger match_notification_prefs_set_updated_at
before update on public.match_notification_prefs
for each row execute function public.set_updated_at();

alter table public.match_notification_prefs enable row level security;

create policy "service role manages match notification prefs"
on public.match_notification_prefs for all
to service_role
using (true)
with check (true);

-- Idempotency + velocity log for all match notification sends.
create table if not exists public.match_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  kind text not null,
  subject_id uuid,
  thread_id uuid references public.text_threads(id) on delete set null,
  status text not null default 'sent',
  outbound_message_id text,
  outbound_idempotency_key text not null,
  card_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint match_notifications_kind_check
    check (kind in ('apartment_match', 'roommate_match', 'group_ready')),
  constraint match_notifications_status_check
    check (status in ('sent', 'skipped', 'failed')),
  constraint match_notifications_idempotency_key unique (
    recipient_user_id,
    kind,
    outbound_idempotency_key
  )
);

create unique index if not exists match_notifications_outbound_message_idx
on public.match_notifications(outbound_message_id)
where outbound_message_id is not null;

-- Used by the velocity-cap "count today's sends" query.
create index if not exists match_notifications_recipient_kind_created_idx
on public.match_notifications(recipient_user_id, kind, created_at desc);

create trigger match_notifications_set_updated_at
before update on public.match_notifications
for each row execute function public.set_updated_at();

alter table public.match_notifications enable row level security;

create policy "service role manages match notifications"
on public.match_notifications for all
to service_role
using (true)
with check (true);
