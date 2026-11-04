"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import type { ProfileEnrichmentFormValues } from "@/lib/profiles/enrichment-form";
import type { OrgKind } from "@/lib/orgs/types";
import { OrgCombobox } from "../profile/org-combobox";
import type { OrgPick } from "../profile/org-combobox-state";
import {
  structuredFactOptions,
  structuredFactValueLabel,
} from "@/lib/profiles/fact-normalization";
import { formatCurrency } from "@/lib/shared/currency";
import {
  ENRICHMENT_BUDGET_GAP,
  ENRICHMENT_BUDGET_LOWER,
  ENRICHMENT_BUDGET_UPPER,
  ENRICHMENT_TAG_FIELD_CAPS,
  ENRICHMENT_TAG_VALUE_MAX_LENGTH,
  type EnrichmentTagDrafts,
  type EnrichmentTagFieldKey,
  addEnrichmentTagDraft,
  applyEnrichmentTagDrafts,
  emptyEnrichmentTagDrafts,
  normalizeEnrichmentBudgetRange,
  resolveEnrichmentBudgetMaxChange,
  resolveEnrichmentBudgetMinChange,
} from "./profile-enrichment-form-state";

type ChoiceOption = {
  label: string;
  value: string;
};

type SetProfileEnrichmentField = <
  Key extends keyof ProfileEnrichmentFormValues,
>(
  key: Key,
  value: ProfileEnrichmentFormValues[Key],
) => void;

type SubmitState = "idle" | "saving" | "redirecting";
type TagFieldKey = EnrichmentTagFieldKey;

const interestSuggestions = [
  "Cooking",
  "Hiking",
  "Live music",
  "Film",
  "Reading",
  "Gym",
  "Coffee",
  "Art",
  "Gaming",
  "Plants",
  "Running",
  "Travel",
];

const neighborhoodSuggestions = [
  "Mission",
  "Hayes Valley",
  "SoMa",
  "Nob Hill",
  "Outer Sunset",
  "Oakland",
];

const mustHaveSuggestions = [
  "In-unit laundry",
  "Natural light",
  "Parking",
  "Dishwasher",
  "Pet OK",
  "Gym",
  "Outdoor space",
];

const dealbreakerSuggestions = [
  "Smoking indoors",
  "No natural light",
  "Long commute",
  "Top-floor walk-up",
];

const genderOptions = [
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Nonbinary", value: "nonbinary" },
];

const sleepOptions = [
  { label: "Early bird", value: "early" },
  { label: "Flexible", value: "flexible" },
  { label: "Night owl", value: "late" },
];

const workFromHomeOptions = [
  { label: "Mostly out", value: "mostly away" },
  { label: "Hybrid", value: "hybrid" },
  { label: "Mostly home", value: "mostly home" },
  { label: "Flexible", value: "flexible" },
];

const tidinessOptions = [
  { label: "Relaxed", value: "very relaxed" },
  { label: "Easygoing", value: "relaxed" },
  { label: "Middle", value: "moderate" },
  { label: "Tidy", value: "tidy" },
  { label: "Very tidy", value: "very tidy" },
];

const noiseOptions = structuredChoiceOptions("noise_tolerance", [
  "very quiet",
  "quiet",
  "moderate",
  "lively",
  "very lively",
]);

const socialOptions = structuredChoiceOptions("social_energy", [
  "homebody",
  "low key",
  "balanced",
  "social",
  "very social",
]);

const guestsOptions = [
  { label: "Rarely", value: "rare" },
  { label: "Sometimes", value: "occasional" },
  { label: "Often", value: "frequent" },
];

const petOptions = [
  { label: "No pets", value: "no pets" },
  { label: "Pet friendly", value: "pet friendly" },
  { label: "I have a pet", value: "has pet" },
];

const smokingOptions = [
  { label: "No", value: "no" },
  { label: "Outdoor only", value: "outdoor only" },
  { label: "Yes", value: "yes" },
];

const communicationOptions = [
  { label: "Direct", value: "direct" },
  { label: "Diplomatic", value: "diplomatic" },
  { label: "Reserved", value: "reserved" },
];

const conflictOptions = [
  { label: "Address it now", value: "address now" },
  { label: "Cool off, then talk", value: "cooldown then talk" },
  { label: "Let it slide", value: "avoid" },
];

const householdOptions = [
  { label: "1", value: "me_plus_one" },
  { label: "2", value: "2" },
  { label: "3", value: "3" },
  { label: "4", value: "4" },
  { label: "5+", value: "5_plus" },
];

const roommateOpennessOptions = [
  { label: "Open", value: "yes" },
  { label: "Solo only", value: "no" },
];



const rentFlexibilityOptions = (structuredFactOptions("rent_tradeoff") ?? []).map(
  (value) => ({
    label: structuredFactValueLabel("rent_tradeoff", value),
    value,
  }),
);

function structuredChoiceOptions(
  factKey: string,
  fallbackValues: string[],
): ChoiceOption[] {
  return (structuredFactOptions(factKey) ?? fallbackValues).map((value) => ({
    label: structuredFactValueLabel(factKey, value),
    value,
  }));
}

export function ProfileEnrichmentForm({
  firstName,
  initialValues,
}: {
  firstName: string;
  initialValues: ProfileEnrichmentFormValues;
}) {
  const { push } = useRouter();
  const [values, setValues] = useState<ProfileEnrichmentFormValues>(() => ({
    ...initialValues,
    ...normalizeEnrichmentBudgetRange(initialValues.budgetMin, initialValues.budgetMax),
  }));
  const [tagDrafts, setTagDrafts] = useState<EnrichmentTagDrafts>(
    emptyEnrichmentTagDrafts,
  );
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isNavigating, startNavigation] = useTransition();

  const valuesForSubmit = useMemo(
    () => applyEnrichmentTagDrafts(values, tagDrafts),
    [tagDrafts, values],
  );
  const completion = useMemo(() => completionPercent(valuesForSubmit), [valuesForSubmit]);
  const saving = submitState === "saving";
  const redirecting = submitState === "redirecting";
  const isSubmitting = saving || redirecting || isNavigating;
  const statusText = saving
    ? "Saving your profile..."
    : redirecting || isNavigating
      ? "Loading your matches..."
      : "Saved when you finish";
  // Confirm-pass framing: when the agent + imports already drafted most of the
  // profile, this page is a review, not a blank form — the copy must say so.
  const isConfirmPass = completion >= 60;
  const buttonText = saving
    ? "Saving profile..."
    : redirecting || isNavigating
      ? "Loading matches..."
      : isConfirmPass
        ? "Looks right — save & see matches"
        : "Done - back to Kinfolk";

  function setField<Key extends keyof ProfileEnrichmentFormValues>(
    key: Key,
    value: ProfileEnrichmentFormValues[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setSubmitState("idle");
    setError(null);
  }

  function setBudgetRange(budgetMin: number, budgetMax: number) {
    const nextRange = normalizeEnrichmentBudgetRange(budgetMin, budgetMax);
    setValues((current) => ({
      ...current,
      budgetMin: nextRange.budgetMin,
      budgetMax: nextRange.budgetMax,
    }));
    setSubmitState("idle");
    setError(null);
  }

  function setRoommateOpenness(value: string) {
    setValues((current) => ({
      ...current,
      householdSize: value === "yes" ? current.householdSize || "me_plus_one" : "",
      openToRoommates: value === "yes",
    }));
    setSubmitState("idle");
    setError(null);
  }

  function setTagDraft(key: TagFieldKey, draft: string) {
    setTagDrafts((current) => ({ ...current, [key]: draft }));
    setSubmitState("idle");
    setError(null);
  }

  async function submit() {
    if (isSubmitting) {
      return;
    }

    setSubmitState("saving");
    setError(null);

    try {
      const response = await fetch("/api/kinfolk/profile/enrichment-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: valuesForSubmit }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Profile save failed.");
      }
      setSubmitState("redirecting");
      startNavigation(() => {
        push("/me/matches?enriched=1");
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Profile save failed.");
      setSubmitState("idle");
    }
  }

  async function submitFormAction() {
    await submit();
  }

  return (
    <main className="profile-pane kin-dotted-bg min-h-screen px-3.5 pb-16 pt-7 text-[var(--pp-ink)] sm:px-6">
      <div className="mx-auto w-full max-w-[600px]">
        <div className="mb-4 ml-0.5 flex items-center gap-2.5">
          <Image
            alt=""
            aria-hidden="true"
            className="size-7 rounded-[7px]"
            height={28}
            src="/assets/kinfolk-logo-mark.png"
            width={28}
          />
          <span className="pp-serif text-[18px] leading-none">Kinfolk</span>
        </div>

	        <form
	          className="overflow-hidden rounded-[22px] border border-[var(--pp-hairline)] bg-[var(--pp-canvas)] shadow-[0_1px_2px_rgba(28,51,38,0.04),0_24px_44px_-28px_rgba(14,31,23,0.22)]"
	          data-testid="profile-enrichment-form"
	          action={submitFormAction}
	        >
          <header className="border-b border-[var(--pp-hairline)] px-6 py-7 sm:px-10 sm:py-9">
            <p className="pp-mono m-0 mb-3 text-[10.5px] font-medium uppercase tracking-[0.16em] text-[var(--pp-ink-40)]">
              Profile / Enrichment
            </p>
            <h1 className="pp-serif m-0 text-[34px] font-medium leading-[1.05] text-[var(--pp-ink)] sm:text-[40px]">
              {isConfirmPass
                ? `Look this over, ${firstName}.`
                : `A few more things, ${firstName}.`}
            </h1>
            <p className="m-0 mt-3 max-w-[46ch] text-[14.5px] leading-6 text-[var(--pp-ink-60)]">
              {isConfirmPass
                ? "Your agent already drafted most of this from your texts and imports. Skim each section, fix anything that reads wrong, and confirm."
                : "This is everything we use to find your people and a place that actually fits. Fill in what feels true."}
            </p>
            <div className="mt-5 flex items-center gap-3">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-[rgba(28,51,38,0.08)]">
                <span
                  className="block h-full rounded-full bg-[#264a36] transition-[width] duration-300"
                  style={{ width: `${Math.max(completion, 4)}%` }}
                />
              </span>
              <span className="mono min-w-[72px] text-right text-[11px] text-[var(--pp-ink-40)]">
                {completion}% complete
              </span>
            </div>
          </header>

          <fieldset className="contents" disabled={isSubmitting}>
            <div
              className={`px-6 py-2 transition-opacity sm:px-10 ${isSubmitting ? "pointer-events-none opacity-70" : ""}`}
            >
              <ProfileEnrichmentFields
                values={values}
                tagDrafts={tagDrafts}
                onBudgetChange={setBudgetRange}
                onTagDraftChange={setTagDraft}
                onFieldChange={setField}
                onRoommateOpennessChange={setRoommateOpenness}
              />
            </div>
          </fieldset>

          <footer className="mt-6 flex flex-col gap-4 border-t border-[var(--pp-hairline)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <output
              aria-live="polite"
              className="inline-flex items-center gap-2 text-[12.5px] text-[var(--pp-ink-60)]"
            >
              <span
                className={`size-1.5 rounded-full ${redirecting ? "bg-[var(--pp-mint)]" : "bg-[var(--pp-ink-30)]"}`}
              />
              {statusText}
            </output>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {error ? (
                <span className="text-[12.5px] leading-5 text-[#8a4b20]" role="alert">
                  {error}
                </span>
              ) : null}
              <button
                className="kin-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#264a36] px-5 text-[14px] font-medium text-white transition hover:bg-[#1c3526] disabled:cursor-not-allowed disabled:opacity-70"
                data-testid="enrichment-save-button"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? (
                  <Loader2 aria-hidden className="animate-spin" size={16} strokeWidth={1.9} />
                ) : null}
                {buttonText}
              </button>
            </div>
          </footer>
        </form>

        <p className="mx-1 mt-4 text-center text-[11.5px] leading-5 text-[var(--pp-ink-40)]">
          Your answers stay private and only shape your matches. You can edit this later
          in Settings.
        </p>
      </div>
    </main>
  );
}

function ProfileEnrichmentFields({
  tagDrafts,
  values,
  onBudgetChange,
  onFieldChange,
  onRoommateOpennessChange,
  onTagDraftChange,
}: {
  tagDrafts: EnrichmentTagDrafts;
  values: ProfileEnrichmentFormValues;
  onBudgetChange: (budgetMin: number, budgetMax: number) => void;
  onFieldChange: SetProfileEnrichmentField;
  onRoommateOpennessChange: (value: string) => void;
  onTagDraftChange: (key: TagFieldKey, draft: string) => void;
}) {
  return (
    <>
      <FormSection title="The basics">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Name"
            name="fullName"
            value={values.fullName}
            onChange={(value) => onFieldChange("fullName", value)}
          />
          <TextField
            hint="Only your age is shown to others."
            label="Birthday"
            name="birthday"
            type="date"
            value={values.birthday}
            onChange={(value) => onFieldChange("birthday", value)}
          />
        </div>
        <ChoiceGroup
          label="Gender"
          options={genderOptions}
          value={values.gender}
          onChange={(value) => onFieldChange("gender", value)}
        />
        <TextField
          label="Hometown"
          name="hometown"
          placeholder="Where you're from"
          value={values.hometown}
          onChange={(value) => onFieldChange("hometown", value)}
        />
      </FormSection>

      <FormSection title="Work & school">
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="Role / title"
            name="occupationTitle"
            placeholder="Product designer"
            value={values.occupationTitle}
            onChange={(value) => onFieldChange("occupationTitle", value)}
          />
          <OrgField
            kind="company"
            label="Company"
            name="occupationCompany"
            placeholder="Where you work"
            value={values.occupationCompany}
            domain={values.occupationCompanyDomain}
            onChange={(pick) => {
              onFieldChange("occupationCompany", pick.label);
              onFieldChange("occupationCompanyDomain", pick.domain ?? "");
            }}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <OrgField
            kind="school"
            label="School"
            name="educationSchool"
            placeholder="University"
            value={values.educationSchool}
            domain={values.educationSchoolDomain}
            onChange={(pick) => {
              onFieldChange("educationSchool", pick.label);
              onFieldChange("educationSchoolDomain", pick.domain ?? "");
            }}
          />
          <TextField
            label="Studied / major"
            name="educationMajor"
            placeholder="What you studied"
            value={values.educationMajor}
            onChange={(value) => onFieldChange("educationMajor", value)}
          />
        </div>
      </FormSection>

      <FormSection title="You, in your own words">
        <TextareaField
          label="About you"
          maxLength={280}
          name="aboutText"
          placeholder="Your pace, your taste, the broad strokes of how you live."
          value={values.aboutText}
          onChange={(value) => onFieldChange("aboutText", value)}
        />
        <TagField
          label="Interests"
          name="interests"
          placeholder="Add an interest"
          suggestions={interestSuggestions}
          values={values.interests}
          draft={tagDrafts.interests}
          onChange={(nextValues) => onFieldChange("interests", nextValues)}
          onDraftChange={(draft) => onTagDraftChange("interests", draft)}
        />
        <TextField
          label="Music & media taste"
          name="musicTaste"
          placeholder="Artists, shows, films you're into"
          value={values.musicTaste}
          onChange={(value) => onFieldChange("musicTaste", value)}
        />
      </FormSection>

      <FormSection title="Your daily rhythm">
        <ChoiceGroup
          label="Sleep schedule"
          options={sleepOptions}
          value={values.sleepSchedule}
          onChange={(value) => onFieldChange("sleepSchedule", value)}
        />
        <ChoiceGroup
          label="Work from home"
          options={workFromHomeOptions}
          value={values.workFromHome}
          onChange={(value) => onFieldChange("workFromHome", value)}
        />
        <ChoiceGroup
          label="Tidiness"
          options={tidinessOptions}
          scale
          value={values.cleanliness}
          onChange={(value) => onFieldChange("cleanliness", value)}
        />
      </FormSection>

      <FormSection title="Living with others">
        <ChoiceGroup
          label="Noise at home"
          options={noiseOptions}
          value={values.noiseTolerance}
          onChange={(value) => onFieldChange("noiseTolerance", value)}
        />
        <ChoiceGroup
          label="Social energy"
          options={socialOptions}
          value={values.socialEnergy}
          onChange={(value) => onFieldChange("socialEnergy", value)}
        />
        <ChoiceGroup
          label="Guests over"
          options={guestsOptions}
          value={values.guests}
          onChange={(value) => onFieldChange("guests", value)}
        />
        <ChoiceGroup
          label="Pets"
          options={petOptions}
          value={values.pets}
          onChange={(value) => onFieldChange("pets", value)}
        />
        <ChoiceGroup
          label="Smoking"
          options={smokingOptions}
          value={values.smoking}
          onChange={(value) => onFieldChange("smoking", value)}
        />
      </FormSection>

      <FormSection title="How you communicate">
        <ChoiceGroup
          label="Style"
          options={communicationOptions}
          value={values.communicationStyle}
          onChange={(value) => onFieldChange("communicationStyle", value)}
        />
        <ChoiceGroup
          label="When friction comes up"
          options={conflictOptions}
          value={values.conflictRepair}
          onChange={(value) => onFieldChange("conflictRepair", value)}
        />
      </FormSection>

      <FormSection title="The place you're after">
        <BudgetRange
          max={values.budgetMax}
          min={values.budgetMin}
          onChange={onBudgetChange}
        />
        <ChoiceGroup
          label="Rent flexibility"
          options={rentFlexibilityOptions}
          optional
          value={values.rentFlexibility}
          onChange={(value) => onFieldChange("rentFlexibility", value)}
        />
        <ChoiceGroup
          label="Roommates"
          options={roommateOpennessOptions}
          value={values.openToRoommates ? "yes" : "no"}
          onChange={onRoommateOpennessChange}
        />
        <div
          className={
            values.openToRoommates ? "grid gap-5 sm:grid-cols-2" : "grid gap-5"
          }
        >
          <TextField
            label="Move-in by"
            name="moveInBy"
            type="date"
            value={values.moveInBy}
            onChange={(value) => onFieldChange("moveInBy", value)}
          />
          {values.openToRoommates ? (
            <ChoiceGroup
              label="Maximum roommates"
              options={householdOptions}
              value={values.householdSize}
              onChange={(value) => onFieldChange("householdSize", value)}
            />
          ) : null}
        </div>
        <TagField
          label="Neighborhoods"
          name="neighborhoods"
          placeholder="Add a neighborhood"
          suggestions={neighborhoodSuggestions}
          values={values.neighborhoods}
          draft={tagDrafts.neighborhoods}
          onChange={(nextValues) => onFieldChange("neighborhoods", nextValues)}
          onDraftChange={(draft) => onTagDraftChange("neighborhoods", draft)}
        />
        <TagField
          label="Must-haves"
          name="mustHaves"
          placeholder="Add a must-have"
          suggestions={mustHaveSuggestions}
          values={values.mustHaves}
          draft={tagDrafts.mustHaves}
          onChange={(nextValues) => onFieldChange("mustHaves", nextValues)}
          onDraftChange={(draft) => onTagDraftChange("mustHaves", draft)}
        />
        <TagField
          label="Dealbreakers"
          name="dealbreakers"
          placeholder="Add a dealbreaker"
          suggestions={dealbreakerSuggestions}
          values={values.dealbreakers}
          draft={tagDrafts.dealbreakers}
          onChange={(nextValues) => onFieldChange("dealbreakers", nextValues)}
          onDraftChange={(draft) => onTagDraftChange("dealbreakers", draft)}
        />
      </FormSection>
    </>
  );
}

function FormSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="py-6">
      <div className="mb-5 flex items-center gap-3.5">
        <span className="h-px flex-1 bg-[var(--pp-hairline)]" />
        <h2 className="pp-mono m-0 whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.18em] text-[var(--pp-ink-40)]">
          {title}
        </h2>
        <span className="h-px flex-1 bg-[var(--pp-hairline)]" />
      </div>
      <div className="grid gap-5">{children}</div>
    </section>
  );
}

/**
 * Company/school picker in the enrichment form's own field styling.
 *
 * This is the path that matters when LinkedIn enrichment comes back without
 * work or education: the person types it themselves and still gets a real
 * organization — domain, logo, and a matchable key — rather than a bare string.
 */
function OrgField({
  domain,
  kind,
  label,
  name,
  onChange,
  placeholder,
  value,
}: {
  domain: string;
  kind: OrgKind;
  label: string;
  name: keyof ProfileEnrichmentFormValues;
  onChange: (pick: OrgPick) => void;
  placeholder?: string;
  value: string;
}) {
  // htmlFor rather than wrapping: a <label> may not contain the popup
  // listbox, and nesting it made every click inside the menu also fire label
  // activation.
  const inputId = `enrichment-${name}-input`;

  return (
    <div className="block" data-testid={`enrichment-${name}`}>
      <label
        className="pp-mono mb-1.5 block text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]"
        htmlFor={inputId}
      >
        {label}
      </label>
      <OrgCombobox
        ariaLabel={label}
        inputId={inputId}
        kind={kind}
        maxLength={120}
        onChange={onChange}
        placeholder={placeholder ?? label}
        savedDomain={domain || null}
        value={{ label: value, domain: domain || null }}
      />
    </div>
  );
}

function TextField({
  hint,
  label,
  name,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  hint?: string;
  label: string;
  name: keyof ProfileEnrichmentFormValues;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "date" | "text";
  value: string;
}) {
  return (
    <label className="block">
      <span className="pp-mono mb-1.5 block text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
        {label}
      </span>
      <input
        aria-label={label}
        className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[15px] text-[var(--pp-ink)] transition hover:border-[var(--pp-ink-40)]"
        data-testid={`enrichment-${name}`}
        name={name}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onInput={
          type === "date"
            ? (event) => onChange(event.currentTarget.value)
            : undefined
        }
      />
      {hint ? <p className="m-0 mt-1.5 text-[12px] text-[var(--pp-ink-40)]">{hint}</p> : null}
    </label>
  );
}

function TextareaField({
  label,
  maxLength,
  name,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  maxLength: number;
  name: keyof ProfileEnrichmentFormValues;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="pp-mono mb-1.5 block text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
        {label}
      </span>
      <textarea
        aria-label={label}
        className="kin-focus min-h-24 w-full resize-y rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[15px] leading-6 text-[var(--pp-ink)] transition hover:border-[var(--pp-ink-40)]"
        data-testid={`enrichment-${name}`}
        maxLength={maxLength}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="mt-1.5 flex justify-end">
        <span className="mono text-[11px] text-[var(--pp-ink-40)]">
          {value.length} / {maxLength}
        </span>
      </div>
    </label>
  );
}

function ChoiceGroup({
  label,
  onChange,
  optional = false,
  options,
  scale = false,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  optional?: boolean;
  options: ChoiceOption[];
  scale?: boolean;
  value: string;
}) {
  return (
    <div>
      <span className="pp-mono mb-2 block text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
        {label}
        {optional ? (
          <span className="ml-1 normal-case tracking-normal text-[var(--pp-ink-30)]">
            Optional
          </span>
        ) : null}
      </span>
      <div className={scale ? "grid grid-cols-5 gap-1.5" : "flex flex-wrap gap-2"}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              aria-pressed={selected}
              className={`kin-focus min-h-9 rounded-full border px-3.5 text-[13px] font-medium transition ${
                scale ? "px-1 text-[12px]" : ""
              } ${
                selected
                  ? "border-[#264a36] bg-[#264a36] text-white"
                  : "border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] text-[var(--pp-ink-80)] hover:border-[var(--pp-ink-40)]"
              }`}
              key={option.value}
              type="button"
              onClick={() => onChange(optional && selected ? "" : option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TagField({
  draft,
  label,
  name,
  onChange,
  onDraftChange,
  placeholder,
  suggestions,
  values,
}: {
  draft: string;
  label: string;
  name: TagFieldKey;
  onChange: (values: string[]) => void;
  onDraftChange: (draft: string) => void;
  placeholder: string;
  suggestions: string[];
  values: string[];
}) {
  const maxTags = ENRICHMENT_TAG_FIELD_CAPS[name];
  const atLimit = values.length >= maxTags;
  const valueKeys = new Set(values.map((value) => value.toLowerCase()));
  const visibleSuggestions = atLimit
    ? []
    : suggestions.filter((suggestion) => !valueKeys.has(suggestion.toLowerCase()));

  function add(raw: string) {
    const nextValues = addEnrichmentTagDraft(values, raw, maxTags);
    if (
      nextValues.length === values.length &&
      nextValues.every((value, index) => value === values[index])
    ) {
      return;
    }
    onChange(nextValues);
    onDraftChange("");
  }

  function remove(target: string) {
    onChange(values.filter((value) => value.toLowerCase() !== target.toLowerCase()));
  }

  return (
    <div>
      <span className="pp-mono mb-2 block text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
        {label}
      </span>
      <div className="mb-2.5 flex flex-wrap gap-2" data-testid={`enrichment-${name}-tags`}>
        {values.map((value) => (
          <span
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#264a36] bg-[#264a36] py-1 pl-3 pr-1.5 text-[13px] text-white"
            key={value}
          >
            {value}
            <button
              aria-label={`Remove ${value}`}
              className="kin-focus inline-grid size-5 place-items-center rounded-full text-white/75 transition hover:text-white"
              type="button"
              onClick={() => remove(value)}
            >
              <X aria-hidden size={13} strokeWidth={2} />
            </button>
          </span>
        ))}
        {visibleSuggestions.map((suggestion) => (
          <button
            className="kin-focus inline-flex min-h-8 items-center gap-1.5 rounded-full border border-dashed border-[var(--pp-hairline-strong)] bg-transparent px-3 text-[13px] text-[var(--pp-ink-60)] transition hover:border-[var(--pp-ink-40)] hover:text-[var(--pp-ink)]"
            key={suggestion}
            type="button"
            onClick={() => add(suggestion)}
          >
            <Plus aria-hidden size={12} strokeWidth={2} />
            {suggestion}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          aria-label={label}
          className="kin-focus min-w-0 flex-1 rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[14px] text-[var(--pp-ink)] transition hover:border-[var(--pp-ink-40)]"
          data-testid={`enrichment-${name}`}
          maxLength={ENRICHMENT_TAG_VALUE_MAX_LENGTH}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(draft);
            }
          }}
        />
        <button
          className="kin-focus inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-4 text-[13px] font-medium text-[var(--pp-ink-80)] transition hover:border-[var(--pp-ink-40)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={atLimit || draft.trim().length === 0}
          type="button"
          onClick={() => add(draft)}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function BudgetRange({
  max,
  min,
  onChange,
}: {
  max: number;
  min: number;
  onChange: (min: number, max: number) => void;
}) {
  const range = normalizeEnrichmentBudgetRange(min, max);
  const left =
    ((range.budgetMin - ENRICHMENT_BUDGET_LOWER) /
      (ENRICHMENT_BUDGET_UPPER - ENRICHMENT_BUDGET_LOWER)) *
    100;
  const right =
    ((range.budgetMax - ENRICHMENT_BUDGET_LOWER) /
      (ENRICHMENT_BUDGET_UPPER - ENRICHMENT_BUDGET_LOWER)) *
    100;

  function setMin(nextMin: number) {
    const nextRange = resolveEnrichmentBudgetMinChange(nextMin, range.budgetMax);
    onChange(nextRange.budgetMin, nextRange.budgetMax);
  }

  function setMax(nextMax: number) {
    const nextRange = resolveEnrichmentBudgetMaxChange(range.budgetMin, nextMax);
    onChange(nextRange.budgetMin, nextRange.budgetMax);
  }

  return (
    <div>
      <span className="pp-mono mb-2 block text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
        Monthly budget
      </span>
      <div className="mono mb-3 flex items-baseline gap-1.5 text-[14px] text-[var(--pp-ink)]">
        <b className="font-medium">{money(range.budgetMin)}</b>
        <span className="text-[var(--pp-ink-30)]">-</span>
        <b className="font-medium">{money(range.budgetMax)}</b>
      </div>
      <div className="relative h-8" data-testid="enrichment-budget">
        <div className="absolute left-0 right-0 top-[14px] h-1 rounded-full bg-[rgba(28,51,38,0.1)]" />
        <div
          className="absolute top-[14px] h-1 rounded-full bg-[#264a36]"
          style={{ left: `${left}%`, width: `${right - left}%` }}
        />
        <input
          aria-label="Minimum budget"
          className="pointer-events-none absolute inset-x-0 top-0 h-8 w-full appearance-none bg-transparent accent-[#264a36] [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto"
          max={ENRICHMENT_BUDGET_UPPER - ENRICHMENT_BUDGET_GAP}
          min={ENRICHMENT_BUDGET_LOWER}
          step={50}
          type="range"
          value={range.budgetMin}
          onChange={(event) => setMin(Number(event.target.value))}
        />
        <input
          aria-label="Maximum budget"
          className="pointer-events-none absolute inset-x-0 top-0 h-8 w-full appearance-none bg-transparent accent-[#264a36] [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto"
          max={ENRICHMENT_BUDGET_UPPER}
          min={ENRICHMENT_BUDGET_LOWER + ENRICHMENT_BUDGET_GAP}
          step={50}
          type="range"
          value={range.budgetMax}
          onChange={(event) => setMax(Number(event.target.value))}
        />
      </div>
    </div>
  );
}

function money(value: number) {
  return formatCurrency(value);
}

function completionPercent(values: ProfileEnrichmentFormValues) {
  const checks: boolean[] = [
    Boolean(values.fullName),
    Boolean(values.birthday),
    // gender is captured into the form payload but not promoted to a profile
    // field or matching fact, so it does not count toward completion.
    Boolean(values.hometown),
    Boolean(values.occupationTitle || values.occupationCompany),
    Boolean(values.educationSchool || values.educationMajor),
    Boolean(values.aboutText),
    values.interests.length > 0,
    Boolean(values.musicTaste),
    Boolean(values.sleepSchedule),
    Boolean(values.workFromHome),
    Boolean(values.cleanliness),
    Boolean(values.noiseTolerance),
    Boolean(values.socialEnergy),
    Boolean(values.guests),
    Boolean(values.pets),
    Boolean(values.smoking),
    Boolean(values.communicationStyle),
    Boolean(values.conflictRepair),
    values.budgetMin > 0 && values.budgetMax > 0,
    Boolean(values.moveInBy),
    ...(values.openToRoommates ? [Boolean(values.householdSize)] : []),
    values.neighborhoods.length > 0,
    values.mustHaves.length > 0,
    values.dealbreakers.length > 0,
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}
