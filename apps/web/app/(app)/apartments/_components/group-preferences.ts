import type {
  GroupGate,
  GroupGenderPreference,
  GroupMoveInWindow,
  GroupPetPreference,
  GroupPreferences,
} from "@/lib/apartments/types";

type PreferenceOption<T extends string> = {
  value: T;
  label: string;
};

export const genderPreferenceOptions: PreferenceOption<GroupGenderPreference>[] = [
  { value: "women", label: "Women" },
  { value: "men", label: "Men" },
  { value: "nonbinary", label: "Nonbinary people" },
];

export const petPreferenceOptions: PreferenceOption<GroupPetPreference>[] = [
  { value: "friendly", label: "Pet-friendly" },
  { value: "none", label: "No pets" },
];

export const moveInPreferenceOptions: PreferenceOption<GroupMoveInWindow>[] = [
  { value: "asap", label: "Move-in ASAP" },
  { value: "1w", label: "Move-in ~1 week" },
  { value: "1m", label: "Move-in ~1 month" },
  { value: "1m-plus", label: "Move-in 1+ month out" },
];

export type GroupPreferenceChip = {
  label: string;
  tone: "soft" | GroupGate;
};

const MIN_PREFERRED_AGE = 18;
const MAX_PREFERRED_AGE = 120;

function normalizePreferredAge(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < MIN_PREFERRED_AGE || rounded > MAX_PREFERRED_AGE) return null;
  return rounded;
}

export function validatePreferredAgeRange(
  ageMin: number | null,
  ageMax: number | null,
): string | null {
  const normalizedMin = normalizePreferredAge(ageMin);
  const normalizedMax = normalizePreferredAge(ageMax);
  const hasInvalidMin = ageMin != null && normalizedMin == null;
  const hasInvalidMax = ageMax != null && normalizedMax == null;

  if (hasInvalidMin || hasInvalidMax) {
    return `Age preferences must be between ${MIN_PREFERRED_AGE} and ${MAX_PREFERRED_AGE}.`;
  }
  if (normalizedMin != null && normalizedMax != null && normalizedMin > normalizedMax) {
    return "Minimum age must be less than or equal to maximum age.";
  }

  return null;
}

export function normalizeGroupPreferences(prefs: GroupPreferences): GroupPreferences | null {
  const ageMin = normalizePreferredAge(prefs.ageMin);
  const ageMax = normalizePreferredAge(prefs.ageMax);
  const invalidAgeRange = ageMin != null && ageMax != null && ageMin > ageMax;
  const normalizedPrefs: GroupPreferences = {
    ...prefs,
    ageMin: invalidAgeRange ? null : ageMin,
    ageMax: invalidAgeRange ? null : ageMax,
  };

  if (
    !normalizedPrefs.gender &&
    normalizedPrefs.ageMin == null &&
    normalizedPrefs.ageMax == null &&
    !normalizedPrefs.pets &&
    !normalizedPrefs.industry &&
    !normalizedPrefs.moveIn
  ) {
    return null;
  }

  return normalizedPrefs;
}

export function summarizeGroupPreferences(
  prefs: GroupPreferences | null | undefined,
): GroupPreferenceChip[] {
  if (!prefs) {
    return [];
  }

  const chips: GroupPreferenceChip[] = [];
  if (prefs.gender) {
    chips.push({ label: optionLabel(genderPreferenceOptions, prefs.gender), tone: "soft" });
  }
  const ageMin = normalizePreferredAge(prefs.ageMin);
  const ageMax = normalizePreferredAge(prefs.ageMax);
  if (
    (ageMin != null || ageMax != null) &&
    !(ageMin != null && ageMax != null && ageMin > ageMax)
  ) {
    const label =
      ageMin != null && ageMax != null
        ? `Age ${ageMin}-${ageMax}`
        : ageMin != null
          ? `Age ${ageMin}+`
          : `Age up to ${ageMax}`;
    chips.push({ label, tone: "soft" });
  }
  if (prefs.pets) {
    chips.push({ label: optionLabel(petPreferenceOptions, prefs.pets.value), tone: prefs.pets.gate });
  }
  if (prefs.industry) {
    chips.push({ label: prefs.industry.value, tone: prefs.industry.gate });
  }
  if (prefs.moveIn) {
    chips.push({
      label: optionLabel(moveInPreferenceOptions, prefs.moveIn.value),
      tone: prefs.moveIn.gate,
    });
  }
  return chips;
}

function optionLabel<T extends string>(options: PreferenceOption<T>[], value: T) {
  return options.find((option) => option.value === value)?.label ?? value;
}
