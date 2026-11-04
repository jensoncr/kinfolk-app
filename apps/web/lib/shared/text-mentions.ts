/**
 * True when `text` already mentions `value` as a whole word/phrase, compared
 * case- and punctuation-insensitively. Used to decide whether appending a
 * detail ("at Stripe") would read as a duplicate of the headline text.
 */
export function textMentionsValue(text: string, value: string): boolean {
  const normalizedText = normalizeComparableText(text);
  const normalizedValue = normalizeComparableText(value);

  if (!normalizedText || !normalizedValue) {
    return false;
  }

  return normalizedText.split(" ").includes(normalizedValue)
    ? true
    : normalizedText === normalizedValue ||
        normalizedText.startsWith(`${normalizedValue} `) ||
        normalizedText.endsWith(` ${normalizedValue}`) ||
        normalizedText.includes(` ${normalizedValue} `);
}

function normalizeComparableText(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
