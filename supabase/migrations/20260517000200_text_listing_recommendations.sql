create table if not exists public.text_listing_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  thread_id uuid not null references public.text_threads(id) on delete cascade,
  listing_id uuid not null references public.apartment_listings(id) on delete cascade,
  rank integer not null default 1,
  fit_score integer not null default 0,
  status text not null default 'sent',
  outbound_message_id text,
  outbound_idempotency_key text not null,
  card_snapshot jsonb,
  reaction_type text,
  reaction_part_index integer,
  reaction_event_id text,
  feedback_value integer not null default 0,
  reacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint text_listing_recommendations_rank_check check (rank > 0),
  constraint text_listing_recommendations_feedback_check check (feedback_value between -1 and 1),
  constraint text_listing_recommendations_status_check check (status in ('sent', 'liked', 'passed', 'reacted')),
  constraint text_listing_recommendations_user_thread_listing_key unique (
    user_id,
    thread_id,
    listing_id,
    outbound_idempotency_key
  )
);

create unique index if not exists text_listing_recommendations_outbound_message_rank_idx
on public.text_listing_recommendations(outbound_message_id, rank)
where outbound_message_id is not null;

create index if not exists text_listing_recommendations_user_thread_idx
on public.text_listing_recommendations(user_id, thread_id, created_at desc);

create index if not exists text_listing_recommendations_listing_feedback_idx
on public.text_listing_recommendations(user_id, listing_id, status);

create trigger text_listing_recommendations_set_updated_at
before update on public.text_listing_recommendations
for each row execute function public.set_updated_at();

alter table public.text_listing_recommendations enable row level security;

create policy "service role manages text listing recommendations"
on public.text_listing_recommendations for all
to service_role
using (true)
with check (true);
