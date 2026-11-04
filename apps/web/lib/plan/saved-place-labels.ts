export function normalizeSavedAreaLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

export function savedAreaLabelKey(label: string): string {
  return normalizeSavedAreaLabel(label).toLowerCase();
}
