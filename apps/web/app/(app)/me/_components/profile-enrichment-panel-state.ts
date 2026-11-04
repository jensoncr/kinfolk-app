import {
  defaultSourceLabel,
  normalizeProvider,
} from "@/lib/profiles/enrichment-providers";

export type ProfileImportSourceState = {
  provider: string;
  sourceLabel: string;
};

export type ProfileImportRequestPayload = {
  method: "paste";
  payload: string;
  provider: string;
  sourceLabel: string;
};

export function canSaveProfileFactEdit(value: string): boolean {
  return value.trim().length > 0;
}

export function createProfileImportSourceState(
  initialProvider?: string,
): ProfileImportSourceState {
  const provider = normalizeProvider(initialProvider);

  return {
    provider,
    sourceLabel: defaultSourceLabel(provider),
  };
}

export function updateProfileImportProvider(
  value: string,
): ProfileImportSourceState {
  const provider = normalizeProvider(value);

  return {
    provider,
    sourceLabel: defaultSourceLabel(provider),
  };
}

export function buildProfileImportRequestPayload({
  payloadText,
  provider,
  sourceLabel,
}: ProfileImportSourceState & { payloadText: string }): ProfileImportRequestPayload {
  return {
    method: "paste",
    payload: payloadText,
    provider: normalizeProvider(provider),
    sourceLabel: sourceLabel.trim() || "Manual profile import",
  };
}
