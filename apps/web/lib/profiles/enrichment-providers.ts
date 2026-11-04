// Shared config for the paste-to-import ("memories") dialog, rendered both from
// the Memories settings panel and the first-run import modal. Keeping the
// provider list + label derivation in one place avoids the two hosts drifting.
export const providerOptions = [
  { value: "chatgpt", label: "ChatGPT memories" },
  { value: "claude", label: "Claude memories" },
  { value: "manual", label: "Manual JSON" },
  { value: "other", label: "Other" },
];

export function normalizeProvider(provider: string | undefined) {
  const normalized = provider?.trim().toLowerCase();
  return normalized && providerOptions.some((option) => option.value === normalized)
    ? normalized
    : "manual";
}

export function defaultSourceLabel(provider: string) {
  if (provider === "chatgpt") {
    return "ChatGPT memories";
  }
  if (provider === "claude") {
    return "Claude memories";
  }
  return "Manual profile import";
}
