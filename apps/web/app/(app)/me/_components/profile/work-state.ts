export type WorkSaveState = {
  companyDisplayValue: string;
  companyIsUserEdited: boolean;
  companyPatchValue: string | null;
  titleDisplayValue: string;
  titleIsUserEdited: boolean;
  titlePatchValue: string | null;
};

export const WORK_FIELD_MAX_LENGTH = 120;

export type WorkEditorTransition = {
  editing: boolean;
  topLevelError: string | null;
};

export function openWorkEditor(): WorkEditorTransition {
  return { editing: true, topLevelError: null };
}

export function closeWorkEditor(): WorkEditorTransition {
  return { editing: false, topLevelError: null };
}

export function resolveWorkSave(
  titleDraft: string,
  companyDraft: string,
  suggestionTitle: string,
  suggestionCompany: string,
  maxLength = WORK_FIELD_MAX_LENGTH,
): WorkSaveState {
  const title = titleDraft.trim().slice(0, maxLength);
  const company = companyDraft.trim().slice(0, maxLength);

  return {
    companyDisplayValue: company.length > 0 ? company : suggestionCompany,
    companyIsUserEdited: company.length > 0,
    companyPatchValue: company.length > 0 ? company : null,
    titleDisplayValue: title.length > 0 ? title : suggestionTitle,
    titleIsUserEdited: title.length > 0,
    titlePatchValue: title.length > 0 ? title : null,
  };
}
