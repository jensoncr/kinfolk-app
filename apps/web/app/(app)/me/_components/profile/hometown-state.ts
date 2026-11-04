import { locationLabelsMatch } from "@/lib/shared/location-suggestions";

export type HometownSaveState = {
  displayValue: string;
  patchValue: string | null;
};

export type HometownEditorTransition = {
  editing: boolean;
  topLevelError: string | null;
};

export const HOMETOWN_MAX_LENGTH = 120;

export function openHometownEditor(): HometownEditorTransition {
  return { editing: true, topLevelError: null };
}

export function closeHometownEditor(): HometownEditorTransition {
  return { editing: false, topLevelError: null };
}

export function canSaveHometownDraft(draft: string, selectedValue: string) {
  const trimmed = draft.trim();
  return trimmed.length === 0 || locationLabelsMatch(trimmed, selectedValue);
}

export function resolveHometownSave(
  draft: string,
  suggestion: string,
  maxLength = HOMETOWN_MAX_LENGTH,
): HometownSaveState {
  const trimmed = draft.trim().slice(0, maxLength);

  if (trimmed.length > 0) {
    return {
      displayValue: trimmed,
      patchValue: trimmed,
    };
  }

  return {
    displayValue: suggestion,
    patchValue: null,
  };
}
