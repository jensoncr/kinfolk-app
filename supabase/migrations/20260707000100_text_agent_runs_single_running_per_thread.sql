-- One live loop per thread, enforced by the database.
--
-- The run queue's per-thread serialization is a read-then-CAS: a worker whose
-- sibling read predates another worker's claim can still claim a second run
-- on the same thread and double-reply. This partial unique index is the
-- backstop that makes the second claim impossible (the losing UPDATE gets
-- 23505, which the claim path treats as a lost race).

-- Defensive cleanup so the index can build even if a historical race left
-- two live claims on one thread: keep the newest, fail the rest.
update public.text_agent_runs stale
set run_status = 'failed',
    error_message = coalesce(
      error_message,
      'Superseded duplicate running claim (single-running-per-thread migration).'
    )
where stale.run_status = 'running'
  and stale.thread_id is not null
  and exists (
    select 1
    from public.text_agent_runs newer
    where newer.thread_id = stale.thread_id
      and newer.run_status = 'running'
      and newer.id <> stale.id
      and (newer.updated_at > stale.updated_at
        or (newer.updated_at = stale.updated_at and newer.id > stale.id))
  );

create unique index if not exists text_agent_runs_one_running_per_thread
  on public.text_agent_runs (thread_id)
  where run_status = 'running';
