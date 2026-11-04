function cleanPhoneDigits(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length > 0 ? digits : "";
}

export function normalizeE164(value: string | null | undefined) {
  const digits = cleanPhoneDigits(value);
  return digits ? `+${digits}` : "";
}

export function normalizeSmsRecipient(value: string | null | undefined) {
  const digits = cleanPhoneDigits(value);
  if (!digits) {
    return "";
  }

  return value?.trim().startsWith("+") ? `+${digits}` : digits;
}

function normalizePlausiblePhoneE164(value: string | null | undefined) {
  const digits = cleanPhoneDigits(value);
  if (digits.length < 10 || digits.length > 15) {
    return "";
  }
  return `+${digits}`;
}

export function normalizePhoneE164(value: string | null | undefined) {
  return normalizePlausiblePhoneE164(value);
}
