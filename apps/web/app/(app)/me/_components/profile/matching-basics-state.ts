const BUDGET_MIN = 1;
const BUDGET_MAX = 50000;
const AGE_MIN = 18;
const AGE_MAX = 100;
export const HOUSEHOLD_SIZE_MIN = 1;
export const HOUSEHOLD_SIZE_MAX = 8;

type FieldResult = {
  value: number | null;
  isInvalid: boolean;
};

export type BudgetSaveState =
  | {
      ok: true;
      patch: {
        budgetMin: number | null;
        budgetMax: number | null;
      };
      display: {
        budgetMin: number;
        budgetMax: number;
      };
    }
  | {
      ok: false;
      error: string;
    };

export type AgeComfortSaveState =
  | {
      ok: true;
      patch: {
        age: number;
        preferredAgeMin: number | null;
        preferredAgeMax: number | null;
        preferredAgeStrict: boolean;
      };
      display: {
        age: number;
        preferredAgeMin: number | null;
        preferredAgeMax: number | null;
        preferredAgeStrict: boolean;
      };
    }
  | {
      ok: false;
      error: string;
    };

export type MoveInSaveState =
  | {
      ok: true;
      patch: {
        moveInStart: string;
        moveInEnd: string;
      };
      display: {
        moveInStart: string;
        moveInEnd: string;
      };
    }
  | {
      ok: false;
      error: string;
    };

export type HouseholdSaveState =
  | {
      ok: true;
      patch: {
        householdSizeMin: number;
        householdSizeMax: number;
      };
      display: {
        householdSizeMin: number;
        householdSizeMax: number;
      };
    }
  | {
      ok: false;
      error: string;
    };

export function resolveBudgetSave(minDraft: string, maxDraft: string): BudgetSaveState {
  const min = readOptionalWholeNumber(minDraft, BUDGET_MIN, BUDGET_MAX);
  const max = readOptionalWholeNumber(maxDraft, BUDGET_MIN, BUDGET_MAX);

  if (min.isInvalid || max.isInvalid) {
    return {
      ok: false,
      error: "Use whole positive numbers.",
    };
  }

  if (min.value !== null && max.value !== null && min.value > max.value) {
    return {
      ok: false,
      error: "Minimum must be below maximum.",
    };
  }

  return {
    ok: true,
    patch: {
      budgetMin: min.value,
      budgetMax: max.value,
    },
    display: {
      budgetMin: min.value ?? 0,
      budgetMax: max.value ?? 0,
    },
  };
}

export function resolveMoveInSave(moveByDateDraft: string): MoveInSaveState {
  const moveByDate = moveByDateDraft.trim();

  if (!moveByDate) {
    return {
      ok: false,
      error: "Add the date you expect to start your lease.",
    };
  }

  if (!isValidIsoDate(moveByDate)) {
    return {
      ok: false,
      error: "Use a valid move-in date.",
    };
  }

  return {
    ok: true,
    patch: {
      moveInStart: moveByDate,
      moveInEnd: moveByDate,
    },
    display: {
      moveInStart: moveByDate,
      moveInEnd: moveByDate,
    },
  };
}

export function resolveHouseholdSave(maxDraft: string): HouseholdSaveState {
  const max = readRequiredWholeNumber(maxDraft, HOUSEHOLD_SIZE_MIN, HOUSEHOLD_SIZE_MAX);

  if (max.isInvalid || max.value === null) {
    return {
      ok: false,
      error: "Choose a household size between 1 and 8.",
    };
  }

  return {
    ok: true,
    patch: {
      householdSizeMin: 1,
      householdSizeMax: max.value,
    },
    display: {
      householdSizeMin: 1,
      householdSizeMax: max.value,
    },
  };
}

export function resolveAgeComfortSave({
  ageDraft,
  minDraft,
  maxDraft,
  strict,
}: {
  ageDraft: string;
  minDraft: string;
  maxDraft: string;
  strict: boolean;
}): AgeComfortSaveState {
  const age = readRequiredWholeNumber(ageDraft, AGE_MIN, AGE_MAX);
  if (age.isInvalid || age.value === null) {
    return {
      ok: false,
      error: "Add your age between 18 and 100.",
    };
  }

  const min = readOptionalWholeNumber(minDraft, AGE_MIN, AGE_MAX);
  const max = readOptionalWholeNumber(maxDraft, AGE_MIN, AGE_MAX);

  if (min.isInvalid || max.isInvalid) {
    return {
      ok: false,
      error: "Use whole ages between 18 and 100.",
    };
  }

  if (min.value !== null && max.value !== null && min.value > max.value) {
    return {
      ok: false,
      error: "Minimum must be below maximum.",
    };
  }

  const nextStrict = min.value === null && max.value === null ? false : strict;

  return {
    ok: true,
    patch: {
      age: age.value,
      preferredAgeMin: min.value,
      preferredAgeMax: max.value,
      preferredAgeStrict: nextStrict,
    },
    display: {
      age: age.value,
      preferredAgeMin: min.value,
      preferredAgeMax: max.value,
      preferredAgeStrict: nextStrict,
    },
  };
}

function readRequiredWholeNumber(value: string, min: number, max: number): FieldResult {
  const result = readOptionalWholeNumber(value, min, max);
  return result.value === null ? { value: null, isInvalid: true } : result;
}

function readOptionalWholeNumber(value: string, min: number, max: number): FieldResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { value: null, isInvalid: false };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { value: null, isInvalid: true };
  }

  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    return { value: null, isInvalid: true };
  }

  return { value: number, isInvalid: false };
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
