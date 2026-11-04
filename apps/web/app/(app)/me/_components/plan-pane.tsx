"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  Check,
  Copy,
  Loader2,
  Plus,
  Share2,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { LocationAutocomplete } from "@/components/ui/location-autocomplete";
import {
  addFutureCityChip,
  applyPlanPatch,
  buildPlanIntentPayload,
  buildSavedAreaPayload,
  buildSavedListingPayload,
  buildSilentMatcherIntentPayload,
  copyInviteLinkToClipboard,
  formatOpenInviteCountLabel,
  formatPlanMatchScoreLabel,
  resolveInviteLinkUrl,
  shareInviteLink,
  nextSavedAreasState,
  planMatchComponentBarWidth,
  clampPlanMatchScore,
  planSaveStateForLatestResult,
  planStateAfterFailedSync,
  quietWatchReadinessForPlan,
  removeFutureCityChip,
  removeSavedListingState,
  savedAreasStateAfterFailedSync,
  savedListingsStateAfterFailedSync,
  type PlanInviteLinkView,
  type PlanMatch,
  type PlanSaveState,
  type QuietWatchReadiness,
  type InviteBrowserApi,
} from "@/app/(app)/me/_components/plan-pane-state";
import { normalizeSavedAreaLabel, savedAreaLabelKey } from "@/lib/plan/saved-place-labels";
import type {
  LivingPlan,
  MoveHorizon,
  PlanPerson,
  RelocationFlexibility,
  SavedListing,
} from "@/lib/plan/plan";
import {
  locationLabelsMatch,
  type LocationSuggestion,
} from "@/lib/shared/location-suggestions";
import { formatCurrency } from "@/lib/shared/currency";

type PlanPaneProps = {
  plan: LivingPlan;
  people: PlanPerson[];
  matches: PlanMatch[];
  requestCount: number;
  savedListings: SavedListing[];
  savedAreas: string[];
  inviteLink: PlanInviteLinkView | null;
  apartmentsHref: string;
};

const MOVE_HORIZON_OPTIONS: { value: MoveHorizon; label: string }[] = [
  { value: "now", label: "Now" },
  { value: "lt_3mo", label: "Within 3 months" },
  { value: "3_6mo", label: "3–6 months" },
  { value: "6_12mo", label: "6–12 months" },
  { value: "1_2yr", label: "1–2 years" },
  { value: "exploring", label: "Just exploring" },
];

const FLEXIBILITY_OPTIONS: {
  value: RelocationFlexibility;
  label: string;
  hint: string;
}[] = [
  { value: "locked", label: "Locked to a date", hint: "I have a fixed move date" },
  { value: "some", label: "Some give", hint: "A few weeks either way" },
  { value: "flexible", label: "Flexible", hint: "Timing is open" },
  { value: "ready", label: "Could move fast", hint: "Weeks, for the right place" },
];

const SAVE_BADGE_STATES = {
  error: { icon: <X size={13} aria-hidden="true" />, text: "Not saved", tone: "text-[#9f3326]" },
  saved: { icon: <Check size={13} aria-hidden="true" />, text: "Saved", tone: "text-[var(--pp-mint)]" },
  saving: {
    icon: <Loader2 size={13} className="animate-spin" aria-hidden="true" />,
    text: "Saving",
    tone: "text-[var(--pp-ink-50)]",
  },
} as const;

export function PlanPane({
  plan: initialPlan,
  people,
  matches,
  requestCount,
  savedListings: initialSavedListings,
  savedAreas: initialSavedAreas,
  inviteLink,
  apartmentsHref,
}: PlanPaneProps) {
  const [plan, setPlan] = useState(initialPlan);
  const planRef = useRef(initialPlan);
  const [savedListings, setSavedListings] = useState(initialSavedListings);
  const [savedAreas, setSavedAreas] = useState(initialSavedAreas);
  const [saveState, setSaveState] = useState<PlanSaveState>("idle");
  const saveRequestId = useRef(0);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quietWatchReadiness = quietWatchReadinessForPlan(plan);

  const clearSavedTimer = useCallback(() => {
    if (savedTimer.current) {
      clearTimeout(savedTimer.current);
      savedTimer.current = null;
    }
  }, []);

  useEffect(() => clearSavedTimer, [clearSavedTimer]);

  const flashSaved = useCallback((requestId: number) => {
    setSaveState("saved");
    clearSavedTimer();
    savedTimer.current = setTimeout(() => {
      if (planSaveStateForLatestResult(requestId, saveRequestId.current, "success")) {
        setSaveState("idle");
      }
    }, 1800);
  }, [clearSavedTimer]);

  // Saves are serialized through this queue: with overlapping requests, a
  // FAILED earlier save whose response lost the race would be silently
  // swallowed by the only-latest guard while the badge showed "Saved" from
  // the later one — unsaved data presented as saved.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const persistIntent = useCallback(
    (
      patch: Record<string, unknown>,
      rollback?: { previous: LivingPlan; optimistic: LivingPlan },
    ) => {
      const run = async () => {
        const requestId = saveRequestId.current + 1;
        saveRequestId.current = requestId;
        clearSavedTimer();
        setSaveState("saving");
        try {
          const response = await fetch("/api/plan/intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildPlanIntentPayload(patch)),
          });
          if (!response.ok) throw new Error("save failed");
          if (planSaveStateForLatestResult(requestId, saveRequestId.current, "success")) {
            flashSaved(requestId);
          }
        } catch {
          const nextState = planSaveStateForLatestResult(
            requestId,
            saveRequestId.current,
            "error",
          );
          if (nextState) {
            setSaveState(nextState);
            if (rollback) {
              setPlan((current) => {
                const nextPlan = planStateAfterFailedSync(
                  current,
                  rollback.optimistic,
                  rollback.previous,
                );
                planRef.current = nextPlan;
                return nextPlan;
              });
            }
          }
        }
      };
      const next = saveQueue.current.then(run, run);
      saveQueue.current = next;
      return next;
    },
    [clearSavedTimer, flashSaved],
  );

  const updatePlan = useCallback(
    (patch: Partial<LivingPlan>, persisted: Record<string, unknown>) => {
      const previous = planRef.current;
      const optimistic = applyPlanPatch(previous, patch);
      planRef.current = optimistic;
      setPlan(optimistic);
      void persistIntent(persisted, { previous, optimistic });
    },
    [persistIntent],
  );

  // Saved-place sync failures roll back the optimistic update AND say so —
  // a removed listing silently reappearing reads as a glitch, not a failure.
  const [savedSyncError, setSavedSyncError] = useState<string | null>(null);

  const toggleArea = useCallback(async (label: string, nextSaved: boolean) => {
    const previous = savedAreas;
    const optimistic = nextSavedAreasState(previous, label, nextSaved);
    setSavedAreas(optimistic);
    setSavedSyncError(null);
    try {
      const response = await fetch("/api/plan/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSavedAreaPayload(label, nextSaved)),
      });
      if (!response.ok) throw new Error("save failed");
    } catch {
      setSavedAreas((current) => savedAreasStateAfterFailedSync(current, optimistic, previous));
      setSavedSyncError("Couldn't update your saved areas — try again.");
    }
  }, [savedAreas]);

  const removeListing = useCallback(async (listing: SavedListing) => {
    const previous = savedListings;
    const optimistic = removeSavedListingState(previous, listing);
    setSavedListings(optimistic);
    setSavedSyncError(null);
    try {
      const response = await fetch("/api/plan/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSavedListingPayload(listing, false)),
      });
      if (!response.ok) throw new Error("save failed");
    } catch {
      setSavedListings((current) =>
        savedListingsStateAfterFailedSync(current, optimistic, previous),
      );
      setSavedSyncError("Couldn't remove that listing — try again.");
    }
  }, [savedListings]);

  return (
    <div className="flex flex-col gap-12">
      <IntentSection plan={plan} saveState={saveState} onChange={updatePlan} />
      <PeopleSection people={people} inviteLink={inviteLink} />
      <MatchesSection matches={matches} requestCount={requestCount} apartmentsHref={apartmentsHref} />
      <SavedSection
        savedListings={savedListings}
        savedAreas={savedAreas}
        apartmentsHref={apartmentsHref}
        onToggleArea={toggleArea}
        onRemoveListing={removeListing}
        syncError={savedSyncError}
      />
      <MatcherSection
        enabled={plan.silentMatcherEnabled}
        readiness={quietWatchReadiness}
        onToggle={(enabled) =>
          updatePlan(
            { silentMatcherEnabled: enabled },
            buildSilentMatcherIntentPayload(enabled),
          )
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Intent */

function IntentSection({
  plan,
  saveState,
  onChange,
}: {
  plan: LivingPlan;
  saveState: PlanSaveState;
  onChange: (patch: Partial<LivingPlan>, persisted: Record<string, unknown>) => void;
}) {
  const setCities = (cities: string[]) => onChange({ futureCities: cities }, { futureCities: cities });

  // Controlled draft so a failed-save rollback of plan.intentNote also reverts
  // what the textarea displays; reset during render, not in an effect.
  const [noteDraft, setNoteDraft] = useState(plan.intentNote);
  const [lastIntentNote, setLastIntentNote] = useState(plan.intentNote);
  if (plan.intentNote !== lastIntentNote) {
    setLastIntentNote(plan.intentNote);
    setNoteDraft(plan.intentNote);
  }

  return (
    <section aria-labelledby="plan-intent-heading">
      <SectionHeader
        id="plan-intent-heading"
        title="Where & when"
        trailing={<SaveBadge state={saveState} />}
      />

      <div className="mt-6 space-y-7">
        <Field label="Cities">
          <CityChipEditor
            values={plan.futureCities}
            onChange={setCities}
          />
        </Field>

        <Field label="Timing">
          <SegmentedControl
            label="Timing"
            options={MOVE_HORIZON_OPTIONS}
            value={plan.moveHorizon}
            onSelect={(value) => onChange({ moveHorizon: value }, { moveHorizon: value })}
          />
        </Field>

        <Field label="How ready">
          <SegmentedControl
            label="How ready"
            options={FLEXIBILITY_OPTIONS}
            value={plan.relocationFlexibility}
            onSelect={(value) =>
              onChange({ relocationFlexibility: value }, { relocationFlexibility: value })
            }
          />
          {plan.relocationFlexibility ? (
            <p className="mt-2 text-[12.5px] text-[var(--pp-ink-60)]">
              {FLEXIBILITY_OPTIONS.find((option) => option.value === plan.relocationFlexibility)?.hint}
            </p>
          ) : null}
        </Field>

        <Field label="Notes" optional>
          <textarea
            aria-label="Plan notes"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.currentTarget.value)}
            onBlur={() => {
              if (noteDraft !== plan.intentNote) {
                onChange({ intentNote: noteDraft }, { intentNote: noteDraft });
              }
            }}
            rows={3}
            maxLength={600}
            placeholder="Budget per person, who you'd live with, a neighborhood you love."
            className="kin-focus w-full resize-y rounded-2xl border border-[var(--pp-hairline)] bg-[var(--pp-canvas)] px-4 py-3 text-[14px] leading-6 text-[var(--pp-ink)] outline-none transition placeholder:text-[var(--pp-ink-40)] focus-visible:border-[var(--pp-hairline-strong)]"
          />
        </Field>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ People */

function PeopleSection({
  people,
  inviteLink,
}: {
  people: PlanPerson[];
  inviteLink: PlanInviteLinkView | null;
}) {
  return (
    <section aria-labelledby="plan-people-heading">
      <SectionHeader
        id="plan-people-heading"
        title="People"
        trailing={
          people.length > 0 ? (
            <span className="pp-mono text-[12px] tabular-nums text-[var(--pp-ink-50)]">
              {people.length} {people.length === 1 ? "person" : "people"}
            </span>
          ) : null
        }
      />

      {inviteLink ? <InviteLinkRow inviteLink={inviteLink} /> : null}

      {people.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No one yet"
          body="Share your link with people you'd live with. They appear here when they join."
        />
      ) : (
        <ul className="mt-5 divide-y divide-[var(--pp-hairline)] overflow-hidden rounded-2xl border border-[var(--pp-hairline)]">
          {people.map((person) => (
            <li
              key={person.userId}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 bg-[var(--pp-canvas)] px-4 py-3.5 transition hover:bg-[var(--pp-canvas-soft)] sm:gap-4 sm:px-5"
            >
              <Avatar
                imageUrl={person.imageUrl}
                initials={person.initials}
                seed={person.userId}
                size={40}
                className="text-[13px]"
              />
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-semibold text-[var(--pp-ink)]">
                  {person.name}
                </p>
                <p className="mt-0.5 truncate text-[12.5px] text-[var(--pp-ink-60)]">
                  {person.headline}
                  <span className="text-[var(--pp-ink-40)]">
                    {" · "}
                    {person.relationship === "you_invited" ? "you invited" : "you joined"}
                  </span>
                </p>
              </div>
              {person.fitScore != null ? (
                <span className="shrink-0 rounded-full bg-[var(--pp-mint-soft)] px-2.5 py-1 text-[12px] font-semibold tabular-nums text-[#1c3a28]">
                  {person.fitScore}% fit
                </span>
              ) : (
                <span className="shrink-0 text-[12px] text-[var(--pp-ink-40)]">—</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteLinkRow({ inviteLink }: { inviteLink: PlanInviteLinkView }) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCopyTimer = useCallback(() => {
    if (copyTimer.current) {
      clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
  }, []);

  useEffect(() => clearCopyTimer, [clearCopyTimer]);

  // Resolve against the browser origin only after hydration: the server
  // renders with its own base URL (e.g. a tunnel host in dev), and rewriting
  // during render makes the first client paint mismatch the SSR HTML.
  const origin = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => undefined,
  );
  const absoluteUrl = resolveInviteLinkUrl(inviteLink.url, origin);

  const showCopiedFeedback = useCallback(() => {
    setCopied(true);
    clearCopyTimer();
    copyTimer.current = setTimeout(() => setCopied(false), 1800);
  }, [clearCopyTimer]);

  const copy = async () => {
    if (await copyInviteLinkToClipboard(absoluteUrl, currentInviteBrowserApi())) {
      showCopiedFeedback();
    }
  };

  const share = async () => {
    const result = await shareInviteLink(absoluteUrl, currentInviteBrowserApi());
    if (result === "copied") showCopiedFeedback();
  };

  return (
    <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[var(--pp-hairline)] bg-[var(--pp-canvas-soft)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-[13.5px] font-medium text-[var(--pp-ink)]">
            {absoluteUrl}
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11.5px] font-semibold text-[var(--pp-ink-60)]">
            <UserPlus size={12} aria-hidden="true" />
            {formatOpenInviteCountLabel(inviteLink.openInviteCount)}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] text-[var(--pp-ink-60)]">
          Share with people you&apos;d live with. We never text them.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={copy}
          className="kin-focus inline-flex items-center justify-center gap-2 rounded-full border border-[var(--pp-hairline-strong)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--pp-ink-80)] transition hover:border-[var(--pp-ink-40)]"
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={share}
          className="kin-focus inline-flex items-center justify-center gap-2 rounded-full bg-[var(--pp-ink)] px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#264a36]"
        >
          <Share2 size={14} aria-hidden="true" /> Share
        </button>
      </div>
    </div>
  );
}

function subscribeToNothing() {
  return () => {};
}

function currentInviteBrowserApi(): InviteBrowserApi {
  if (typeof navigator === "undefined") return {};
  return {
    clipboard: navigator.clipboard,
    share: navigator.share?.bind(navigator),
  };
}

/* ----------------------------------------------------------------- Matches */

function MatchesSection({
  matches,
  requestCount,
  apartmentsHref,
}: {
  matches: PlanMatch[];
  requestCount: number;
  apartmentsHref: string;
}) {
  return (
    <section aria-labelledby="plan-matches-heading">
      <SectionHeader
        id="plan-matches-heading"
        title="People you'd click with"
        note="Only mutual interest opens a chat."
        trailing={
          matches.length > 0 ? (
            <Link
              href="/me/matches"
              className="kin-focus inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--pp-mint)] transition hover:underline"
            >
              All matches <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          ) : null
        }
      />

      {requestCount > 0 ? (
        <Link
          href="/me/matches"
          className="kin-focus mt-5 flex items-center justify-between gap-3 rounded-2xl bg-[var(--pp-mint-soft)] px-4 py-3 transition hover:brightness-[0.97] sm:px-5"
        >
          <span className="text-[13.5px] font-semibold text-[#1c3a28]">
            {requestCount} {requestCount === 1 ? "person wants" : "people want"} to join a group you started
          </span>
          <ArrowUpRight size={16} aria-hidden="true" className="shrink-0 text-[#1c3a28]" />
        </Link>
      ) : null}

      {matches.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Warming up"
          body="As Kinfolk learns more about you, your best roommate matches appear here."
          action={
            <Link
              href={apartmentsHref}
              className="kin-focus inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--pp-mint)] transition hover:underline"
            >
              Browse apartments <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          }
        />
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {matches.map((match) => (
            <article
              key={match.userId}
              className="flex flex-col gap-3 rounded-2xl border border-[var(--pp-hairline)] bg-[var(--pp-canvas)] p-4"
            >
              <div className="flex items-center gap-3">
                <Avatar
                  imageUrl={match.imageUrl}
                  initials={match.initials}
                  seed={match.userId}
                  size={42}
                  className="text-[13px]"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-semibold text-[var(--pp-ink)]">
                    {match.name}
                  </p>
                  <p className="truncate text-[12.5px] text-[var(--pp-ink-60)]">{match.headline}</p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--pp-mint-soft)] px-2.5 py-1 text-[12px] font-semibold tabular-nums text-[#1c3a28]">
                  {formatPlanMatchScoreLabel(match.score)}
                </span>
              </div>
              {match.components.length > 0 ? (
                <dl className="grid gap-1.5">
                  {match.components.slice(0, 3).map((component) => (
                    <div key={component.label} className="flex items-center gap-2.5">
                      <dt className="w-[78px] shrink-0 text-[11.5px] text-[var(--pp-ink-60)]">
                        {component.label}
                      </dt>
                      <dd className="flex-1">
                        <span
                          aria-hidden="true"
                          className="block h-[5px] overflow-hidden rounded-full bg-[var(--pp-hairline)]"
                        >
                          <span
                            className="block h-full rounded-full bg-[var(--pp-mint)]"
                            style={{ width: planMatchComponentBarWidth(component.score) }}
                          />
                        </span>
                        <span className="sr-only">
                          {clampPlanMatchScore(component.score)} out of 100
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- Saved */

function SavedSection({
  savedListings,
  savedAreas,
  apartmentsHref,
  onToggleArea,
  onRemoveListing,
  syncError,
}: {
  savedListings: SavedListing[];
  savedAreas: string[];
  apartmentsHref: string;
  onToggleArea: (label: string, nextSaved: boolean) => void;
  onRemoveListing: (listing: SavedListing) => void;
  syncError: string | null;
}) {
  return (
    <section aria-labelledby="plan-saved-heading">
      <SectionHeader id="plan-saved-heading" title="Saved" />
      {syncError ? (
        <p role="status" className="mt-2 text-[12.5px] font-medium text-[#9f3326]">
          {syncError}
        </p>
      ) : null}

      <div className="mt-5 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <SubLabel>Apartments</SubLabel>
          {savedListings.length === 0 ? (
            <EmptyState
              compact
              icon={Building2}
              title="Nothing saved yet"
              body="Tap the heart on a listing to keep it here."
              action={
                <Link
                  href={apartmentsHref}
                  className="kin-focus inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--pp-mint)] transition hover:underline"
                >
                  Open the map <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              }
            />
          ) : (
            <ul className="mt-3 space-y-2.5">
              {savedListings.map((listing) => (
                <li
                  key={listing.savedId}
                  className="group flex items-center gap-3 rounded-2xl border border-[var(--pp-hairline)] bg-[var(--pp-canvas)] p-2.5 pr-3"
                >
                  <span
                    aria-hidden="true"
                    className="h-14 w-16 shrink-0 rounded-xl bg-cover bg-center"
                    style={{
                      backgroundImage: listing.photoUrl
                        ? `url(${listing.photoUrl})`
                        : "linear-gradient(135deg, var(--pp-canvas-soft), var(--pp-hairline))",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-[var(--pp-ink)]">
                      {listing.address}
                    </p>
                    <p className="mt-0.5 truncate text-[12.5px] text-[var(--pp-ink-60)]">
                      {listing.neighborhood}
                      {listing.beds ? ` · ${listing.beds}` : ""}
                    </p>
                    <p className="mt-0.5 text-[12.5px] font-medium text-[var(--pp-ink-80)]">
                      {listing.perPersonRent
                        ? `${formatCurrency(listing.perPersonRent)}/mo each`
                        : listing.monthlyRent
                          ? `${formatCurrency(listing.monthlyRent)}/mo`
                          : "Ask"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveListing(listing)}
                    aria-label={`Remove ${listing.address} from saved`}
                    className="kin-focus grid size-8 shrink-0 place-items-center rounded-full text-[var(--pp-ink-40)] transition hover:bg-[var(--pp-canvas-soft)] hover:text-[var(--pp-ink-80)]"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <SubLabel>Areas</SubLabel>
          <AreaEditor savedAreas={savedAreas} onToggle={onToggleArea} />
        </div>
      </div>
    </section>
  );
}

function AreaEditor({
  savedAreas,
  onToggle,
}: {
  savedAreas: string[];
  onToggle: (label: string, nextSaved: boolean) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = normalizeSavedAreaLabel(draft);
    if (!value) return;
    if (!savedAreas.some((area) => savedAreaLabelKey(area) === savedAreaLabelKey(value))) {
      onToggle(value, true);
    }
    setDraft("");
  };

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Add a neighborhood"
          aria-label="Add a neighborhood to saved areas"
          className="kin-focus min-h-10 flex-1 rounded-full border border-[var(--pp-hairline)] bg-[var(--pp-canvas)] px-4 text-[13.5px] text-[var(--pp-ink)] outline-none transition placeholder:text-[var(--pp-ink-40)] focus-visible:border-[var(--pp-hairline-strong)]"
        />
        <button
          type="button"
          onClick={add}
          disabled={normalizeSavedAreaLabel(draft).length === 0}
          className="kin-focus grid size-10 shrink-0 place-items-center rounded-full bg-[var(--pp-ink)] text-white transition hover:bg-[#264a36] disabled:opacity-40"
          aria-label="Save area"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      {savedAreas.length === 0 ? (
        <p className="mt-3 text-[12.5px] leading-5 text-[var(--pp-ink-60)]">
          Neighborhoods you save sharpen your matches.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {savedAreas.map((area) => (
            <li key={area}>
              <button
                type="button"
                onClick={() => onToggle(area, false)}
                className="kin-focus group inline-flex items-center gap-1.5 rounded-full border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] py-1.5 pl-3 pr-2 text-[12.5px] font-medium text-[var(--pp-ink-80)] transition hover:border-[var(--pp-ink-40)]"
                aria-label={`Remove ${area} from saved areas`}
              >
                {area}
                <X
                  size={13}
                  aria-hidden="true"
                  className="text-[var(--pp-ink-40)] transition group-hover:text-[var(--pp-ink-80)]"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Matcher */

function MatcherSection({
  enabled,
  readiness,
  onToggle,
}: {
  enabled: boolean;
  readiness: QuietWatchReadiness;
  onToggle: (enabled: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const disabled = pending || (!enabled && !readiness.canEnable);
  const readinessId = "plan-matcher-readiness";

  return (
    <section
      aria-labelledby="plan-matcher-heading"
      className="flex items-start justify-between gap-4 border-t border-[var(--pp-hairline)] pt-8"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2
            id="plan-matcher-heading"
            className="pp-serif text-[19px] leading-tight tracking-[-0.01em] text-[var(--pp-ink)]"
          >
            Quiet watch
          </h2>
          <span className="rounded-full bg-[var(--pp-canvas-soft)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--pp-ink-50)]">
            Coming soon
          </span>
        </div>
        <p className="mt-1.5 max-w-[56ch] text-[13px] leading-6 text-[var(--pp-ink-60)]">
          Alerts haven&apos;t shipped yet — watching starts when they do. Turning this on now means
          that once they&apos;re live, Kinfolk taps you only when a match is genuinely worth it. No
          feed, no nudges.
        </p>
        <p
          id={readinessId}
          className={`mt-2 text-[12.5px] leading-5 ${
            readiness.canEnable ? "text-[var(--pp-ink-60)]" : "text-[#9f3326]"
          }`}
        >
          {readiness.message}
        </p>
      </div>
      <Toggle
        checked={enabled}
        describedBy={readinessId}
        disabled={disabled}
        onChange={(next) => startTransition(() => onToggle(next))}
        label="Quiet watch"
      />
    </section>
  );
}

/* ------------------------------------------------------------- Primitives */

function SectionHeader({
  id,
  title,
  note,
  trailing,
}: {
  id: string;
  title: string;
  note?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div>
        <h2
          id={id}
          className="pp-serif text-[19px] leading-tight tracking-[-0.01em] text-[var(--pp-ink)]"
        >
          {title}
        </h2>
        {note ? <p className="mt-1 text-[12.5px] text-[var(--pp-ink-60)]">{note}</p> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13px] font-semibold text-[var(--pp-ink-80)]">{children}</h3>;
}

function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline gap-2">
        <p className="text-[13px] font-semibold text-[var(--pp-ink-80)]">{label}</p>
        {optional ? <span className="text-[12px] text-[var(--pp-ink-40)]">optional</span> : null}
        {hint ? <span className="text-[12px] text-[var(--pp-ink-40)]">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function CityChipEditor({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const selectedSuggestion = useRef<LocationSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const add = () => {
    const result = addFutureCityChip(values, draft, selectedSuggestion.current);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.values !== values) {
      onChange(result.values);
    }
    if (result.clearInput) {
      setDraft("");
      selectedSuggestion.current = null;
    }
    setError(null);
  };

  const remove = (value: string) => onChange(removeFutureCityChip(values, value));

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pp-canvas-soft)] py-1.5 pl-3 pr-2 text-[13px] font-medium text-[var(--pp-ink-80)]"
          >
            {value}
            <button
              type="button"
              onClick={() => remove(value)}
              aria-label={`Remove ${value}`}
              className="kin-focus grid size-4 place-items-center rounded-full text-[var(--pp-ink-40)] transition hover:text-[var(--pp-ink-80)]"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        ))}
        <span className="inline-flex min-h-8 min-w-[210px] items-center gap-1.5 rounded-full border border-dashed border-[var(--pp-hairline-strong)] py-1 pl-3 pr-1.5">
          <LocationAutocomplete
            value={draft}
            onChange={(next) => {
              setDraft(next);
              setError(null);
              if (next.trim().length === 0) {
                selectedSuggestion.current = null;
              } else if (
                selectedSuggestion.current &&
                !locationLabelsMatch(next, selectedSuggestion.current.label)
              ) {
                selectedSuggestion.current = null;
              }
            }}
            onSelect={(suggestion) => {
              selectedSuggestion.current = suggestion;
              setError(null);
            }}
            ariaLabel="Add a future city"
            ariaDescribedBy={error ? errorId : undefined}
            ariaInvalid={Boolean(error)}
            className="min-w-0 flex-1"
            inputClassName="h-6 rounded-none border-0 bg-transparent px-0 py-0 text-[13px] outline-none placeholder:text-[var(--pp-ink-40)] focus-visible:ring-0"
            maxLength={80}
            placeholder="Add a city"
          />
          <button
            type="button"
            onClick={add}
            disabled={draft.trim().length === 0}
            className="kin-focus grid size-6 place-items-center rounded-full bg-[var(--pp-ink)] text-white transition hover:bg-[#264a36] disabled:opacity-40"
            aria-label="Add city"
          >
            <Plus size={13} aria-hidden="true" />
          </button>
        </span>
      </div>
      {values.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-[var(--pp-ink-60)]">Where do you want to land?</p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-2 text-[12.5px] text-[#9f3326]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onSelect: (value: T) => void;
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(option.value)}
              className={`kin-focus rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                active
                  ? "border-[var(--pp-ink)] bg-[var(--pp-ink)] text-white"
                  : "border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] text-[var(--pp-ink-80)] hover:border-[var(--pp-ink-40)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Toggle({
  checked,
  describedBy,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  describedBy?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={describedBy}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`kin-focus relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-60 ${
        checked ? "bg-[var(--pp-mint)]" : "bg-[var(--pp-hairline-strong)]"
      }`}
    >
      <span
        className={`inline-block size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function SaveBadge({ state }: { state: PlanSaveState }) {
  if (state === "idle") return null;
  const { icon, text, tone } = SAVE_BADGE_STATES[state];
  return (
    <output
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${tone}`}
    >
      {icon}
      {text}
    </output>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  compact,
}: {
  icon: typeof UserPlus;
  title: string;
  body: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`${compact ? "mt-3 px-5 py-6" : "mt-5 px-6 py-9"} rounded-2xl border border-dashed border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] text-center`}
    >
      <span
        aria-hidden="true"
        className="mx-auto grid size-10 place-items-center rounded-full bg-[var(--pp-canvas-soft)] text-[var(--pp-ink-40)]"
      >
        <Icon size={18} strokeWidth={1.7} />
      </span>
      <p className="mt-3 text-[14.5px] font-semibold text-[var(--pp-ink)]">{title}</p>
      <p className="mx-auto mt-1 max-w-[44ch] text-[13px] leading-5 text-[var(--pp-ink-60)]">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
