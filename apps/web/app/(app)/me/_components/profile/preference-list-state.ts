import {
  normalizeEditablePreferenceList,
  WEB_EDITABLE_LIST_MAX_ITEMS,
  WEB_EDITABLE_LIST_VALUE_MAX_LENGTH,
} from "@/lib/profiles/fact-normalization";

export const MAX_PREFERENCE_TAGS = WEB_EDITABLE_LIST_MAX_ITEMS;
export const PREFERENCE_TAG_MAX_LENGTH = WEB_EDITABLE_LIST_VALUE_MAX_LENGTH;

export type PreferenceListEditorTransition = {
  editing: boolean;
  inlineError: string | null;
  topLevelError: string | null;
};

export function openPreferenceListEditor(): PreferenceListEditorTransition {
  return { editing: true, inlineError: null, topLevelError: null };
}

export function closePreferenceListEditor(): PreferenceListEditorTransition {
  return { editing: false, inlineError: null, topLevelError: null };
}

export function normalizePreferenceList(values: string[]): string[] {
  return normalizeEditablePreferenceList(values);
}

export function addPreferenceDraft(tags: string[], draft: string): string[] {
  const value = normalizePreferenceTag(draft);
  if (!value) {
    return normalizePreferenceList(tags);
  }

  return normalizePreferenceList([...tags, value]);
}

function normalizePreferenceTag(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, PREFERENCE_TAG_MAX_LENGTH);
}
