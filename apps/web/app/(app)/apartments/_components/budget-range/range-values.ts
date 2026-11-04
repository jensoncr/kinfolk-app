import { BUDGET_CEILING, BUDGET_FLOOR, type BudgetRange } from "./types";

export function rangeToSliderValues(range: BudgetRange): [number, number] {
  return [range.min ?? BUDGET_FLOOR, range.max ?? BUDGET_CEILING];
}

export function sliderValuesToRange([sliderMin, sliderMax]: [number, number]): BudgetRange {
  return {
    min: sliderMin <= BUDGET_FLOOR ? null : sliderMin,
    max: sliderMax >= BUDGET_CEILING ? null : sliderMax,
  };
}
