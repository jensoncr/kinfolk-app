"use client";

import { X } from "lucide-react";
import { useEffect, useEffectEvent, useReducer, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  GroupGate,
  GroupGenderPreference,
  GroupMoveInWindow,
  GroupPetPreference,
  GroupPreferences,
} from "@/lib/apartments/types";
import {
  genderPreferenceOptions,
  moveInPreferenceOptions,
  normalizeGroupPreferences,
  petPreferenceOptions,
  validatePreferredAgeRange,
} from "./group-preferences";
import { groupPreferencesSubmitErrorMessage } from "./group-preferences-modal-state";

type Props = {
  planName: string;
  onClose: () => void;
  onSubmit: (preferences: GroupPreferences | null) => Promise<void> | void;
};

const inputClass =
  "kin-focus w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 py-2 text-sm text-[var(--ink-900)]";

type GroupPreferencesFormState = {
  ageError: string | null;
  ageMax: string;
  ageMin: string;
  gender: GroupGenderPreference | "";
  industry: string;
  industryGate: GroupGate;
  isSubmitting: boolean;
  moveIn: GroupMoveInWindow | "";
  moveInGate: GroupGate;
  pets: GroupPetPreference | "";
  petsGate: GroupGate;
  submitError: string | null;
};

const initialGroupPreferencesFormState: GroupPreferencesFormState = {
  ageError: null,
  ageMax: "",
  ageMin: "",
  gender: "",
  industry: "",
  industryGate: "preferred",
  isSubmitting: false,
  moveIn: "",
  moveInGate: "preferred",
  pets: "",
  petsGate: "preferred",
  submitError: null,
};

function groupPreferencesFormReducer(
  state: GroupPreferencesFormState,
  patch: Partial<GroupPreferencesFormState>,
) {
  return { ...state, ...patch };
}

function GateToggle({
  value,
  onChange,
  disabled,
}: {
  value: GroupGate;
  onChange: (gate: GroupGate) => void;
  disabled: boolean;
}) {
  return (
    <div
      className={[
        "inline-flex shrink-0 rounded-full border border-[var(--border-strong)] p-0.5",
        disabled ? "opacity-40" : "",
      ].join(" ")}
    >
      {(["preferred", "required"] as GroupGate[]).map((gate) => (
        <button
          key={gate}
          type="button"
          disabled={disabled}
          onClick={() => onChange(gate)}
          className={[
            "kin-focus rounded-full px-3 py-1 text-[12.5px] font-semibold capitalize transition",
            value === gate
              ? "bg-[var(--forest-700)] text-white"
              : "text-[var(--ink-600)] hover:text-[var(--ink-800)]",
          ].join(" ")}
        >
          {gate}
        </button>
      ))}
    </div>
  );
}

function FilterRow({
  label,
  active,
  gate,
  onGateChange,
  children,
}: {
  label: string;
  active: boolean;
  gate: GroupGate;
  onGateChange: (gate: GroupGate) => void;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-[var(--ink-900)]">
          {label}
        </span>
        <GateToggle value={gate} onChange={onGateChange} disabled={!active} />
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function GroupPreferencesModal({
  planName,
  onClose,
  onSubmit,
}: Props) {
  const [form, updateForm] = useReducer(
    groupPreferencesFormReducer,
    initialGroupPreferencesFormState,
  );
  const {
    ageError,
    ageMax,
    ageMin,
    gender,
    industry,
    industryGate,
    isSubmitting,
    moveIn,
    moveInGate,
    pets,
    petsGate,
    submitError,
  } = form;
  const closeModal = useEffectEvent(onClose);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!isSubmitting) closeModal();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSubmitting]);

  if (typeof document === "undefined") return null;

  async function handleCreate() {
    if (isSubmitting) return;
    const trimmedIndustry = industry.trim();
    const minNum = ageMin ? Number(ageMin) : null;
    const maxNum = ageMax ? Number(ageMax) : null;
    const parsedAgeMin = minNum != null && Number.isFinite(minNum) ? minNum : null;
    const parsedAgeMax = maxNum != null && Number.isFinite(maxNum) ? maxNum : null;
    const nextAgeError = validatePreferredAgeRange(parsedAgeMin, parsedAgeMax);

    if (nextAgeError) {
      updateForm({ ageError: nextAgeError, submitError: null });
      return;
    }

    updateForm({ isSubmitting: true, submitError: null });
    try {
      await onSubmit(
        normalizeGroupPreferences({
          gender: gender || null,
          ageMin: parsedAgeMin,
          ageMax: parsedAgeMax,
          pets: pets ? { value: pets, gate: petsGate } : null,
          industry: trimmedIndustry
            ? { value: trimmedIndustry, gate: industryGate }
            : null,
          moveIn: moveIn ? { value: moveIn, gate: moveInGate } : null,
        }),
      );
    } catch (error) {
      updateForm({
        isSubmitting: false,
        submitError: groupPreferencesSubmitErrorMessage(error),
      });
    }
  }

  // "Skip for now" still CREATES the group — just without preferences. The
  // group only exists once the user submits or skips; plain close cancels.
  async function handleSkip() {
    if (isSubmitting) return;
    updateForm({ isSubmitting: true, submitError: null });
    try {
      await onSubmit(null);
    } catch (error) {
      updateForm({
        isSubmitting: false,
        submitError: groupPreferencesSubmitErrorMessage(error),
      });
    }
  }

  return createPortal(
    <dialog
      open
      aria-modal="true"
      aria-label={`Set preferences for your group on ${planName}`}
      className="fixed inset-0 z-[80] m-0 flex h-screen w-screen max-h-none max-w-none items-center justify-center border-0 bg-transparent p-0 px-3 py-3 sm:px-6 sm:py-6"
    >
      <button
        type="button"
        aria-label="Cancel"
        onClick={() => {
          if (!isSubmitting) onClose();
        }}
        className="absolute inset-0 -z-10 bg-[rgba(14,31,23,0.45)] backdrop-blur-[4px]"
      />
      <div className="relative flex max-h-[88vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-white text-[var(--ink-900)] shadow-[0_40px_120px_-30px_rgba(8,18,12,0.6)]">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <p className="serif text-lg font-semibold text-[var(--ink-900)]">
              Set your group preferences
            </p>
            <p className="mt-1 text-[13px] text-[var(--ink-600)]">
              Group on {planName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="kin-focus grid size-7 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-white text-[var(--ink-600)] transition hover:bg-[var(--bg-soft)]"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {/* Soft demographic signals — display only, never an eligibility gate. */}
          <section className="space-y-3">
            <div>
              <p className="text-[15px] font-semibold text-[var(--ink-900)]">
                Looking for
              </p>
              <p className="mt-1 text-[13px] text-[var(--ink-600)]">
                Shown to people considering your group. These never block
                anyone from joining.
              </p>
            </div>
            <div>
              <span className="text-sm font-semibold text-[var(--ink-900)]">
                Gender
              </span>
	                <select
	                  value={gender}
	                  onChange={(e) =>
	                    updateForm({
	                      gender: e.target.value as GroupGenderPreference | "",
	                    })
	                  }
                className={`${inputClass} mt-1.5`}
              >
                <option value="">No preference</option>
                {genderPreferenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="text-sm font-semibold text-[var(--ink-900)]">
                Preferred age range
              </span>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={18}
                  max={120}
	                  value={ageMin}
	                  onChange={(e) => {
	                    updateForm({ ageMin: e.target.value, ageError: null });
	                  }}
	                  placeholder="Min"
	                  aria-label="Minimum preferred age"
	                  aria-invalid={ageError ? "true" : undefined}
                  aria-describedby={ageError ? "group-age-error" : undefined}
                  className={inputClass}
                />
                <span className="text-sm text-[var(--ink-400)]">to</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={18}
                  max={120}
	                  value={ageMax}
	                  onChange={(e) => {
	                    updateForm({ ageMax: e.target.value, ageError: null });
	                  }}
	                  placeholder="Max"
	                  aria-label="Maximum preferred age"
	                  aria-invalid={ageError ? "true" : undefined}
                  aria-describedby={ageError ? "group-age-error" : undefined}
                  className={inputClass}
                />
              </div>
              {ageError ? (
                <p
                  id="group-age-error"
                  role="alert"
                  className="mt-1.5 text-xs font-semibold text-[var(--rust)]"
                >
                  {ageError}
                </p>
              ) : null}
            </div>
          </section>

          {/* Gated filters — each can require a match or just nudge ranking. */}
          <section className="space-y-4 border-t border-[var(--border)] pt-5">
            <div>
              <p className="text-[15px] font-semibold text-[var(--ink-900)]">
                Filters
              </p>
              <p className="mt-1 text-[13px] text-[var(--ink-600)]">
                <span className="font-semibold text-[var(--ink-800)]">
                  Required
                </span>{" "}
                filters must match to join.{" "}
                <span className="font-semibold text-[var(--ink-800)]">
                  Preferred
                </span>{" "}
                ones just surface better matches first.
              </p>
            </div>

            <FilterRow
              label="Pets"
	              active={pets !== ""}
	              gate={petsGate}
	              onGateChange={(petsGate) => updateForm({ petsGate })}
            >
              <select
	                value={pets}
	                onChange={(e) =>
	                  updateForm({
	                    pets: e.target.value as GroupPetPreference | "",
	                  })
	                }
                className={inputClass}
              >
                <option value="">No preference</option>
                {petPreferenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterRow>

            <FilterRow
              label="Industry or field"
	              active={industry.trim() !== ""}
	              gate={industryGate}
	              onGateChange={(industryGate) => updateForm({ industryGate })}
            >
              <input
	                type="text"
	                value={industry}
	                onChange={(e) => updateForm({ industry: e.target.value })}
	                placeholder="e.g. Tech, healthcare, design"
	                aria-label="Industry or field"
	                className={inputClass}
              />
            </FilterRow>

            <FilterRow
              label="Move-in timing"
	              active={moveIn !== ""}
	              gate={moveInGate}
	              onGateChange={(moveInGate) => updateForm({ moveInGate })}
            >
              <select
	                value={moveIn}
	                onChange={(e) =>
	                  updateForm({
	                    moveIn: e.target.value as GroupMoveInWindow | "",
	                  })
	                }
                className={inputClass}
              >
                <option value="">No preference</option>
                {moveInPreferenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterRow>
          </section>
        </div>

        <GroupPreferencesFooter
          isSubmitting={isSubmitting}
          submitError={submitError}
          onSkip={handleSkip}
          onCreate={handleCreate}
        />
      </div>
    </dialog>,
    document.body,
  );
}

function GroupPreferencesFooter({
  isSubmitting,
  submitError,
  onSkip,
  onCreate,
}: {
  isSubmitting: boolean;
  submitError: string | null;
  onSkip: () => void;
  onCreate: () => void;
}) {
  return (
    <footer className="flex flex-col gap-3 border-t border-[var(--border)] bg-[#fbfaf5] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      {submitError ? (
        <p
          role="alert"
          className="text-xs font-semibold text-[var(--rust)] sm:max-w-[280px]"
        >
          {submitError}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3 sm:ml-auto">
        <button
          type="button"
          onClick={onSkip}
          disabled={isSubmitting}
          className="kin-focus text-[13px] font-semibold text-[var(--ink-600)] transition hover:text-[var(--ink-800)]"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={isSubmitting}
          className="kin-focus inline-flex items-center gap-2 rounded-full bg-[var(--forest-700)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--forest-800)]"
        >
          {isSubmitting ? "Creating..." : "Create group"}
        </button>
      </div>
    </footer>
  );
}
