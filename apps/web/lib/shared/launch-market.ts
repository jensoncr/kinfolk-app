export const DEFAULT_LAUNCH_MARKET = "";
const LEGACY_DEFAULT_LAUNCH_MARKET = "New York City";

export function normalizeLaunchMarket(value: string | null | undefined) {
  const market = value?.trim() ?? "";
  return market === LEGACY_DEFAULT_LAUNCH_MARKET ? "" : market;
}
