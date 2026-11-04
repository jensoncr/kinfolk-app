function normalizeAddressToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

/**
 * True when `unit` already appears as a whole token run inside `address`, so we
 * don't render "123 Main St Apt 4 Apt 4". Word-boundary matching ensures a unit
 * like "5" inside "2155 Polk St" is NOT mistaken for already-present, and the
 * leading house number is ignored so a unit equal to the building number ("8"
 * for "8 Cypress St") is still appended rather than swallowed.
 */
export function addressAlreadyNamesUnit(address: string, unit: string): boolean {
  const normalizedAddress = normalizeAddressToken(address);
  const normalizedUnit = normalizeAddressToken(unit);
  if (!normalizedAddress || !normalizedUnit) return false;
  // Drop the leading house-number token before checking: "8 Cypress St" + unit
  // "8" must still append the unit instead of matching the building number.
  const addressBody = normalizedAddress.replace(/^\d+\s*/u, "");
  return ` ${addressBody} `.includes(` ${normalizedUnit} `);
}

/**
 * Canonical rule for how Kinfolk renders a listing's display address: the street
 * address, with the unit appended only when the address doesn't already name it.
 * Shared by the apartment match surface and the text agent so the two never
 * drift. Returns null only when there is no address at all.
 */
export function formatListingDisplayAddress(
  address: string | null | undefined,
  unit: string | null | undefined,
): string | null {
  const trimmedAddress = address?.trim();
  if (!trimmedAddress) return null;
  const trimmedUnit = unit?.trim();
  if (!trimmedUnit) return trimmedAddress;
  return addressAlreadyNamesUnit(trimmedAddress, trimmedUnit)
    ? trimmedAddress
    : `${trimmedAddress} ${trimmedUnit}`;
}
