"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Image from "next/image";
import { useEffect, useReducer, useState } from "react";
import { MessageCircle, QrCode, X } from "lucide-react";
import type { ContinueOnPhoneConfig } from "@/lib/integrations/continue-on-phone";
import type {
  ProfileSetupProgress,
  ProfileSetupState,
  ProfileSetupTask,
} from "@/lib/profiles/completion";
import type { MatchingPreferencesView } from "@/lib/profiles/view";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import {
  normalizeStructuredFactValue,
  structuredFactOptions,
  structuredFactValueLabel,
} from "@/lib/profiles/fact-normalization";
import {
  normalizePhoneChallengeResponse,
  readJsonResponse,
  readResponseErrorMessage,
  usePhoneHandoff,
} from "../use-phone-handoff";
import {
  cleanPreferenceSummary,
  formatBudgetSummary,
  formatAgeComfortSummary,
  formatListSummary,
  formatRoommateOpennessSummary,
  formatMoveByDate,
} from "./format";
import { resolveAgeComfortSave } from "./matching-basics-state";
import {
  addPreferenceDraft,
  normalizePreferenceList,
  PREFERENCE_TAG_MAX_LENGTH,
} from "./preference-list-state";
import {
  canReusePhoneHandoff,
  getVerifiedPhone,
  resolvePhoneStatusCheck,
} from "./phone-status-state";
import {
  EditorLabel,
  InlineError,
  LedgerRowCloseProvider,
  patchReducer,
  PrimaryButton,
  QuietButton,
  saveField,
  useLedgerRowClose,
} from "./shared";
import { BudgetSetupEditor } from "./BudgetSetupEditor";
import { MoveInSetupEditor } from "./MoveInSetupEditor";
import { HouseholdSetupEditor } from "./HouseholdSetupEditor";

type TextHandoff = {
  code?: string;
  expiresAt?: string;
  kind?: "agent_thread" | "verification_challenge";
  link: string;
  message?: string;
  phoneNumber: string;
};

type TextHandoffResponse = {
  challenge?: TextHandoff;
  error?: string;
  success?: boolean;
};

type PhoneStatusResponse = {
  error?: string;
  phone?: string;
  phoneVerified?: boolean;
  phoneVerifiedAt?: string | null;
  smsConsentState?: string | null;
};

export function MatchingBasicsSection({
  continueOnPhoneConfig,
  matching,
  setup,
  progress,
  onSetupChange,
  onMatchingChange,
  setError,
}: {
  continueOnPhoneConfig: ContinueOnPhoneConfig;
  matching: MatchingPreferencesView;
  setup: ProfileSetupState;
  progress: ProfileSetupProgress;
  onSetupChange: (next: ProfileSetupState) => void;
  onMatchingChange: (next: MatchingPreferencesView) => void;
  setError: (message: string | null) => void;
}) {
  const phoneTask = taskByKey(progress, "phone");
  const ageComfortTask = taskByKey(progress, "ageComfort");
  const interviewTask = taskByKey(progress, "interview");

  const budgetSummary = formatBudgetSummary(setup.budgetMin, setup.budgetMax);
  const ageComfortSummary = formatAgeComfortSummary(setup);
  const moveBySummary =
    setup.moveInStart && setup.moveInEnd
      ? formatMoveByDate(setup.moveInStart, setup.moveInEnd)
      : undefined;
  const roommateSummary = formatRoommateOpennessSummary(
    setup.householdSizeMin,
    setup.householdSizeMax,
  ) ?? cleanPreferenceSummary(matching.roommateOpenness);
  const locationSummary = formatListSummary(matching.neighborhoods);
  const interviewStatus = setup.interviewStatus.toLowerCase();
  const interviewValue = interviewStatusLabel(setup.interviewStatus) || "Not started";
  const interviewAction =
    interviewTask.isComplete
      ? "Edit"
      : interviewStatus === "in_progress" || interviewStatus === "needs_review"
        ? "Continue"
        : "Start";

  return (
    <section className="mt-10">
      <div className="text-center">
        <div className="flex items-center gap-3.5">
          <span aria-hidden className="h-px flex-1 bg-[var(--pp-hairline)]" />
          <h2 className="pp-mono m-0 text-[10.5px] uppercase tracking-[0.18em] text-[var(--pp-ink-40)]">
            Matching preferences
          </h2>
          <span aria-hidden className="h-px flex-1 bg-[var(--pp-hairline)]" />
        </div>
      </div>

      <div className="mt-5">
        <LedgerRow
          actionLabel={phoneTask.isComplete ? undefined : "Verify"}
          id="setup-phone"
          key={`phone:${setup.phoneVerified ? setup.phone : "unverified"}`}
          label="Phone"
          state={phoneTask.isComplete ? "set" : "todo"}
          trailing={phoneTask.isComplete ? <VerifiedBadge /> : undefined}
          value={phoneTask.isComplete ? setup.phone : "Not verified"}
        >
          <PhoneVerificationControl
            config={continueOnPhoneConfig}
            onVerified={(phone) => onSetupChange({ ...setup, phone, phoneVerified: true })}
            setup={setup}
            setError={setError}
          />
        </LedgerRow>

        <LedgerRow
          actionLabel={budgetSummary ? "Edit" : "Add"}
          id="setup-budget"
          key={`budget:${setup.budgetMin}:${setup.budgetMax}`}
          label="Budget"
          state={budgetSummary ? "set" : "todo"}
          value={budgetSummary ?? "Not set"}
        >
          <BudgetSetupEditor setup={setup} onSetupChange={onSetupChange} setError={setError} />
        </LedgerRow>

        <LedgerRow
          actionLabel={setup.age ? "Edit" : "Add"}
          id="setup-age-comfort"
          key={`age-comfort:${setup.age}:${setup.preferredAgeMin}:${setup.preferredAgeMax}:${setup.preferredAgeStrict}`}
          label="Age range"
          state={ageComfortTask.isComplete ? "set" : "todo"}
          value={ageComfortSummary}
        >
          <AgeComfortSetupEditor setup={setup} onSetupChange={onSetupChange} setError={setError} />
        </LedgerRow>

        <LedgerRow
          actionLabel={locationSummary ? "Edit" : "Add"}
          id="setup-locations"
          key={`locations:${locationSummary ?? "none"}`}
          label="Locations"
          state={locationSummary ? "set" : "todo"}
          value={locationSummary ?? "Not set"}
        >
          <PreferenceListEditor
            currentValues={matching.neighborhoods}
            factKey="neighborhoods"
            onSaved={(values) => onMatchingChange({ ...matching, neighborhoods: values })}
            placeholder="Add an SF neighborhood"
            setError={setError}
          />
        </LedgerRow>

        <LedgerRow
          actionLabel={moveBySummary ? "Edit" : "Add"}
          id="setup-move-in"
          key={`move-in:${setup.moveInStart}:${setup.moveInEnd}`}
          label="Move by"
          state={moveBySummary ? "set" : "todo"}
          value={moveBySummary ?? "Not set"}
        >
          <MoveInSetupEditor setup={setup} onSetupChange={onSetupChange} setError={setError} />
        </LedgerRow>

        <LedgerRow
          actionLabel={roommateSummary ? "Edit" : "Add"}
          id="setup-household"
          key={`household:${setup.householdSizeMin}:${setup.householdSizeMax}`}
          label="Roommates"
          state={roommateSummary ? "set" : "todo"}
          value={roommateSummary ?? "Not set"}
        >
          <HouseholdSetupEditor setup={setup} onSetupChange={onSetupChange} setError={setError} />
        </LedgerRow>

        <MatchingPreferenceRows
          matching={matching}
          onMatchingChange={onMatchingChange}
          setError={setError}
        />

        <LedgerRow
          actionLabel={interviewAction}
          id="setup-interview"
          key={`interview:${setup.interviewStatus}`}
          label="Interview"
          state={
            interviewTask.isComplete
              ? "set"
              : interviewStatus === "not_started"
                ? "optional"
                : "todo"
          }
          value={interviewValue}
        >
          <InterviewSetupAction
            config={continueOnPhoneConfig}
            onStarted={() => onSetupChange({ ...setup, interviewStatus: "in_progress" })}
            status={setup.interviewStatus}
          />
        </LedgerRow>
      </div>
    </section>
  );
}

function MatchingPreferenceRows({
  matching,
  onMatchingChange,
  setError,
}: {
  matching: MatchingPreferencesView;
  onMatchingChange: (next: MatchingPreferencesView) => void;
  setError: (message: string | null) => void;
}) {
  const petsSummary = preferenceSummary("pets", matching.pets);
  const mustHavesSummary = formatListSummary(matching.mustHaves);
  const dealbreakersSummary = formatListSummary(matching.dealbreakers);
  const cleanlinessSummary = preferenceSummary("cleanliness", matching.cleanliness);
  const noiseSummary = preferenceSummary("noise_tolerance", matching.noiseTolerance);
  const sleepSummary = preferenceSummary("sleep_schedule", matching.sleepSchedule);
  const workFromHomeSummary = preferenceSummary(
    "work_from_home",
    matching.workFromHome,
  );
  const socialSummary = preferenceSummary("social_energy", matching.socialEnergy);
  const hostingSummary = preferenceSummary("guests", matching.hostingExpectations);
  const communicationSummary = preferenceSummary(
    "communication_style",
    matching.communicationStyle,
  );
  const conflictSummary = preferenceSummary(
    "conflict_repair",
    matching.conflictRepair,
  );
  const flexibilitySummary =
    preferenceSummary("rent_tradeoff", matching.flexibilityNotes) ??
    cleanPreferenceSummary(matching.flexibilityNotes);

  return (
    <>
      <LedgerRow
        actionLabel={petsSummary ? "Edit" : "Add"}
        id="setup-pets"
        key={`pets:${petsSummary ?? "none"}`}
        label="Pets"
        state={petsSummary ? "set" : "todo"}
        value={petsSummary ?? "Not set"}
      >
        <PreferenceChoiceEditor
          currentValue={matching.pets}
          factKey="pets"
          onSaved={(value) => onMatchingChange({ ...matching, pets: value })}
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={cleanlinessSummary ? "Edit" : "Add"}
        id="setup-cleanliness"
        key={`cleanliness:${cleanlinessSummary ?? "none"}`}
        label="Cleanliness"
        state={cleanlinessSummary ? "set" : "todo"}
        value={cleanlinessSummary ?? "Not set"}
      >
        <PreferenceChoiceEditor
          currentValue={matching.cleanliness}
          factKey="cleanliness"
          onSaved={(value) => onMatchingChange({ ...matching, cleanliness: value })}
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={mustHavesSummary ? "Edit" : "Add"}
        id="setup-must-haves"
        key={`must-haves:${mustHavesSummary ?? "none"}`}
        label="Must-haves"
        state={mustHavesSummary ? "set" : "todo"}
        value={mustHavesSummary ?? "Not set"}
      >
        <PreferenceListEditor
          currentValues={matching.mustHaves}
          factKey="must_haves"
          onSaved={(values) => onMatchingChange({ ...matching, mustHaves: values })}
          placeholder="e.g. in-unit laundry"
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={noiseSummary ? "Edit" : "Add"}
        id="setup-noise"
        key={`noise:${noiseSummary ?? "none"}`}
        label="Noise"
        state={noiseSummary ? "set" : "todo"}
        value={noiseSummary ?? "Not set"}
      >
        <PreferenceChoiceEditor
          currentValue={matching.noiseTolerance}
          factKey="noise_tolerance"
          onSaved={(value) => onMatchingChange({ ...matching, noiseTolerance: value })}
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={dealbreakersSummary ? "Edit" : "Add"}
        id="setup-dealbreakers"
        key={`dealbreakers:${dealbreakersSummary ?? "none"}`}
        label="Dealbreakers"
        state={dealbreakersSummary ? "set" : "todo"}
        value={dealbreakersSummary ?? "Not set"}
      >
        <PreferenceListEditor
          currentValues={matching.dealbreakers}
          factKey="dealbreakers"
          onSaved={(values) => onMatchingChange({ ...matching, dealbreakers: values })}
          placeholder="e.g. no smoking indoors"
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={sleepSummary ? "Edit" : "Add"}
        id="setup-sleep"
        key={`sleep:${sleepSummary ?? "none"}`}
        label="Sleep"
        state={sleepSummary ? "set" : "todo"}
        value={sleepSummary ?? "Not set"}
      >
        <PreferenceChoiceEditor
          currentValue={matching.sleepSchedule}
          factKey="sleep_schedule"
          onSaved={(value) => onMatchingChange({ ...matching, sleepSchedule: value })}
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={workFromHomeSummary ? "Edit" : "Add"}
        id="setup-work-from-home"
        key={`work-from-home:${workFromHomeSummary ?? "none"}`}
        label="WFH"
        state={workFromHomeSummary ? "set" : "todo"}
        value={workFromHomeSummary ?? "Not set"}
      >
        <PreferenceChoiceEditor
          currentValue={matching.workFromHome}
          factKey="work_from_home"
          onSaved={(value) => onMatchingChange({ ...matching, workFromHome: value })}
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={socialSummary ? "Edit" : "Add"}
        id="setup-social"
        key={`social:${socialSummary ?? "none"}`}
        label="Social"
        state={socialSummary ? "set" : "todo"}
        value={socialSummary ?? "Not set"}
      >
        <PreferenceChoiceEditor
          currentValue={matching.socialEnergy}
          factKey="social_energy"
          onSaved={(value) => onMatchingChange({ ...matching, socialEnergy: value })}
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={hostingSummary ? "Edit" : "Add"}
        id="setup-hosting"
        key={`hosting:${hostingSummary ?? "none"}`}
        label="Guests"
        state={hostingSummary ? "set" : "todo"}
        value={hostingSummary ?? "Not set"}
      >
        <PreferenceChoiceEditor
          currentValue={matching.hostingExpectations}
          factKey="guests"
          onSaved={(value) => onMatchingChange({ ...matching, hostingExpectations: value })}
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={communicationSummary ? "Edit" : "Add"}
        id="setup-communication"
        key={`communication:${communicationSummary ?? "none"}`}
        label="Comm"
        state={communicationSummary ? "set" : "todo"}
        value={communicationSummary ?? "Not set"}
      >
        <PreferenceChoiceEditor
          currentValue={matching.communicationStyle}
          factKey="communication_style"
          onSaved={(value) => onMatchingChange({ ...matching, communicationStyle: value })}
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={conflictSummary ? "Edit" : "Add"}
        id="setup-conflict"
        key={`conflict:${conflictSummary ?? "none"}`}
        label="Conflict"
        state={conflictSummary ? "set" : "todo"}
        value={conflictSummary ?? "Not set"}
      >
        <PreferenceChoiceEditor
          currentValue={matching.conflictRepair}
          factKey="conflict_repair"
          onSaved={(value) => onMatchingChange({ ...matching, conflictRepair: value })}
          setError={setError}
        />
      </LedgerRow>

      <LedgerRow
        actionLabel={flexibilitySummary ? "Edit" : "Add"}
        id="setup-flexibility"
        key={`flexibility:${flexibilitySummary ?? "none"}`}
        label="Flex"
        state={flexibilitySummary ? "set" : "todo"}
        value={flexibilitySummary ?? "Not set"}
      >
        <PreferenceChoiceEditor
          currentValue={matching.flexibilityNotes}
          factKey="rent_tradeoff"
          onSaved={(value) => onMatchingChange({ ...matching, flexibilityNotes: value })}
          setError={setError}
        />
      </LedgerRow>
    </>
  );
}

function LedgerRow({
  actionLabel,
  children,
  id,
  label,
  state,
  trailing,
  value,
}: {
  actionLabel?: string;
  children: React.ReactNode;
  id: string;
  label: string;
  state: "set" | "todo" | "optional";
  trailing?: React.ReactNode;
  value: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const actionAccessibleLabel = actionLabel ? `${actionLabel} ${label}` : undefined;

  const labelEl = (
    <span className="pp-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--pp-ink-40)]">
      {label}
    </span>
  );

  return (
    <section
      className="scroll-mt-8 border-b border-[var(--pp-hairline)] py-3.5 last:border-b-0"
      id={id}
    >
      {isEditing ? (
        <div>
          <div className="flex items-center justify-between gap-3">
            {labelEl}
            <button
              aria-label={`Cancel editing ${label}`}
              className="kin-focus rounded-full px-2 py-1 text-[12px] font-medium text-[var(--pp-ink-40)] transition hover:text-[var(--pp-ink)]"
              onClick={() => setIsEditing(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
          <LedgerRowCloseProvider value={() => setIsEditing(false)}>
            <div className="mt-3">{children}</div>
          </LedgerRowCloseProvider>
        </div>
      ) : (
        <div className="grid grid-cols-[104px_1fr_auto] items-center gap-4">
          {labelEl}
          <span
            className={`flex items-center gap-1.5 text-[14px] leading-[1.5] ${
              state === "set" ? "text-[var(--pp-ink-80)]" : "text-[var(--pp-ink-60)]"
            }`}
          >
            {state === "todo" ? (
              <span aria-hidden className="size-[6px] shrink-0 rounded-full bg-[var(--pp-mint)]" />
            ) : null}
            {value}
            {state === "optional" ? (
              <span className="text-[var(--pp-ink-40)]">· optional</span>
            ) : null}
          </span>
          {actionLabel ? (
            <button
              aria-label={actionAccessibleLabel}
              className={`kin-focus rounded-full px-2 py-1 text-[12px] font-medium transition ${
                state === "set"
                  ? "text-[var(--pp-ink-40)] hover:text-[var(--pp-ink)]"
                  : "text-[#264a36] hover:text-[#1c3526]"
              }`}
              onClick={() => setIsEditing(true)}
              type="button"
            >
              {actionLabel}
            </button>
          ) : trailing ? (
            <div className="flex justify-end">{trailing}</div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PhoneVerificationControl({
  config,
  setup,
  onVerified,
  setError,
}: {
  config: ContinueOnPhoneConfig;
  setup: ProfileSetupState;
  onVerified: (phone: string) => void;
  setError: (message: string | null) => void;
}) {
  const [handoff, setHandoff] = useState<TextHandoff | null>(null);
  const [busy, setBusy] = useState<"handoff" | "check" | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const verifiedPhone = getVerifiedPhone(setup);

  if (verifiedPhone) {
    return (
      <p className="m-0 text-[12.5px] text-[var(--pp-ink-60)]">
        {verifiedPhone} is verified by texting Kinfolk.
      </p>
    );
  }

  async function prepareHandoff() {
    if (!config.agentEnabled) {
      throw new Error("Kinfolk texting is not configured.");
    }

    setInlineError(null);
    setError(null);
    setBusy("handoff");
    try {
      const response = await fetch(config.challengeEndpoint, { method: "POST" });
      const data = await readJsonResponse<TextHandoffResponse>(response);
      const nextHandoff = normalizePhoneChallengeResponse(data);
      if (!response.ok || nextHandoff?.kind !== "verification_challenge") {
        throw new Error(readResponseErrorMessage(data, "Could not prepare Messages."));
      }
      setHandoff(nextHandoff);
      return nextHandoff;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not prepare Messages.";
      setInlineError(message);
      setError(message);
      throw error;
    } finally {
      setBusy(null);
    }
  }

  async function openMessages() {
    try {
      const reusableHandoff = canReusePhoneHandoff(handoff) ? handoff : null;
      const nextHandoff = reusableHandoff ?? (await prepareHandoff());
      window.location.href = nextHandoff.link;
    } catch {
      // Inline error state is set in prepareHandoff.
    }
  }

  async function checkStatus() {
    setInlineError(null);
    setError(null);
    setBusy("check");
    try {
      const response = await fetch("/api/kinfolk/profile/phone", { method: "GET" });
      const data = await readJsonResponse<PhoneStatusResponse>(response);
      if (!response.ok || data.error) {
        throw new Error(readResponseErrorMessage(data, "Could not check phone verification."));
      }
      const status = resolvePhoneStatusCheck(data, config.agentEnabled);
      if (status.kind === "verified") {
        onVerified(status.phone);
        return;
      }
      setInlineError(status.message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not check phone verification.";
      setInlineError(message);
      setError(message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton
          onClick={openMessages}
          disabled={busy !== null || !config.agentEnabled}
          loading={busy === "handoff"}
        >
          Open Messages
        </PrimaryButton>
        <QuietButton onClick={checkStatus} disabled={busy !== null}>
          {busy === "check" ? "Checking..." : "Check status"}
        </QuietButton>
      </div>
      {handoff?.message ? (
        <div className="rounded-xl border border-[var(--pp-hairline)] bg-[var(--pp-canvas)] px-3 py-2 text-[12.5px] leading-[1.45] text-[var(--pp-ink-60)]">
          <span>Text </span>
          <span className="pp-mono text-[var(--pp-ink)]">{handoff.message}</span>
          <span> to </span>
          <span className="pp-mono text-[var(--pp-ink)]">{handoff.phoneNumber}</span>
          <span>, then check status.</span>
        </div>
      ) : null}
      {!config.agentEnabled ? (
        <p className="m-0 text-[12.5px] text-[#8a4b20]">
          Kinfolk texting is not configured.
        </p>
      ) : null}
      <InlineError message={inlineError} />
    </div>
  );
}

function InterviewSetupAction({
  config,
  onStarted,
  status,
}: {
  config: ContinueOnPhoneConfig;
  onStarted: () => void;
  status: string;
}) {
  const {
    handoff,
    challengeError: error,
    challengeLoading: loading,
    ensureHandoff,
    qrTarget,
    requestQrCode,
    qrCodeUrl,
    qrError,
    qrLoading,
  } = usePhoneHandoff({
    config,
    challengeEndpoint: "/api/kinfolk/interview/handoff",
    onHandoffCreated: onStarted,
    disabledMessage: "Kinfolk texting is not configured.",
    challengeErrorMessage: "Could not prepare Messages.",
  });
  const [modalOpen, setModalOpen] = useState(false);
  const normalizedStatus = status.toLowerCase();
  const isComplete = normalizedStatus === "completed";
  const label = interviewStatusLabel(status);
  // The QR only loads once its modal is open, so the button reflects that.
  const qrButtonBusy = modalOpen && qrLoading;

  async function openMessages() {
    try {
      const nextHandoff = await ensureHandoff();
      window.location.href = nextHandoff.link;
    } catch {
      // Inline error state is set in ensureHandoff.
    }
  }

  function openQr() {
    setModalOpen(true);
    void ensureHandoff().catch(() => undefined);
  }

  // Fetch the QR once the handoff (and therefore its target) is ready while the
  // modal is open. The hook de-duplicates and guards the result against the
  // exact target it was generated for.
  useEffect(() => {
    if (!modalOpen || !qrTarget) {
      return;
    }
    requestQrCode();
  }, [modalOpen, qrTarget, requestQrCode]);

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="kin-focus inline-flex items-center gap-1.5 rounded-full border border-[var(--pp-hairline-strong)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--pp-ink-80)] transition hover:bg-[rgba(28,51,38,0.04)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || !config.agentEnabled}
          onClick={openMessages}
          type="button"
        >
          <MessageCircle size={13} strokeWidth={1.8} aria-hidden />
          {loading ? "Preparing…" : "Open Messages"}
        </button>
        <button
          aria-label="Show interview QR code"
          className="kin-focus grid size-8 place-items-center rounded-full border border-[var(--pp-hairline-strong)] text-[var(--pp-ink-60)] transition hover:bg-[rgba(28,51,38,0.04)] hover:text-[var(--pp-ink)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || qrButtonBusy || !config.agentEnabled}
          onClick={openQr}
          title="Show QR code"
          type="button"
        >
          <QrCode size={14} strokeWidth={1.8} aria-hidden />
        </button>
        {label ? (
          <span className="text-[12.5px] text-[var(--pp-ink-40)]">{label}</span>
        ) : null}
      </div>
      <InlineError message={error} />
      {!config.agentEnabled ? (
        <p className="m-0 text-[12.5px] leading-5 text-[#8a4b20]">
          Texting is not configured for this environment.
        </p>
      ) : isComplete ? (
        <p className="m-0 text-[12.5px] leading-5 text-[var(--pp-ink-60)]">
          You can reopen the thread to add changes.
        </p>
      ) : null}
      <InterviewQrModal
        error={error}
        handoff={handoff}
        loading={loading}
        onClose={() => setModalOpen(false)}
        open={modalOpen}
        qrCodeUrl={qrCodeUrl}
        qrError={qrError}
        qrLoading={qrLoading}
      />
    </div>
  );
}

function InterviewQrModal({
  error,
  handoff,
  loading,
  onClose,
  open,
  qrCodeUrl,
  qrError,
  qrLoading,
}: {
  error: string | null;
  handoff: TextHandoff | null;
  loading: boolean;
  onClose: () => void;
  open: boolean;
  qrCodeUrl: string | null;
  qrError: string | null;
  qrLoading: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0f1a14]/35 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[rgba(28,51,38,0.12)] bg-[#fdfcf8] p-5 text-center text-[#0f1a14] shadow-[0_30px_80px_-30px_rgba(14,31,23,0.35)]">
          <Dialog.Close asChild>
            <button
              aria-label="Close"
              className="kin-focus absolute right-3 top-3 grid size-8 place-items-center rounded-full text-[#6b7a70] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[#0f1a14]"
              type="button"
            >
              <X aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </Dialog.Close>
          <Dialog.Title asChild>
            <h2 className="pp-serif pr-8 text-left text-[28px] leading-none tracking-[-0.02em]">
              Interview
            </h2>
          </Dialog.Title>
        <div className="mt-5 grid place-items-center">
          <div className="grid size-[240px] place-items-center rounded-xl border border-[rgba(28,51,38,0.12)] bg-white p-3 shadow-sm">
            {loading ? (
              <span className="text-[13px] text-[#6b7a70]">Preparing&hellip;</span>
            ) : error ? (
              <span className="px-4 text-[13px] leading-5 text-[#8a4b20]">{error}</span>
            ) : qrLoading ? (
              <span className="text-[13px] text-[#6b7a70]">Generating QR&hellip;</span>
            ) : qrError ? (
              <span className="px-4 text-[13px] leading-5 text-[#8a4b20]">{qrError}</span>
            ) : qrCodeUrl ? (
              <Image
                alt="Messages QR code"
                className="size-full rounded-md"
                height={216}
                src={qrCodeUrl}
                unoptimized
                width={216}
              />
            ) : null}
          </div>
          {handoff?.link ? (
            <a
              className="kin-focus mt-4 inline-flex items-center gap-1.5 rounded-full border border-[rgba(28,51,38,0.12)] px-3 py-1.5 text-[12.5px] font-medium text-[#1f2a23] transition hover:bg-[rgba(28,51,38,0.04)]"
              href={handoff.link}
            >
              Open Messages
              <MessageCircle aria-hidden="true" size={13} strokeWidth={1.8} />
            </a>
          ) : null}
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function interviewStatusLabel(status: string) {
  switch (status.toLowerCase()) {
    case "completed":
      return "Complete";
    case "in_progress":
      return "In progress";
    case "needs_review":
      return "Needs review";
    case "scheduled":
      return "Scheduled";
    default:
      return "";
  }
}

function AgeComfortSetupEditor({
  setup,
  onSetupChange,
  setError,
}: {
  setup: ProfileSetupState;
  onSetupChange: (next: ProfileSetupState) => void;
  setError: (message: string | null) => void;
}) {
  const [{ age, busy, inlineError, max, min, strict }, updateEditor] = useReducer(
    patchReducer<{
      age: string;
      busy: boolean;
      inlineError: string | null;
      max: string;
      min: string;
      strict: boolean;
    }>,
    setup,
    (initialSetup) => ({
      age: initialSetup.age != null ? String(initialSetup.age) : "",
      busy: false,
      inlineError: null,
      max: initialSetup.preferredAgeMax != null ? String(initialSetup.preferredAgeMax) : "",
      min: initialSetup.preferredAgeMin != null ? String(initialSetup.preferredAgeMin) : "",
      strict: initialSetup.preferredAgeStrict,
    }),
  );
  const closeRow = useLedgerRowClose();
  const hasAgeRangeInput = min.trim() !== "" || max.trim() !== "";

  async function commit() {
    updateEditor({ inlineError: null });
    setError(null);

    const saved = resolveAgeComfortSave({
      ageDraft: age,
      minDraft: min,
      maxDraft: max,
      strict: hasAgeRangeInput ? strict : setup.preferredAgeStrict,
    });
    if (!saved.ok) {
      updateEditor({ inlineError: saved.error });
      return;
    }

    updateEditor({ busy: true });
    try {
      await saveField(saved.patch);
      onSetupChange({
        ...setup,
        ...saved.display,
      });
      closeRow();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Age comfort update failed.";
      updateEditor({ inlineError: message });
      setError(message);
    } finally {
      updateEditor({ busy: false });
    }
  }

  return (
    <div className="grid gap-2.5">
      <EditorLabel label="Your age">
        <input
          aria-label="Your age"
          className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[14px] text-[var(--pp-ink)]"
          inputMode="numeric"
          min={18}
          max={100}
          onChange={(event) => updateEditor({ age: event.target.value })}
          placeholder="25"
          step={1}
          type="number"
          value={age}
        />
      </EditorLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        <EditorLabel label="Roommate min">
          <input
            aria-label="Minimum roommate age"
            className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[14px] text-[var(--pp-ink)]"
            inputMode="numeric"
            min={18}
            max={100}
            onChange={(event) => updateEditor({ min: event.target.value })}
            placeholder="No minimum"
            step={1}
            type="number"
            value={min}
          />
        </EditorLabel>
        <EditorLabel label="Roommate max">
          <input
            aria-label="Maximum roommate age"
            className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[14px] text-[var(--pp-ink)]"
            inputMode="numeric"
            min={18}
            max={100}
            onChange={(event) => updateEditor({ max: event.target.value })}
            placeholder="No maximum"
            step={1}
            type="number"
            value={max}
          />
        </EditorLabel>
      </div>
      <label className="flex items-start gap-2 rounded-xl border border-[var(--pp-hairline)] px-3.5 py-3 text-[12.5px] leading-5 text-[var(--pp-ink-60)]">
        {/* Controlled: the old defaultChecked + key-remount silently reset a
            check the user just made whenever the range inputs were cleared
            and retyped before Save. */}
        <input
          checked={hasAgeRangeInput && strict}
          className="mt-1"
          disabled={!hasAgeRangeInput}
          onChange={(event) => updateEditor({ strict: event.target.checked })}
          type="checkbox"
        />
        <span>Only suggest roommates inside this comfort range.</span>
      </label>
      <p className="m-0 text-[12px] leading-5 text-[var(--pp-ink-40)]">
        Used only for roommate suggestions, not apartment availability.
      </p>
      <InlineError message={inlineError} />
      <div className="flex justify-end">
        <PrimaryButton onClick={commit} disabled={busy} loading={busy}>
          Save
        </PrimaryButton>
      </div>
    </div>
  );
}

// One-tap structured preference picker. Saving writes a canonical-token fact
// (server-side) and optimistically updates the matching view via onSaved.
function PreferenceChoiceEditor({
  currentValue,
  factKey,
  onSaved,
  setError,
}: {
  currentValue: string;
  factKey: string;
  onSaved: (value: string) => void;
  setError: (message: string | null) => void;
}) {
  const options = structuredFactOptions(factKey) ?? [];
  const selected = matchPreferenceOption(factKey, currentValue, options);
  const [pending, setPending] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const closeRow = useLedgerRowClose();

  async function choose(option: string) {
    if (pending) {
      return;
    }
    setInlineError(null);
    setError(null);
    setPending(option);
    try {
      await savePreference(factKey, option);
      onSaved(option);
      closeRow();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Preference update failed.";
      setInlineError(message);
      setError(message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selected === option;
          return (
            <button
              aria-pressed={isSelected}
              className={`kin-focus rounded-full border px-3 py-1.5 text-[13px] font-medium transition disabled:opacity-60 ${
                isSelected
                  ? "border-[#264a36] bg-[#264a36] text-white"
                  : "border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] text-[var(--pp-ink-80)] hover:border-[var(--pp-ink-40)]"
              }`}
              disabled={pending !== null}
              key={option}
              onClick={() => choose(option)}
              type="button"
            >
              {pending === option ? "Saving…" : structuredFactValueLabel(factKey, option)}
            </button>
          );
        })}
      </div>
      <InlineError message={inlineError} />
    </div>
  );
}

// Resolve the canonical token a stored value represents (exact token, or the
// closest match for legacy free text), for highlighting the current choice.
function matchPreferenceOption(
  factKey: string,
  currentValue: string,
  options: string[],
): string | null {
  const cleaned = currentValue?.trim().toLowerCase() ?? "";
  if (!cleaned) {
    return null;
  }
  if (options.includes(cleaned)) {
    return cleaned;
  }
  return normalizeStructuredFactValue(factKey, cleaned);
}

// Display label for a stored preference: the canonical token's label when it
// maps cleanly, otherwise the cleaned free-text value.
function preferenceSummary(factKey: string, value: string): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!cleaned) {
    return undefined;
  }
  const options = structuredFactOptions(factKey) ?? [];
  const token = matchPreferenceOption(factKey, cleaned, options);
  return token ? structuredFactValueLabel(factKey, token) : cleaned;
}

// Tag editor for additive list preferences (neighborhoods, must-haves,
// dealbreakers). Saving writes the full current list as one fact (server-side),
// mirroring how the SMS agent edits these so both channels stay in sync.
function PreferenceListEditor({
  currentValues,
  factKey,
  onSaved,
  placeholder,
  setError,
}: {
  currentValues: string[];
  factKey: string;
  onSaved: (values: string[]) => void;
  placeholder: string;
  setError: (message: string | null) => void;
}) {
  const [tags, setTags] = useState<string[]>(() => normalizePreferenceList(currentValues ?? []));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  function addDraft() {
    const nextTags = addPreferenceDraft(tags, draft);
    if (nextTags.length === tags.length && draft.replace(/\s+/g, " ").trim().length === 0) {
      return;
    }
    setTags(nextTags);
    setDraft("");
  }

  function removeTag(target: string) {
    setTags((currentTags) => currentTags.filter((tag) => tag !== target));
  }

  async function commit() {
    setInlineError(null);
    setError(null);
    setBusy(true);
    try {
      const nextTags = addPreferenceDraft(tags, draft);
      await savePreferenceList(factKey, nextTags);
      setTags(nextTags);
      setDraft("");
      onSaved(nextTags);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Preference update failed.";
      setInlineError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2.5">
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-2.5 py-1 text-[13px] text-[var(--pp-ink-80)]"
              key={tag}
            >
              {tag}
              <button
                aria-label={`Remove ${tag}`}
                className="kin-focus rounded-full text-[var(--pp-ink-40)] transition hover:text-[var(--pp-ink)]"
                disabled={busy}
                onClick={() => removeTag(tag)}
                type="button"
              >
                <X size={13} strokeWidth={2} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="m-0 text-[13px] text-[var(--pp-ink-40)]">Nothing added yet.</p>
      )}
      <div className="flex gap-2">
        <input
          aria-label={placeholder}
          className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[14px] text-[var(--pp-ink)]"
          maxLength={PREFERENCE_TAG_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addDraft();
            }
          }}
          placeholder={placeholder}
          type="text"
          value={draft}
        />
        <button
          className="kin-focus shrink-0 rounded-xl border border-[var(--pp-hairline-strong)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--pp-ink-80)] transition hover:border-[var(--pp-ink-40)] disabled:opacity-60"
          disabled={busy || draft.trim().length === 0}
          onClick={addDraft}
          type="button"
        >
          Add
        </button>
      </div>
      <InlineError message={inlineError} />
      <div className="flex justify-end">
        <PrimaryButton onClick={commit} disabled={busy} loading={busy}>
          Save
        </PrimaryButton>
      </div>
    </div>
  );
}


function taskByKey(progress: ProfileSetupProgress, key: ProfileSetupTask["key"]) {
  const task = progress.tasks.find((candidate) => candidate.key === key);
  if (!task) {
    throw new Error(`Missing profile setup task: ${key}`);
  }
  return task;
}



async function savePreference(factKey: string, value: string) {
  const response = await fetch("/api/kinfolk/profile/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ factKey, value }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Preference update failed.",
    );
  }
}

async function savePreferenceList(factKey: string, values: string[]) {
  const response = await fetch("/api/kinfolk/profile/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ factKey, values }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Preference update failed.",
    );
  }
}
