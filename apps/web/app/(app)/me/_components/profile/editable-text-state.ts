export type EditableTextTransition = {
  draft: string;
  editing: boolean;
  inlineError: string | null;
  topLevelError: string | null;
};

export function openEditableTextEditor(value: string): EditableTextTransition {
  return {
    draft: value,
    editing: true,
    inlineError: null,
    topLevelError: null,
  };
}

export function closeEditableTextEditor(): EditableTextTransition {
  return {
    draft: "",
    editing: false,
    inlineError: null,
    topLevelError: null,
  };
}
