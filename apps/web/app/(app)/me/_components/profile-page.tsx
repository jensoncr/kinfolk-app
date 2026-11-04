"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useReducer, useState } from "react";
import { ArrowUpRight, Plus, X } from "lucide-react";
import {
  getProfileSetupProgress,
  type ProfileSetupState,
} from "@/lib/profiles/completion";
import type { ContinueOnPhoneConfig } from "@/lib/integrations/continue-on-phone";
import { LocationAutocomplete } from "@/components/ui/location-autocomplete";
import type { LinkedInTimelineItem, ProfilePhoto } from "@/lib/shared/types";
import { textMentionsValue } from "@/lib/shared/text-mentions";
import type {
  MatchingPreferencesView,
  ProfileOrgRef,
  ProfileViewModel,
} from "@/lib/profiles/view";
import {
  ABOUT_TEXT_MAX_LENGTH,
  resolveAboutTextSave,
} from "./profile/about-text-state";
import {
  closeEditableTextEditor,
  openEditableTextEditor,
} from "./profile/editable-text-state";
import {
  closeEducationEditor,
  EDUCATION_FIELD_MAX_LENGTHS,
  openEducationEditor,
  resolveEducationSave,
} from "./profile/education-state";
import {
  canSaveHometownDraft,
  closeHometownEditor,
  HOMETOWN_MAX_LENGTH,
  openHometownEditor,
  resolveHometownSave,
} from "./profile/hometown-state";
import {
  addPreferenceDraft,
  closePreferenceListEditor,
  MAX_PREFERENCE_TAGS,
  normalizePreferenceList,
  openPreferenceListEditor,
  PREFERENCE_TAG_MAX_LENGTH,
} from "./profile/preference-list-state";
import { OrgCombobox } from "./profile/org-combobox";
import { domainSurvivesEdit, type OrgPick } from "./profile/org-combobox-state";
import { PhotoGallery } from "./profile/photo-gallery";
import {
  closeWorkEditor,
  openWorkEditor,
  resolveWorkSave,
  WORK_FIELD_MAX_LENGTH,
} from "./profile/work-state";
import {
  EditorLabel,
  EditTrigger,
  EmptyHint,
  InlineError,
  patchReducer,
  PrimaryButton,
  QuietButton,
  Section,
  SuggestedTag,
  saveField,
} from "./profile/shared";
import { MatchingBasicsSection } from "./profile/matching-basics-section";

type ProfilePaneProps = {
  continueOnPhoneConfig: ContinueOnPhoneConfig;
  view: ProfileViewModel;
};

const SCHOOL_PLACEHOLDER = "University of Notre Dame";

/** Stand-in when a profile view predates the org columns. */
const EMPTY_ORG_REF: ProfileOrgRef = { domain: null, logoUrl: null };

type EducationDraft = {
  school: string;
  degree: string;
  major: string;
  year: string;
};

type EducationUserEdits = {
  school: boolean;
  degree: boolean;
  major: boolean;
  year: boolean;
};

type ProfilePaneState = {
  about: string;
  aboutIsUserEdited: boolean;
  role: string;
  roleIsUserEdited: boolean;
  company: string;
  companyIsUserEdited: boolean;
  companyOrg: ProfileOrgRef;
  educationDraft: EducationDraft;
  educationSchoolOrg: ProfileOrgRef;
  educationUserEdits: EducationUserEdits;
  hometown: string;
  interests: string[];
  interestsIsUserEdited: boolean;
  photos: ProfilePhoto[];
  setup: ProfileSetupState;
  matching: MatchingPreferencesView;
  topLevelError: string | null;
};

type ProfilePaneAction =
  | { type: "aboutSaved"; value: string; isUserEdited: boolean }
  | {
      type: "educationSaved";
      draft: EducationDraft;
      userEdits: EducationUserEdits;
      schoolOrg: ProfileOrgRef;
    }
  | { type: "hometownSaved"; value: string }
  | { type: "interestsSaved"; value: string[]; isUserEdited: boolean }
  | { type: "matchingChanged"; value: MatchingPreferencesView }
  | { type: "photosChanged"; value: ProfilePhoto[] }
  | { type: "setupChanged"; value: ProfileSetupState }
  | { type: "topLevelErrorChanged"; value: string | null }
  | {
      type: "workSaved";
      title: string;
      titleIsUserEdited: boolean;
      company: string;
      companyIsUserEdited: boolean;
      companyOrg: ProfileOrgRef;
    };

function createProfilePaneState(view: ProfileViewModel): ProfilePaneState {
  return {
    about: view.about.value,
    aboutIsUserEdited: view.about.isUserEdited,
    role: view.occupationTitle.value,
    roleIsUserEdited: view.occupationTitle.isUserEdited,
    company: view.occupationCompany.value,
    companyIsUserEdited: view.occupationCompany.isUserEdited,
    companyOrg: view.occupationCompanyOrg ?? EMPTY_ORG_REF,
    educationSchoolOrg: view.educationSchoolOrg ?? EMPTY_ORG_REF,
    educationDraft: {
      school: view.education.school.value,
      degree: view.education.degree.value,
      major: view.education.major.value,
      year: view.education.year.value,
    },
    educationUserEdits: {
      school: view.education.school.isUserEdited,
      degree: view.education.degree.isUserEdited,
      major: view.education.major.isUserEdited,
      year: view.education.year.isUserEdited,
    },
    hometown: view.hometown.value,
    interests: view.interests.value,
    interestsIsUserEdited: view.interests.isUserEdited,
    matching: view.matchingPreferences,
    photos: view.photos,
    setup: view.setup,
    topLevelError: null,
  };
}

function profilePaneReducer(
  state: ProfilePaneState,
  action: ProfilePaneAction,
): ProfilePaneState {
  switch (action.type) {
    case "aboutSaved":
      return {
        ...state,
        about: action.value,
        aboutIsUserEdited: action.isUserEdited,
      };
    case "educationSaved":
      return {
        ...state,
        educationDraft: action.draft,
        educationSchoolOrg: action.schoolOrg,
        educationUserEdits: action.userEdits,
      };
    case "hometownSaved":
      return { ...state, hometown: action.value };
    case "interestsSaved":
      return {
        ...state,
        interests: action.value,
        interestsIsUserEdited: action.isUserEdited,
      };
    case "matchingChanged":
      return { ...state, matching: action.value };
    case "photosChanged":
      return { ...state, photos: action.value };
    case "setupChanged":
      return { ...state, setup: action.value };
    case "topLevelErrorChanged":
      return { ...state, topLevelError: action.value };
    case "workSaved":
      return {
        ...state,
        company: action.company,
        companyIsUserEdited: action.companyIsUserEdited,
        companyOrg: action.companyOrg,
        role: action.title,
        roleIsUserEdited: action.titleIsUserEdited,
      };
  }
}


export function ProfilePane({ continueOnPhoneConfig, view }: ProfilePaneProps) {
  const [profileState, dispatchProfileState] = useReducer(
    profilePaneReducer,
    view,
    createProfilePaneState,
  );
  const {
    about,
    aboutIsUserEdited,
    role,
    roleIsUserEdited,
    company,
    companyIsUserEdited,
    companyOrg,
    educationSchoolOrg,
    educationDraft,
    educationUserEdits,
    hometown,
    interests,
    interestsIsUserEdited,
    matching,
    photos,
    setup,
    topLevelError,
  } = profileState;
  const setTopLevelError = (value: string | null) =>
    dispatchProfileState({ type: "topLevelErrorChanged", value });
  const setPhotos = (value: ProfilePhoto[]) =>
    dispatchProfileState({ type: "photosChanged", value });
  const setSetup = (value: ProfileSetupState) =>
    dispatchProfileState({ type: "setupChanged", value });
  const setMatching = (value: MatchingPreferencesView) =>
    dispatchProfileState({ type: "matchingChanged", value });

  const ageAndMarket = useMemo(() => {
    const parts = [];
    if (view.age !== null) parts.push(`${view.age}`);
    if (view.launchMarket) parts.push(view.launchMarket);
    return parts.join(" · ");
  }, [view.age, view.launchMarket]);
  const setupProgress = useMemo(() => getProfileSetupProgress(setup), [setup]);

  return (
    <section className="w-full">
      <div className="mx-auto w-full max-w-[680px]">
        {topLevelError ? (
          <p className="mb-5 rounded-xl border border-[rgba(155,77,32,0.2)] bg-[rgba(155,77,32,0.06)] px-4 py-3 text-[13px] leading-5 text-[#8a4b20]">
            {topLevelError}
          </p>
        ) : null}

        <PreviewNotice />

        <PhotoGallery
          photos={photos}
          onPhotosChange={setPhotos}
          onError={setTopLevelError}
        />

        <header className="mt-7">
          <h1 className="pp-serif m-0 text-[36px] leading-[1.05] tracking-[-0.02em] text-[var(--pp-ink)] sm:text-[40px]">
            {view.displayName}
          </h1>
          {ageAndMarket ? (
            <p className="m-0 mt-1.5 text-[14px] text-[var(--pp-ink-60)]">{ageAndMarket}</p>
          ) : null}
        </header>

        <EditableTextSection
          label="About"
          placeholder="Tell roommates what you're about — pace, taste, the broad strokes."
          emptyHint="Add a few lines about yourself."
          maxLength={ABOUT_TEXT_MAX_LENGTH}
          multiline
          value={about}
          isUserEdited={aboutIsUserEdited}
          suggestion={view.about.suggestion}
          onSave={async (next) => {
            const saved = resolveAboutTextSave(next, view.about.suggestion);
            await saveField({ aboutText: saved.patchValue });
            dispatchProfileState({
              isUserEdited: saved.isUserEdited,
              type: "aboutSaved",
              value: saved.displayValue,
            });
          }}
          onResetToSuggestion={async () => {
            await saveField({ aboutText: null });
            dispatchProfileState({
              isUserEdited: false,
              type: "aboutSaved",
              value: view.about.suggestion,
            });
          }}
          setError={setTopLevelError}
        />

        <WorkSection
          role={role}
          company={company}
          companyOrg={companyOrg}
          roleIsUserEdited={roleIsUserEdited}
          companyIsUserEdited={companyIsUserEdited}
          suggestionTitle={view.occupationTitle.suggestion}
          suggestionCompany={view.occupationCompany.suggestion}
          importedItems={view.importedWorkExperience}
          setError={setTopLevelError}
          onSave={async (nextTitle, nextCompany, nextCompanyDomain) => {
            const saved = resolveWorkSave(
              nextTitle,
              nextCompany,
              view.occupationTitle.suggestion,
              view.occupationCompany.suggestion,
            );
            const result = await saveField({
              occupationTitle: saved.titlePatchValue,
              occupationCompany: saved.companyPatchValue,
              occupationCompanyDomain: nextCompanyDomain,
            });
            dispatchProfileState({
              company: saved.companyDisplayValue,
              companyIsUserEdited: saved.companyIsUserEdited,
              companyOrg: result.org?.occupationCompany ?? { domain: null, logoUrl: null },
              title: saved.titleDisplayValue,
              titleIsUserEdited: saved.titleIsUserEdited,
              type: "workSaved",
            });
          }}
        />

        <EducationSection
          draft={educationDraft}
          schoolOrg={educationSchoolOrg}
          userEdits={educationUserEdits}
          suggestion={{
            school: view.education.school.suggestion,
            degree: view.education.degree.suggestion,
            major: view.education.major.suggestion,
            year: view.education.year.suggestion,
          }}
          importedItems={view.importedEducation}
          setError={setTopLevelError}
          onSave={async (next, schoolDomain) => {
            const saved = resolveEducationSave(next, {
              school: view.education.school.suggestion,
              degree: view.education.degree.suggestion,
              major: view.education.major.suggestion,
              year: view.education.year.suggestion,
            });
            const result = await saveField({
              ...saved.patch,
              educationSchoolDomain: schoolDomain,
            });
            dispatchProfileState({
              draft: saved.displayDraft,
              schoolOrg: result.org?.educationSchool ?? { domain: null, logoUrl: null },
              type: "educationSaved",
              userEdits: saved.userEdits,
            });
          }}
        />

        <HometownSection
          hometown={hometown}
          setError={setTopLevelError}
          onSave={async (next) => {
            const saved = resolveHometownSave(next, view.hometown.suggestion);
            await saveField({ hometown: saved.patchValue });
            dispatchProfileState({ type: "hometownSaved", value: saved.displayValue });
          }}
        />

        <InterestsSection
          interests={interests}
          isUserEdited={interestsIsUserEdited}
          suggestion={view.interests.suggestion}
          onSave={async (next) => {
            await saveField({ interests: next });
            if (next.length > 0) {
              dispatchProfileState({
                isUserEdited: true,
                type: "interestsSaved",
                value: next,
              });
            } else {
              dispatchProfileState({
                isUserEdited: false,
                type: "interestsSaved",
                value: view.interests.suggestion,
              });
            }
          }}
          setError={setTopLevelError}
        />

        <MatchingBasicsSection
          continueOnPhoneConfig={continueOnPhoneConfig}
          matching={matching}
          onMatchingChange={setMatching}
          onSetupChange={setSetup}
          progress={setupProgress}
          setup={setup}
          setError={setTopLevelError}
        />

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--pp-hairline)] pt-5 text-[13px] text-[var(--pp-ink-60)]">
          <p className="m-0">Suggestions come from your assistant memories.</p>
          <Link
            className="kin-focus inline-flex items-center gap-1.5 rounded-full border border-[var(--pp-hairline-strong)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--pp-ink-80)] transition hover:bg-[rgba(28,51,38,0.04)] hover:text-[var(--pp-ink)]"
            href="/me/settings/memories"
          >
            View all memories
            <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden />
          </Link>
        </footer>
      </div>
    </section>
  );
}
function PreviewNotice() {
  return (
    <p className="m-0 flex items-center gap-1.5 text-[12px] uppercase tracking-[0.16em] text-[var(--pp-ink-40)]">
      <span aria-hidden className="size-[5px] rounded-full bg-[var(--pp-ink-40)]" />
      Preview · what roommates see
    </p>
  );
}

function EditableTextSection({
  label,
  placeholder,
  emptyHint,
  maxLength,
  multiline,
  value,
  isUserEdited,
  suggestion,
  onSave,
  onResetToSuggestion,
  setError,
}: {
  label: string;
  placeholder: string;
  emptyHint: string;
  maxLength: number;
  multiline?: boolean;
  value: string;
  isUserEdited: boolean;
  suggestion: string;
  onSave: (next: string) => Promise<void>;
  onResetToSuggestion: () => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  function clearFeedback() {
    setInlineError(null);
    setError(null);
  }

  function openEditor() {
    const next = openEditableTextEditor(value);
    setDraft(next.draft);
    setInlineError(next.inlineError);
    setError(next.topLevelError);
    setEditing(next.editing);
  }

  function closeEditor() {
    const next = closeEditableTextEditor();
    setDraft(next.draft);
    setInlineError(next.inlineError);
    setError(next.topLevelError);
    setEditing(next.editing);
  }

  async function commit() {
    clearFeedback();
    setBusy(true);
    try {
      const next = draft.trim();
      await onSave(next);
      closeEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} update failed.`;
      setInlineError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    clearFeedback();
    setBusy(true);
    try {
      await onResetToSuggestion();
      closeEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} reset failed.`;
      setInlineError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      label={label}
      action={
        editing ? null : (
          <EditTrigger
            onClick={openEditor}
            label={value.length === 0 ? "Add" : "Edit"}
          />
        )
      }
    >
      {editing ? (
        <div>
          {multiline ? (
            <textarea
              aria-label={label}
              className="kin-focus min-h-[120px] w-full resize-y rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-3 text-[15px] leading-[1.5] text-[var(--pp-ink)]"
              value={draft}
              maxLength={maxLength}
              placeholder={placeholder}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <input
              aria-label={label}
              className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[15px] text-[var(--pp-ink)]"
              value={draft}
              maxLength={maxLength}
              placeholder={placeholder}
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
          <InlineError message={inlineError} />
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-[var(--pp-ink-40)]">
              {draft.length}/{maxLength}
            </span>
            <div className="flex items-center gap-2">
              {isUserEdited && suggestion.length > 0 ? (
                <QuietButton onClick={reset} disabled={busy}>
                  Use suggestion
                </QuietButton>
              ) : null}
              <QuietButton onClick={closeEditor} disabled={busy}>
                Cancel
              </QuietButton>
              <PrimaryButton onClick={commit} disabled={busy} loading={busy}>
                Save
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : value ? (
        <p className="m-0 text-[15px] leading-[1.55] text-[var(--pp-ink)] whitespace-pre-wrap">
          {value}
          {!isUserEdited ? <SuggestedTag /> : null}
        </p>
      ) : (
        <EmptyHint>{emptyHint}</EmptyHint>
      )}
    </Section>
  );
}

function OccupationEditor({
  defaultTitle,
  defaultCompany,
  defaultCompanyDomain,
  defaultCompanyLogoUrl,
  suggestionTitle,
  suggestionCompany,
  onCancel,
  onSave,
  setError,
}: {
  defaultTitle: string;
  defaultCompany: string;
  defaultCompanyDomain: string | null;
  defaultCompanyLogoUrl: string | null;
  suggestionTitle: string;
  suggestionCompany: string;
  onCancel: () => void;
  onSave: (title: string, company: string, companyDomain: string | null) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [companyPick, setCompanyPick] = useState<OrgPick>({
    label: defaultCompany,
    domain: defaultCompanyDomain,
  });
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  async function commit() {
    setInlineError(null);
    setError(null);
    setBusy(true);
    try {
      await onSave(title.trim(), companyPick.label.trim(), companyPick.domain);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Work update failed.";
      setInlineError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2.5">
      <EditorLabel label="Role">
        <input
          aria-label="Role"
          className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[15px] text-[var(--pp-ink)]"
          value={title}
          maxLength={WORK_FIELD_MAX_LENGTH}
          placeholder={suggestionTitle || "Role"}
          onChange={(e) => setTitle(e.target.value)}
        />
      </EditorLabel>
      <EditorLabel label="Company">
        <OrgCombobox
          ariaLabel="Company"
          kind="company"
          logoUrl={defaultCompanyLogoUrl}
          maxLength={WORK_FIELD_MAX_LENGTH}
          savedDomain={defaultCompanyDomain}
          onChange={setCompanyPick}
          placeholder={suggestionCompany || "Company"}
          value={companyPick}
        />
      </EditorLabel>
      <InlineError message={inlineError} />
      <div className="flex items-center justify-end gap-2">
        <QuietButton onClick={onCancel} disabled={busy}>
          Cancel
        </QuietButton>
        <PrimaryButton onClick={commit} disabled={busy} loading={busy}>
          Save
        </PrimaryButton>
      </div>
    </div>
  );
}

function InterestsSection({
  interests,
  isUserEdited,
  suggestion,
  onSave,
  setError,
}: {
  interests: string[];
  isUserEdited: boolean;
  suggestion: string[];
  onSave: (next: string[]) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [{ adding, busy, draft, editing, inlineError }, updateEditor] = useReducer(
    patchReducer<{
      adding: string;
      busy: boolean;
      draft: string[];
      editing: boolean;
      inlineError: string | null;
    }>,
    interests,
    (initialInterests) => ({
      adding: "",
      busy: false,
      draft: normalizePreferenceList(initialInterests),
      editing: false,
      inlineError: null,
    }),
  );

  function openEditor() {
    const next = openPreferenceListEditor();
    setError(next.topLevelError);
    updateEditor({
      adding: "",
      draft: normalizePreferenceList(interests),
      editing: next.editing,
      inlineError: next.inlineError,
    });
  }

  function closeEditor() {
    const next = closePreferenceListEditor();
    setError(next.topLevelError);
    updateEditor({
      adding: "",
      editing: next.editing,
      inlineError: next.inlineError,
    });
  }

  function pushTag() {
    const cleaned = adding.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    if (cleaned.length > PREFERENCE_TAG_MAX_LENGTH) {
      updateEditor({
        inlineError: `Interests are limited to ${PREFERENCE_TAG_MAX_LENGTH} characters.`,
      });
      return;
    }
    if (draft.some((entry) => entry.toLowerCase() === cleaned.toLowerCase())) {
      updateEditor({ adding: "" });
      return;
    }
    if (draft.length >= MAX_PREFERENCE_TAGS) {
      updateEditor({ inlineError: `You can save up to ${MAX_PREFERENCE_TAGS} interests.` });
      return;
    }
    updateEditor((current) => ({
      adding: "",
      draft: addPreferenceDraft(current.draft, cleaned),
      inlineError: null,
    }));
  }

  function removeTag(index: number) {
    updateEditor({ draft: draft.filter((_, i) => i !== index) });
  }

  async function commit() {
    updateEditor({ inlineError: null });
    setError(null);
    updateEditor({ busy: true });
    try {
      const nextDraft = normalizePreferenceList(draft);
      await onSave(nextDraft);
      const next = closePreferenceListEditor();
      setError(next.topLevelError);
      updateEditor({
        draft: nextDraft,
        editing: next.editing,
        inlineError: next.inlineError,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Interests update failed.";
      updateEditor({ inlineError: message });
      setError(message);
    } finally {
      updateEditor({ busy: false });
    }
  }

  async function reset() {
    updateEditor({ inlineError: null });
    setError(null);
    updateEditor({ busy: true });
    try {
      await onSave([]);
      const next = closePreferenceListEditor();
      setError(next.topLevelError);
      updateEditor({ draft: [], editing: next.editing, inlineError: next.inlineError });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Interests reset failed.";
      updateEditor({ inlineError: message });
      setError(message);
    } finally {
      updateEditor({ busy: false });
    }
  }

  return (
    <Section
      label="Interests"
      action={
        editing ? null : (
          <EditTrigger onClick={openEditor} label={interests.length === 0 ? "Add" : "Edit"} />
        )
      }
    >
      {editing ? (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {draft.map((tag, index) => (
              <span
                key={tag.toLowerCase()}
                className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(28,51,38,0.08)] px-3 py-1 text-[13px] text-[var(--pp-ink)]"
              >
                {tag}
                <button
                  aria-label={`Remove ${tag}`}
                  className="kin-focus -mr-1 inline-grid size-4 place-items-center rounded-full text-[var(--pp-ink-60)] hover:text-[var(--pp-ink)]"
                  onClick={() => removeTag(index)}
                  type="button"
                >
                  <X size={10} strokeWidth={2} aria-hidden />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <input
              aria-label="Add an interest"
              className="kin-focus min-w-[180px] flex-1 rounded-full border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-1.5 text-[13.5px] text-[var(--pp-ink)]"
              value={adding}
              maxLength={PREFERENCE_TAG_MAX_LENGTH}
              placeholder="Add an interest"
              onChange={(e) => updateEditor({ adding: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  pushTag();
                }
                if (e.key === "," && adding.trim().length > 0) {
                  e.preventDefault();
                  pushTag();
                }
              }}
            />
            <button
              aria-label="Add interest"
              className="kin-focus inline-grid size-8 place-items-center rounded-full border border-[var(--pp-hairline-strong)] text-[var(--pp-ink-60)] transition hover:bg-[rgba(28,51,38,0.04)] hover:text-[var(--pp-ink)]"
              onClick={pushTag}
              type="button"
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden />
            </button>
          </div>
          {suggestion.length > 0 && isUserEdited ? (
            <SuggestionRow
              suggestion={suggestion}
              currentDraft={draft}
              onAdd={(tag) => {
                if (draft.length >= MAX_PREFERENCE_TAGS) {
                  return;
                }
                updateEditor((current) => ({
                  draft: addPreferenceDraft(current.draft, tag),
                  inlineError: null,
                }));
              }}
            />
          ) : null}
          <div className="mt-2.5">
            <InlineError message={inlineError} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-[var(--pp-ink-40)]">
              {draft.length}/{MAX_PREFERENCE_TAGS}
            </span>
            <div className="flex items-center gap-2">
              {isUserEdited ? (
                <QuietButton onClick={reset} disabled={busy}>
                  Reset
                </QuietButton>
              ) : null}
              <QuietButton onClick={closeEditor} disabled={busy}>
                Cancel
              </QuietButton>
              <PrimaryButton onClick={commit} disabled={busy} loading={busy}>
                Save
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : interests.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {interests.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-[rgba(28,51,38,0.06)] px-3 py-1 text-[13px] text-[var(--pp-ink-80)]"
            >
              {tag}
            </span>
          ))}
          {!isUserEdited ? <SuggestedTag /> : null}
        </div>
      ) : (
        <EmptyHint>Add a few interests so roommates can find common ground.</EmptyHint>
      )}
    </Section>
  );
}

function SuggestionRow({
  suggestion,
  currentDraft,
  onAdd,
}: {
  suggestion: string[];
  currentDraft: string[];
  onAdd: (tag: string) => void;
}) {
  const remaining = suggestion.filter(
    (tag) => !currentDraft.some((entry) => entry.toLowerCase() === tag.toLowerCase()),
  );
  if (remaining.length === 0) return null;

  return (
    <div className="mt-3 border-t border-dashed border-[var(--pp-hairline)] pt-2.5">
      <p className="pp-mono m-0 mb-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
        From your memories
      </p>
      <div className="flex flex-wrap gap-1.5">
        {remaining.map((tag) => (
          <button
            key={tag}
            className="kin-focus inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--pp-hairline-strong)] px-2.5 py-0.5 text-[12.5px] text-[var(--pp-ink-60)] transition hover:border-[var(--pp-ink-40)] hover:text-[var(--pp-ink)]"
            onClick={() => onAdd(tag)}
            type="button"
          >
            <Plus size={11} strokeWidth={1.8} aria-hidden />
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
}


function WorkSection({
  role,
  company,
  companyOrg,
  roleIsUserEdited,
  companyIsUserEdited,
  suggestionTitle,
  suggestionCompany,
  importedItems,
  onSave,
  setError,
}: {
  role: string;
  company: string;
  companyOrg: ProfileOrgRef;
  roleIsUserEdited: boolean;
  companyIsUserEdited: boolean;
  suggestionTitle: string;
  suggestionCompany: string;
  importedItems: LinkedInTimelineItem[];
  onSave: (title: string, company: string, companyDomain: string | null) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const hasValue = Boolean(role || company);
  const importedDetails = importedItems.filter(hasSpecificTimelineDetail);
  // The picked organization's own logo wins over anything a LinkedIn import
  // guessed: it is keyed to the domain this person actually chose.
  const primaryLogoUrl =
    companyOrg?.logoUrl ?? findTimelineLogoUrl(importedItems, company || role);
  const showCompany = Boolean(company && (!role || !textMentionsValue(role, company)));
  function openEditor() {
    const next = openWorkEditor();
    setError(next.topLevelError);
    setEditing(next.editing);
  }
  function closeEditor() {
    const next = closeWorkEditor();
    setError(next.topLevelError);
    setEditing(next.editing);
  }

  return (
    <Section
      label="Work"
      action={
        editing ? null : (
          <EditTrigger
            onClick={openEditor}
            label={hasValue ? "Edit" : "Add"}
          />
        )
      }
    >
      {editing ? (
        <OccupationEditor
          defaultTitle={role}
          defaultCompany={company}
          defaultCompanyDomain={companyOrg?.domain ?? null}
          defaultCompanyLogoUrl={companyOrg?.logoUrl ?? null}
          suggestionTitle={suggestionTitle}
          suggestionCompany={suggestionCompany}
          onCancel={closeEditor}
          onSave={async (nextTitle, nextCompany, nextDomain) => {
            await onSave(nextTitle, nextCompany, nextDomain);
            closeEditor();
          }}
          setError={setError}
        />
      ) : hasValue || importedDetails.length > 0 ? (
        <div>
          {hasValue ? (
            <div className="flex items-center gap-2.5">
              {primaryLogoUrl ? <TimelineLogo name={company || role} logoUrl={primaryLogoUrl} /> : null}
              <p className="m-0 min-w-0 text-[15px] leading-[1.5] text-[var(--pp-ink)]">
                {role ? <span className="font-medium">{role}</span> : null}
                {role && showCompany ? (
                  <span className="text-[var(--pp-ink-60)]">{` · ${company}`}</span>
                ) : showCompany ? (
                  <span>{company}</span>
                ) : null}
                {!roleIsUserEdited && !companyIsUserEdited ? <SuggestedTag /> : null}
              </p>
            </div>
          ) : null}
          <ImportedTimelineList items={importedDetails} label="From LinkedIn" />
        </div>
      ) : (
        <EmptyHint>Add your role and where you work.</EmptyHint>
      )}
    </Section>
  );
}

function EducationSection({
  draft,
  schoolOrg,
  userEdits,
  suggestion,
  importedItems,
  onSave,
  setError,
}: {
  draft: EducationDraft;
  schoolOrg: ProfileOrgRef;
  userEdits: { school: boolean; degree: boolean; major: boolean; year: boolean };
  suggestion: EducationDraft;
  importedItems: LinkedInTimelineItem[];
  onSave: (next: EducationDraft, schoolDomain: string | null) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const hasAny = Boolean(draft.school || draft.degree || draft.major || draft.year);
  const allFromSuggestion =
    !userEdits.school && !userEdits.degree && !userEdits.major && !userEdits.year;
  const linkedInSuggestionItem = firstVisibleTimelineItem(importedItems);
  const linkedInSuggestion = linkedInSuggestionItem
    ? educationDraftFromTimelineItem(linkedInSuggestionItem)
    : null;
  const showLinkedInSuggestion = Boolean(
    hasAny &&
      linkedInSuggestionItem &&
      linkedInSuggestion &&
      !educationDraftsEquivalent(draft, linkedInSuggestion),
  );
  // Exclude the suggestion ITEM, not items[0]: firstVisibleTimelineItem skips
  // placeholder rows, so positional slicing could keep the suggested entry in
  // the "Also from LinkedIn" list and render it twice.
  const importedDetails =
    hasAny && linkedInSuggestionItem
      ? importedItems.filter((item) => item !== linkedInSuggestionItem)
      : importedItems;
  const primaryLogoUrl = schoolOrg?.logoUrl ?? findTimelineLogoUrl(importedItems, draft.school);

  function openEditor() {
    const next = openEducationEditor();
    setError(next.topLevelError);
    setEditing(next.editing);
  }

  function closeEditor() {
    const next = closeEducationEditor();
    setError(next.topLevelError);
    setEditing(next.editing);
  }

  return (
    <Section
      label="Education"
      action={
        editing ? null : (
          <EditTrigger onClick={openEditor} label={hasAny ? "Edit" : "Add"} />
        )
      }
    >
      {editing ? (
        <EducationEditor
          defaults={draft}
          defaultSchoolDomain={schoolOrg?.domain ?? null}
          defaultSchoolLogoUrl={schoolOrg?.logoUrl ?? null}
          suggestion={suggestion}
          onCancel={closeEditor}
          onSave={async (next, schoolDomain) => {
            await onSave(next, schoolDomain);
            closeEditor();
          }}
          setError={setError}
        />
      ) : hasAny || importedDetails.length > 0 ? (
        <div>
          {hasAny ? (
            <EducationDisplay
              draft={draft}
              allFromSuggestion={allFromSuggestion}
              logoUrl={primaryLogoUrl}
            />
          ) : null}
          {showLinkedInSuggestion && linkedInSuggestionItem && linkedInSuggestion ? (
            <LinkedInEducationSuggestion
              item={linkedInSuggestionItem}
              setError={setError}
              suggestion={linkedInSuggestion}
              onUse={async () => {
                const merged = mergeEducationDraft(draft, linkedInSuggestion);
                // Adopting the LinkedIn school replaces the label, so a domain
                // picked for the previous school no longer describes it.
                await onSave(
                  merged,
                  domainSurvivesEdit(draft.school, merged.school)
                    ? (schoolOrg?.domain ?? null)
                    : null,
                );
              }}
            />
          ) : null}
          <ImportedTimelineList items={importedDetails} label="Also from LinkedIn" />
        </div>
      ) : (
        <EmptyHint>Add school, degree, major, and grad year.</EmptyHint>
      )}
    </Section>
  );
}

function HometownSection({
  hometown,
  onSave,
  setError,
}: {
  hometown: string;
  onSave: (next: string) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const hasValue = hometown.length > 0;

  function openEditor() {
    const next = openHometownEditor();
    setError(next.topLevelError);
    setEditing(next.editing);
  }

  function closeEditor() {
    const next = closeHometownEditor();
    setError(next.topLevelError);
    setEditing(next.editing);
  }

  return (
    <Section
      label="Where I'm from"
      action={
        editing ? null : (
          <EditTrigger onClick={openEditor} label={hasValue ? "Edit" : "Add"} />
        )
      }
    >
      {editing ? (
        <HometownEditor
          defaultValue={hometown}
          onCancel={closeEditor}
          onSave={async (next) => {
            await onSave(next);
            closeEditor();
          }}
          setError={setError}
        />
      ) : hasValue ? (
        <p className="m-0 text-[15px] leading-[1.5] text-[var(--pp-ink)]">{hometown}</p>
      ) : (
        <EmptyHint>Add the city and state you grew up in.</EmptyHint>
      )}
    </Section>
  );
}

function HometownEditor({
  defaultValue,
  onCancel,
  onSave,
  setError,
}: {
  defaultValue: string;
  onCancel: () => void;
  onSave: (next: string) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [selectedValue, setSelectedValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const canSave = canSaveHometownDraft(value, selectedValue);

  async function commit() {
    setInlineError(null);
    setError(null);
    if (!canSave) {
      const message = "Choose a city from the suggestions.";
      setInlineError(message);
      setError(message);
      return;
    }
    setBusy(true);
    try {
      await onSave(selectedValue.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hometown update failed.";
      setInlineError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2.5">
      <EditorLabel label="City, State">
        <LocationAutocomplete
          value={value}
          onChange={(next) => {
            setValue(next);
            if (next.trim().length === 0) {
              setSelectedValue("");
            } else if (!canSaveHometownDraft(next, selectedValue)) {
              setSelectedValue("");
            }
          }}
          onSelect={(suggestion) => {
            setSelectedValue(suggestion.label);
          }}
          ariaLabel="City, State"
          maxLength={HOMETOWN_MAX_LENGTH}
          placeholder="e.g. Chicago, IL"
        />
      </EditorLabel>
      <InlineError message={inlineError} />
      <div className="flex items-center justify-end gap-2">
        <QuietButton onClick={onCancel} disabled={busy}>
          Cancel
        </QuietButton>
        <PrimaryButton onClick={commit} disabled={busy || !canSave} loading={busy}>
          Save
        </PrimaryButton>
      </div>
    </div>
  );
}

function ImportedTimelineList({
  items,
  label,
}: {
  items: LinkedInTimelineItem[];
  label: string;
}) {
  const visibleItems = items
    .filter((item) => hasTimelineContent(item) && !isGenericTimelinePlaceholder(item))
    .slice(0, 4);

  if (visibleItems.length === 0) return null;

  return (
    <div className="mt-3 border-t border-dashed border-[var(--pp-hairline)] pt-2.5">
      <p className="pp-mono m-0 mb-2 text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
        {label}
      </p>
      <div className="grid gap-2.5">
        {visibleItems.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5">
            <TimelineLogo name={item.organization || item.title} logoUrl={item.logoUrl} />
            <div className="min-w-0 flex-1 text-[13.5px] leading-[1.45] text-[var(--pp-ink)]">
              <p className="m-0 truncate">
                {item.title ? <span className="font-medium">{item.title}</span> : null}
                {item.title && item.organization ? (
                  <span className="text-[var(--pp-ink-60)]">{` · ${item.organization}`}</span>
                ) : item.organization ? (
                  <span className="font-medium">{item.organization}</span>
                ) : null}
              </p>
              {item.subtitle || item.dateRange ? (
                <p className="m-0 mt-0.5 truncate text-[12.5px] text-[var(--pp-ink-60)]">
                  {[item.subtitle, item.dateRange].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LinkedInEducationSuggestion({
  item,
  setError,
  suggestion,
  onUse,
}: {
  item: LinkedInTimelineItem;
  setError: (message: string | null) => void;
  suggestion: EducationDraft;
  onUse: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const detail = item.dateRange || suggestion.year;

  async function useSuggestion() {
    setError(null);
    setBusy(true);
    try {
      await onUse();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Education suggestion failed.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-dashed border-[var(--pp-hairline-strong)] bg-[rgba(28,51,38,0.025)] px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <TimelineLogo name={suggestion.school || item.organization || item.title} logoUrl={item.logoUrl} />
        <div className="min-w-0 flex-1">
          <p className="pp-mono m-0 mb-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--pp-ink-40)]">
            Suggested from LinkedIn
          </p>
          <p className="m-0 truncate text-[13.5px] font-medium leading-[1.45] text-[var(--pp-ink)]">
            {suggestion.school || item.organization || item.title}
          </p>
          {detail ? (
            <p className="m-0 mt-0.5 truncate text-[12.5px] text-[var(--pp-ink-60)]">{detail}</p>
          ) : null}
        </div>
        <button
          className="kin-focus shrink-0 rounded-full border border-[var(--pp-hairline-strong)] px-2.5 py-1 text-[12px] font-medium text-[var(--pp-ink-80)] transition hover:bg-[rgba(28,51,38,0.05)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={useSuggestion}
          type="button"
        >
          Use
        </button>
      </div>
    </div>
  );
}

function TimelineLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const showLogo = Boolean(logoUrl) && !failed;

  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-[var(--pp-hairline)] bg-[var(--pp-canvas)] p-1">
      {showLogo && logoUrl ? (
        <Image
          alt=""
          width={28}
          height={28}
          className="size-full object-contain"
          src={logoUrl}
          onError={() => setFailed(true)}
          unoptimized
        />
      ) : (
        <span aria-hidden className="pp-mono text-[11px] font-semibold text-[var(--pp-ink-40)]">
          {timelineInitials(name)}
        </span>
      )}
    </span>
  );
}

function timelineInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

function hasTimelineContent(item: LinkedInTimelineItem): boolean {
  return Boolean(
    item.title.trim() ||
      item.organization.trim() ||
      item.subtitle.trim() ||
      item.dateRange.trim(),
  );
}

function hasSpecificTimelineDetail(item: LinkedInTimelineItem): boolean {
  const title = item.title.trim().toLowerCase();
  return title.length > 0 && title !== "current company";
}

function isGenericTimelinePlaceholder(item: LinkedInTimelineItem): boolean {
  const title = item.title.trim().toLowerCase();
  return title === "education" && !item.organization.trim() && !item.subtitle.trim();
}

function firstVisibleTimelineItem(items: LinkedInTimelineItem[]): LinkedInTimelineItem | null {
  return (
    items.find((item) => hasTimelineContent(item) && !isGenericTimelinePlaceholder(item)) ?? null
  );
}

function educationDraftFromTimelineItem(item: LinkedInTimelineItem): EducationDraft {
  return {
    school: item.organization.trim() || item.title.trim(),
    degree: "",
    major: "",
    year: extractTerminalTimelineYear(item.dateRange),
  };
}

function mergeEducationDraft(current: EducationDraft, suggestion: EducationDraft): EducationDraft {
  return {
    school: suggestion.school || current.school,
    degree: suggestion.degree || current.degree,
    major: suggestion.major || current.major,
    year: suggestion.year || current.year,
  };
}

function educationDraftsEquivalent(current: EducationDraft, suggestion: EducationDraft): boolean {
  const currentSchool = timelineLookupKey(current.school);
  const suggestionSchool = timelineLookupKey(suggestion.school);
  const currentYear = current.year.trim();
  const suggestionYear = suggestion.year.trim();

  return (
    Boolean(currentSchool) &&
    currentSchool === suggestionSchool &&
    (!suggestionYear || currentYear === suggestionYear)
  );
}

function findTimelineLogoUrl(items: LinkedInTimelineItem[], name: string): string | null {
  const key = timelineLookupKey(name);
  if (!key) return null;

  const match = items.find((item) => {
    if (!item.logoUrl) return false;

    const itemKey = timelineLookupKey(item.organization || item.title);
    return Boolean(itemKey && (itemKey.includes(key) || key.includes(itemKey)));
  });

  return match?.logoUrl ?? null;
}

function timelineLookupKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extractTerminalTimelineYear(value: string): string {
  const years = [...value.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => match[0]);
  return years[years.length - 1] ?? "";
}

function EducationDisplay({
  draft,
  allFromSuggestion,
  logoUrl,
}: {
  draft: EducationDraft;
  allFromSuggestion: boolean;
  logoUrl: string | null;
}) {
  const degreeLine =
    draft.degree && draft.major
      ? `${draft.degree} in ${draft.major}`
      : draft.degree || draft.major || "";

  return (
    <div className="flex items-center gap-2.5">
      {logoUrl ? <TimelineLogo name={draft.school || degreeLine} logoUrl={logoUrl} /> : null}
      <div className="m-0 min-w-0 text-[15px] leading-[1.5] text-[var(--pp-ink)]">
        {draft.school ? (
          <p className="m-0 font-medium">
            {draft.school}
            {allFromSuggestion ? <SuggestedTag /> : null}
          </p>
        ) : null}
        {degreeLine || draft.year ? (
          <p className="m-0 mt-0.5 text-[14px] text-[var(--pp-ink-60)]">
            {[degreeLine, draft.year].filter(Boolean).join(" · ")}
            {!draft.school && allFromSuggestion ? <SuggestedTag /> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EducationEditor({
  defaults,
  defaultSchoolDomain,
  defaultSchoolLogoUrl,
  suggestion,
  onCancel,
  onSave,
  setError,
}: {
  defaults: EducationDraft;
  defaultSchoolDomain: string | null;
  defaultSchoolLogoUrl: string | null;
  suggestion: EducationDraft;
  onCancel: () => void;
  onSave: (next: EducationDraft, schoolDomain: string | null) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [{ busy, degree, inlineError, major, year }, updateEditor] = useReducer(
    patchReducer<{
      busy: boolean;
      degree: string;
      inlineError: string | null;
      major: string;
      year: string;
    }>,
    defaults,
    (initialDefaults) => ({
      busy: false,
      degree: initialDefaults.degree,
      inlineError: null,
      major: initialDefaults.major,
      year: initialDefaults.year,
    }),
  );
  const [schoolPick, setSchoolPick] = useState<OrgPick>({
    label: defaults.school,
    domain: defaultSchoolDomain,
  });

  async function commit() {
    updateEditor({ inlineError: null });
    setError(null);
    updateEditor({ busy: true });
    try {
      await onSave(
        {
          school: schoolPick.label.trim(),
          degree: degree.trim(),
          major: major.trim(),
          year: year.trim(),
        },
        schoolPick.domain,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Education update failed.";
      updateEditor({ inlineError: message });
      setError(message);
    } finally {
      updateEditor({ busy: false });
    }
  }

  return (
    <div className="grid gap-2.5">
      <EditorLabel label="School">
        <OrgCombobox
          ariaLabel="School"
          kind="school"
          logoUrl={defaultSchoolLogoUrl}
          maxLength={EDUCATION_FIELD_MAX_LENGTHS.school}
          savedDomain={defaultSchoolDomain}
          onChange={setSchoolPick}
          placeholder={suggestion.school || SCHOOL_PLACEHOLDER}
          value={schoolPick}
        />
      </EditorLabel>
      <div className="grid gap-2.5 sm:grid-cols-[140px_1fr]">
        <EditorLabel label="Degree">
          <input
            aria-label="Degree"
            className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[15px] text-[var(--pp-ink)]"
            value={degree}
            maxLength={EDUCATION_FIELD_MAX_LENGTHS.degree}
            placeholder={suggestion.degree || "e.g. BS"}
            onChange={(e) => updateEditor({ degree: e.target.value })}
          />
        </EditorLabel>
        <EditorLabel label="Major">
          <input
            aria-label="Major"
            className="kin-focus w-full rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[15px] text-[var(--pp-ink)]"
            value={major}
            maxLength={EDUCATION_FIELD_MAX_LENGTHS.major}
            placeholder={suggestion.major || "e.g. Computer Science"}
            onChange={(e) => updateEditor({ major: e.target.value })}
          />
        </EditorLabel>
      </div>
      <EditorLabel label="Class year">
        <input
          aria-label="Class year"
          className="kin-focus w-full max-w-[180px] rounded-xl border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3.5 py-2.5 text-[15px] text-[var(--pp-ink)]"
          value={year}
          maxLength={EDUCATION_FIELD_MAX_LENGTHS.year}
          placeholder={suggestion.year || "e.g. 2023"}
          onChange={(e) => updateEditor({ year: e.target.value })}
        />
      </EditorLabel>
      <InlineError message={inlineError} />
      <div className="flex items-center justify-end gap-2">
        <QuietButton onClick={onCancel} disabled={busy}>
          Cancel
        </QuietButton>
        <PrimaryButton onClick={commit} disabled={busy} loading={busy}>
          Save
        </PrimaryButton>
      </div>
    </div>
  );
}
