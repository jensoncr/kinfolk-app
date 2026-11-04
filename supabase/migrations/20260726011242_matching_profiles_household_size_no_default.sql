-- Household size must be answered, never assumed.
--
-- matching_profiles.household_size_min/max shipped with defaults of 2 and 4.
-- Any insert path that omitted the columns produced a row that LOOKS like the
-- user told us they want 2-4 people. The text agent turns those columns into a
-- `household_size` coverage fact (lib/text-agent/thread-data.ts), which marks
-- the `roommates` intake step as already answered — so onboarding skipped the
-- "how many roommates are you open to?" question entirely and went straight to
-- listings. The application writers already pass 0 explicitly
-- (lib/profiles/store.ts, lib/profiles/enrichment-store.ts) to dodge this; the
-- column default is the last place the assumption still lives.
--
-- Before changing the default, snapshot and clear the ambiguous legacy 2..4
-- and 0..4 pairs only when no reviewed household fact proves they came from
-- the user. The snapshot makes a genuine but unsynced historical answer
-- recoverable. Delete generated suggestions whose group-size premise is now
-- invalid; preserve user-actioned rows while clearing their derived fit/split
-- fields so no stale per-person rent is displayed.
create table public.matching_profile_household_size_legacy_backup_20260725 (
  profile_id uuid primary key references public.matching_profiles(id) on delete cascade,
  user_id uuid not null references public.kinfolk_users(id) on delete cascade,
  household_size_min integer not null,
  household_size_max integer not null,
  profile_status text not null,
  profile_created_at timestamptz not null,
  profile_updated_at timestamptz not null,
  apartment_listing_matches_backup jsonb not null default '[]'::jsonb,
  match_queue_items_backup jsonb not null default '[]'::jsonb,
  seeded_group_memberships_backup jsonb not null default '[]'::jsonb,
  seeded_groups_backup jsonb not null default '[]'::jsonb,
  backed_up_at timestamptz not null default now()
);

alter table public.matching_profile_household_size_legacy_backup_20260725
  enable row level security;

comment on table public.matching_profile_household_size_legacy_backup_20260725 is
  'Recovery snapshot for household ranges and derived listing rows changed by migration 20260726011242; service-role only.';

insert into public.matching_profile_household_size_legacy_backup_20260725 (
  profile_id,
  user_id,
  household_size_min,
  household_size_max,
  profile_status,
  profile_created_at,
  profile_updated_at,
  apartment_listing_matches_backup,
  match_queue_items_backup,
  seeded_group_memberships_backup,
  seeded_groups_backup
)
select
  profile.id,
  profile.user_id,
  profile.household_size_min,
  profile.household_size_max,
  profile.status,
  profile.created_at,
  profile.updated_at,
  (
    select coalesce(jsonb_agg(to_jsonb(listing_match)), '[]'::jsonb)
    from public.apartment_listing_matches as listing_match
    where listing_match.profile_id = profile.id
  ),
  (
    select coalesce(jsonb_agg(to_jsonb(queue)), '[]'::jsonb)
    from public.match_queue_items as queue
    where queue.profile_id = profile.id
      and queue.candidate_type = 'apartment'
  ),
  (
    select coalesce(jsonb_agg(to_jsonb(membership)), '[]'::jsonb)
    from public.apartment_roommate_group_memberships as membership
    join public.apartment_roommate_groups as roommate_group
      on roommate_group.id = membership.group_id
    where membership.user_id = profile.user_id
      and roommate_group.source = 'seeded'
  ),
  (
    select coalesce(jsonb_agg(to_jsonb(roommate_group)), '[]'::jsonb)
    from public.apartment_roommate_groups as roommate_group
    where roommate_group.source = 'seeded'
      and exists (
        select 1
        from public.apartment_roommate_group_memberships as membership
        where membership.group_id = roommate_group.id
          and membership.user_id = profile.user_id
      )
  )
from public.matching_profiles as profile
where (profile.household_size_min, profile.household_size_max)
  in ((2, 4), (0, 4))
  and not exists (
    select 1
    from public.profile_facts as fact
    where fact.user_id = profile.user_id
      and fact.fact_key = 'household_size'
      and fact.matching_eligible = true
      and fact.sensitivity_level = 'standard'
      and fact.user_review_state in ('approved', 'edited')
  );

delete from public.match_queue_items as queue
using public.matching_profile_household_size_legacy_backup_20260725 as backup
where queue.profile_id = backup.profile_id
  and queue.candidate_type = 'apartment'
  and queue.status = 'suggested';

update public.match_queue_items as queue
set
  fit_score = 0,
  evidence = '[]'::jsonb,
  tradeoffs = '[]'::jsonb,
  updated_at = now()
from public.matching_profile_household_size_legacy_backup_20260725 as backup
where queue.profile_id = backup.profile_id
  and queue.candidate_type = 'apartment'
  and queue.status <> 'suggested';

delete from public.apartment_listing_matches as listing_match
using public.matching_profile_household_size_legacy_backup_20260725 as backup
where listing_match.profile_id = backup.profile_id
  and listing_match.status = 'suggested';

-- Preserve saves, tours, applications, and passes, but remove every derived
-- claim that depended on an unconfirmed group size. Zero is already read as
-- unknown by card formatters; a later confirmed-size recompute will replace it.
update public.apartment_listing_matches as listing_match
set
  fit_score = 0,
  recommended_household_size = 0,
  per_person_rent = 0,
  effective_per_person_rent = 0,
  split_breakdown = '[]'::jsonb,
  evidence = '[]'::jsonb,
  tradeoffs = '[]'::jsonb,
  updated_at = now()
from public.matching_profile_household_size_legacy_backup_20260725 as backup
where listing_match.profile_id = backup.profile_id
  and listing_match.status <> 'suggested';

-- The original roommate-group migration silently enrolled eligible profiles
-- into seeded groups. A seeded group can also contain a later, explicit join,
-- though, so group.source alone does not prove that a membership was automatic.
-- The seed insert wrote requested/approved/created timestamps from the same
-- transaction; a real request is approved in a later transaction. Also retain
-- automatic memberships when a reviewed flexibility fact confirms the user is
-- open to roommates. Capture only the memberships we can prove are stale so the
-- affected groups can be reconciled after the delete.
create temporary table kinfolk_stale_seeded_memberships_20260725
on commit drop
as
with latest_flexibility as (
  select distinct on (fact.user_id)
    fact.user_id,
    replace(lower(coalesce(fact.normalized_value, fact.value_json #>> '{}', '')), '’', '''') as value
  from public.profile_facts as fact
  where fact.fact_key = 'group_size_flexibility'
    and fact.matching_eligible = true
    and fact.sensitivity_level = 'standard'
    and fact.user_review_state in ('approved', 'edited')
  order by fact.user_id, fact.updated_at desc
)
select
  membership.id as membership_id,
  membership.group_id
from public.apartment_roommate_group_memberships as membership
join public.matching_profile_household_size_legacy_backup_20260725 as backup
  on backup.user_id = membership.user_id
join public.apartment_roommate_groups as roommate_group
  on roommate_group.id = membership.group_id
left join latest_flexibility as flexibility
  on flexibility.user_id = membership.user_id
where roommate_group.source = 'seeded'
  and membership.status = 'member'
  and membership.approved_at is not null
  and membership.requested_at = membership.approved_at
  and membership.created_at = membership.approved_at
  and not (
    (
      coalesce(flexibility.value, '') ~ '(^|[^[:alnum:]_])(open|yes|yeah|yep|sure|flexible)([^[:alnum:]_]|$)'
      or coalesce(flexibility.value, '') ~ '(^|[^[:alnum:]_])((do not|don''?t) mind (roommates?|housemates?|shared (housing|living))|(roommates?|housemates?|shared (housing|living)) (are |is )?(fine|okay|ok|welcome)|(willing|comfortable|okay|ok) (to live )?with (roommates?|housemates?)|(want|prefer|need) (to live with )?(roommates?|housemates?))([^[:alnum:]_]|$)'
    )
    and coalesce(flexibility.value, '') !~ '(^|[^[:alnum:]_])(no roommates?|not open to roommates?|without roommates?|no shared( housing| home| living)?|((do|did|would|will|can) not|don''?t|didn''?t|wouldn''?t|won''?t|can''?t|never) (want|need|prefer|consider|accept|have|live with) (any )?(roommates?|housemates?|shared (housing|living))|not interested in (roommates?|housemates?|shared (housing|living))|(hate|avoid) (roommates?|housemates?|shared (housing|living)))([^[:alnum:]_]|$)'
    and coalesce(flexibility.value, '') !~ '(^|[^[:alnum:]_])((do|did|would|will|can) not|don''?t|didn''?t|wouldn''?t|won''?t|can''?t|never) (want|need|prefer) to live with (any )?(roommates?|housemates?)([^[:alnum:]_]|$)'
    and coalesce(flexibility.value, '') !~ '(^|[^[:alnum:]_])(roommates?|housemates?) ((are|is) (a )?hard no|(are|is) not for me|(aren''?t|isn''?t) for me)([^[:alnum:]_]|$)'
    and coalesce(flexibility.value, '') !~ '(^|[^[:alnum:]_])(solo|alone)([^[:alnum:]_]|$)[^[:alnum:]_]*only([^[:alnum:]_]|$)'
    and coalesce(flexibility.value, '') !~ '(^|[^[:alnum:]_])only([^[:alnum:]_]|$)[^[:alnum:]_]*(solo|alone)([^[:alnum:]_]|$)'
  );

delete from public.apartment_roommate_group_memberships as membership
using kinfolk_stale_seeded_memberships_20260725 as stale
where membership.id = stale.membership_id;

-- Direct migration deletes bypass the application leave path. Close empty
-- seeded groups instead of deleting them: a cascade would otherwise destroy
-- pending join requests, group chat history, notifications, and evidence that
-- belong to other users. Reopen underfilled groups that still have members and
-- clear member-derived constraints/summary in either case.
update public.apartment_roommate_groups as roommate_group
set
  status = 'closed',
  preferences = roommate_group.preferences - 'group_constraints',
  match_summary = null,
  updated_at = now()
where roommate_group.id in (
  select distinct stale.group_id
  from kinfolk_stale_seeded_memberships_20260725 as stale
)
  and not exists (
    select 1
    from public.apartment_roommate_group_memberships as remaining
    where remaining.group_id = roommate_group.id
      and remaining.status = 'member'
  );

update public.apartment_roommate_groups as roommate_group
set
  status = case
    when roommate_group.status in ('ready', 'touring')
      and (
        select count(*)
        from public.apartment_roommate_group_memberships as remaining
        where remaining.group_id = roommate_group.id
          and remaining.status = 'member'
      ) < roommate_group.max_size
      then 'forming'
    else roommate_group.status
  end,
  preferences = roommate_group.preferences - 'group_constraints',
  match_summary = null,
  updated_at = now()
where roommate_group.id in (
  select distinct stale.group_id
  from kinfolk_stale_seeded_memberships_20260725 as stale
);

with household_recovery_value as (
  select
    backup.*,
    coalesce((
      select replace(lower(coalesce(fact.normalized_value, fact.value_json #>> '{}')), '’', '''')
      from public.profile_facts as fact
      where fact.user_id = backup.user_id
        and fact.fact_key = 'group_size_flexibility'
        and fact.matching_eligible = true
        and fact.sensitivity_level = 'standard'
        and fact.user_review_state in ('approved', 'edited')
      order by fact.updated_at desc
      limit 1
    ), '') as flexibility_value
  from public.matching_profile_household_size_legacy_backup_20260725 as backup
), household_recovery as (
  select
    recovery.*,
    (
      recovery.flexibility_value ~ '\m(open|yes|yeah|yep|sure|flexible)\M'
      or recovery.flexibility_value ~ '\m((do not|don''?t) mind (roommates?|housemates?|shared (housing|living))|(roommates?|housemates?|shared (housing|living)) (are |is )?(fine|okay|ok|welcome)|(willing|comfortable|okay|ok) (to live )?with (roommates?|housemates?)|(want|prefer|need) (to live with )?(roommates?|housemates?))\M'
    )
      as has_open_signal,
    (
      recovery.flexibility_value ~ '\m(solo|alone|no roommates?|not open to roommates?|without roommates?|no shared( housing| home| living)?|((do|did|would|will|can) not|don''?t|didn''?t|wouldn''?t|won''?t|can''?t|never) (want|need|prefer|consider|accept|have|live with) (any )?(roommates?|housemates?|shared (housing|living))|not interested in (roommates?|housemates?|shared (housing|living))|(hate|avoid) (roommates?|housemates?|shared (housing|living)))\M'
      or recovery.flexibility_value ~ '\m((do|did|would|will|can) not|don''?t|didn''?t|wouldn''?t|won''?t|can''?t|never) (want|need|prefer) to live with (any )?(roommates?|housemates?)\M'
      or recovery.flexibility_value ~ '\m(roommates?|housemates?)\M ((are|is) (a )?hard no|(are|is) not for me|(aren''?t|isn''?t) for me)'
    )
      as has_solo_signal,
    (
      recovery.flexibility_value ~ '\m(no roommates?|not open to roommates?|without roommates?|no shared( housing| home| living)?|((do|did|would|will|can) not|don''?t|didn''?t|wouldn''?t|won''?t|can''?t|never) (want|need|prefer|consider|accept|have|live with) (any )?(roommates?|housemates?|shared (housing|living))|not interested in (roommates?|housemates?|shared (housing|living))|(hate|avoid) (roommates?|housemates?|shared (housing|living)))\M'
      or recovery.flexibility_value ~ '\m((do|did|would|will|can) not|don''?t|didn''?t|wouldn''?t|won''?t|can''?t|never) (want|need|prefer) to live with (any )?(roommates?|housemates?)\M'
      or recovery.flexibility_value ~ '\m(roommates?|housemates?)\M ((are|is) (a )?hard no|(are|is) not for me|(aren''?t|isn''?t) for me)'
      or recovery.flexibility_value ~ '\m(solo|alone)\M[^[:alnum:]_]*\monly\M'
      or recovery.flexibility_value ~ '\monly\M[^[:alnum:]_]*\m(solo|alone)\M'
      or (
        recovery.flexibility_value ~ '\m(solo|alone)\M'
        and recovery.flexibility_value !~ '\m(open|yes|yeah|yep|sure|flexible)\M'
        and recovery.flexibility_value !~ '\m((do not|don''?t) mind (roommates?|housemates?|shared (housing|living))|(roommates?|housemates?|shared (housing|living)) (are |is )?(fine|okay|ok|welcome)|(willing|comfortable|okay|ok) (to live )?with (roommates?|housemates?)|(want|prefer|need) (to live with )?(roommates?|housemates?))\M'
      )
    ) as has_solo_exclusive_signal
  from household_recovery_value as recovery
)
update public.matching_profiles as profile
set
  household_size_min = case
    when recovery.has_solo_exclusive_signal
      then 1
    when recovery.has_open_signal
      then 1
    else 0
  end,
  household_size_max = case
    when recovery.has_solo_exclusive_signal
      then 1
    when recovery.has_open_signal
      then 4
    else 0
  end,
  completeness_score = round((
    case
      when (coalesce(profile.budget_min, 0) > 0 or coalesce(profile.budget_max, 0) > 0)
        and not (
          coalesce(profile.budget_min, 0) > 0
          and coalesce(profile.budget_max, 0) > 0
          and profile.budget_min > profile.budget_max
        )
        then 1
      else 0
    end
    + case
        when profile.move_in_start is not null
          and profile.move_in_end is not null
          then 1
        else 0
      end
    + case
        when recovery.has_solo_signal or recovery.has_open_signal
          then 1
        else 0
      end
  )::numeric / 3 * 100, 2),
  updated_at = recovery.profile_updated_at
from household_recovery as recovery
where profile.id = recovery.profile_id;

-- Profiles recovered from an approved flexibility answer now have a valid
-- household range. Their preserved saved/touring/applied rows were
-- intentionally invalidated above, so enqueue the normal projection worker to
-- restore fit and per-person economics without waiting for unrelated activity.
select public.enqueue_profile_matching_refresh(backup.user_id)
from public.matching_profile_household_size_legacy_backup_20260725 as backup
join public.matching_profiles as profile
  on profile.id = backup.profile_id
where profile.household_size_min > 0
  and profile.household_size_max >= profile.household_size_min;

-- A completed interview with no summary step would otherwise never ask for
-- the household answer we just invalidated. First reopen the latest text
-- summary for each affected user while preserving its facts, skipped steps,
-- cards, and agent memory. Then reopen only the latest completed interview;
-- active interviews already self-heal from fresh coverage, and older completed
-- rows remain historical.
with affected_user as (
  select distinct backup.user_id
  from public.matching_profile_household_size_legacy_backup_20260725 as backup
  join public.matching_profiles as profile
    on profile.id = backup.profile_id
  where profile.household_size_min = 0
    and profile.household_size_max = 0
), latest_summary as (
  select distinct on (summary.user_id)
    summary.id
  from public.text_thread_summaries as summary
  join affected_user as affected
    on affected.user_id = summary.user_id
  order by summary.user_id, summary.updated_at desc, summary.created_at desc
)
update public.text_thread_summaries as summary
set
  summary_json = summary.summary_json || jsonb_build_object(
    'intake_complete', false,
    'next_intake_step', 'roommates',
    'conversation_state',
      coalesce(summary.summary_json -> 'conversation_state', '{}'::jsonb) ||
      jsonb_build_object(
        'active_mode', 'intake',
        'next_intake_step', 'roommates'
      )
  ),
  known_preferences_json = jsonb_set(
    jsonb_set(
      coalesce(summary.known_preferences_json, '{}'::jsonb),
      '{facts}',
      jsonb_path_query_array(
        coalesce(summary.known_preferences_json -> 'facts', '[]'::jsonb),
        '$[*] ? (@.fact_key != "household_size" && @.fact_key != "group_size_flexibility")'
      ),
      true
    ),
    '{skipped_steps}',
    jsonb_path_query_array(
      coalesce(summary.known_preferences_json -> 'skipped_steps', '[]'::jsonb),
      '$[*] ? (@ != "roommates")'
    ),
    true
  ),
  open_questions_json = jsonb_build_array(
    'Are you open to roommates, or hunting solo?'
  ),
  updated_at = now()
from latest_summary as latest
where summary.id = latest.id;

with latest_completed_interview as (
  select distinct on (interview.user_id)
    interview.id
  from public.matching_interviews as interview
  join public.matching_profile_household_size_legacy_backup_20260725 as backup
    on backup.user_id = interview.user_id
  join public.matching_profiles as profile
    on profile.id = backup.profile_id
  where interview.status = 'completed'
    and profile.household_size_min = 0
    and profile.household_size_max = 0
    and not exists (
      select 1
      from public.matching_interviews as active_interview
      where active_interview.user_id = interview.user_id
        and active_interview.status in ('scheduled', 'in_progress', 'needs_review')
    )
  order by
    interview.user_id,
    interview.completed_at desc nulls last,
    interview.updated_at desc
)
update public.matching_interviews as interview
set
  status = 'in_progress',
  completed_at = null,
  extraction_status = 'pending',
  updated_at = now()
from latest_completed_interview as latest
where interview.id = latest.id;

-- 0 reads as "unknown" in onboarding coverage and live text listing search:
-- coverage synthesis requires min > 0, and the live fallback requires both
-- bounds positive. The legacy silent group matcher excludes 0..0 profiles
-- until household size is answered.

alter table public.matching_profiles
  alter column household_size_min set default 0,
  alter column household_size_max set default 0;
