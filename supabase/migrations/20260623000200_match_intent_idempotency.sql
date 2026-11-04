-- Idempotency for the chat "mutual intent" flow (recordMatchIntentAndOpen).
--
-- A user tapping "Message" records an approved_intro in match_feedback_events via a
-- racy select-then-insert. Without a DB guard, a double-tap or concurrent retry can
-- write duplicate approved_intro rows for the same (edge, actor), polluting the
-- consent ledger and any downstream "one approval per actor" assumption.
--
-- Enforce one approved_intro per (compatibility_edge_id, actor_user_id). The app
-- treats the resulting 23505 as success, so the flow stays idempotent.

-- Collapse any pre-existing duplicates first so the unique index can be created.
delete from public.match_feedback_events a
using public.match_feedback_events b
where a.event_type = 'approved_intro'
  and b.event_type = 'approved_intro'
  and a.compatibility_edge_id is not null
  and a.compatibility_edge_id = b.compatibility_edge_id
  and a.actor_user_id = b.actor_user_id
  and a.ctid > b.ctid;

create unique index if not exists match_feedback_events_approved_intro_unique
  on public.match_feedback_events (compatibility_edge_id, actor_user_id)
  where event_type = 'approved_intro' and compatibility_edge_id is not null;
