export type AboutTextSaveState = {
  displayValue: string;
  isUserEdited: boolean;
  patchValue: string | null;
};

export const ABOUT_TEXT_MAX_LENGTH = 800;

export function resolveAboutTextSave(
  draft: string,
  suggestion: string,
  maxLength = ABOUT_TEXT_MAX_LENGTH,
): AboutTextSaveState {
  const trimmed = draft.trim().slice(0, maxLength);

  if (trimmed.length > 0) {
    return {
      displayValue: trimmed,
      isUserEdited: true,
      patchValue: trimmed,
    };
  }

  return {
    displayValue: suggestion,
    isUserEdited: false,
    patchValue: null,
  };
}
