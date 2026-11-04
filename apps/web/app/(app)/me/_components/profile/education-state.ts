export type EducationDraftState = {
  degree: string;
  major: string;
  school: string;
  year: string;
};

export type EducationSaveState = {
  displayDraft: EducationDraftState;
  patch: {
    educationDegree: string | null;
    educationMajor: string | null;
    educationSchool: string | null;
    educationYear: string | null;
  };
  userEdits: {
    degree: boolean;
    major: boolean;
    school: boolean;
    year: boolean;
  };
};

export type EducationEditorTransition = {
  editing: boolean;
  topLevelError: string | null;
};

export type EducationFieldMaxLengths = {
  degree: number;
  major: number;
  school: number;
  year: number;
};

export const EDUCATION_FIELD_MAX_LENGTHS: EducationFieldMaxLengths = {
  degree: 60,
  major: 120,
  school: 120,
  year: 20,
};

export function openEducationEditor(): EducationEditorTransition {
  return { editing: true, topLevelError: null };
}

export function closeEducationEditor(): EducationEditorTransition {
  return { editing: false, topLevelError: null };
}

export function resolveEducationSave(
  draft: EducationDraftState,
  suggestion: EducationDraftState,
  maxLengths = EDUCATION_FIELD_MAX_LENGTHS,
): EducationSaveState {
  const school = draft.school.trim().slice(0, maxLengths.school);
  const degree = draft.degree.trim().slice(0, maxLengths.degree);
  const major = draft.major.trim().slice(0, maxLengths.major);
  const year = draft.year.trim().slice(0, maxLengths.year);

  return {
    displayDraft: {
      degree: degree.length > 0 ? degree : suggestion.degree,
      major: major.length > 0 ? major : suggestion.major,
      school: school.length > 0 ? school : suggestion.school,
      year: year.length > 0 ? year : suggestion.year,
    },
    patch: {
      educationDegree: degree.length > 0 ? degree : null,
      educationMajor: major.length > 0 ? major : null,
      educationSchool: school.length > 0 ? school : null,
      educationYear: year.length > 0 ? year : null,
    },
    userEdits: {
      degree: degree.length > 0,
      major: major.length > 0,
      school: school.length > 0,
      year: year.length > 0,
    },
  };
}
