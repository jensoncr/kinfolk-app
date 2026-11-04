import {
  defaultSourceLabel,
  normalizeProvider,
} from "@/lib/profiles/enrichment-providers";
import {
  buildAssistantProfilePrompt,
  type AssistantProfileProvider,
} from "@/lib/profiles/enrichment-prompt";
import type { ProfileEnrichmentSnapshot } from "@/lib/shared/types";

export type ImportMemoriesState = {
  busy: boolean;
  error: string | null;
  payloadText: string;
  provider: string;
  sourceLabel: string;
};

export type ImportMemoriesAction =
  | { type: "import-failed"; error: string }
  | { type: "import-started" }
  | { type: "import-succeeded" }
  | { type: "payload-changed"; value: string }
  | { type: "provider-changed"; provider: string }
  | { type: "source-label-changed"; value: string };

export type ImportMemoriesRequestPayload = {
  method: "paste";
  payload: string;
  provider: string;
  sourceLabel: string;
};

type ImportMemoriesSubmitResponse = {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};

export type ImportMemoriesSubmitFetch = (
  input: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
  },
) => Promise<ImportMemoriesSubmitResponse>;

export type ImportMemoriesSubmitResult =
  | {
      ok: true;
      provider: string;
      snapshot?: ProfileEnrichmentSnapshot;
    }
  | {
      ok: false;
      error: string;
    };

export type AssistantPromptCopyResult =
  | { ok: true; prompt: string }
  | { ok: false; error: string; prompt: string };

type AssistantPromptClipboard = {
  writeText: (value: string) => Promise<void>;
};

export function createInitialImportMemoriesState(
  initialProvider?: string,
): ImportMemoriesState {
  const provider = normalizeProvider(initialProvider);
  return {
    busy: false,
    error: null,
    payloadText: "",
    provider,
    sourceLabel: defaultSourceLabel(provider),
  };
}

export function importMemoriesReducer(
  state: ImportMemoriesState,
  action: ImportMemoriesAction,
): ImportMemoriesState {
  switch (action.type) {
    case "import-failed":
      return { ...state, busy: false, error: action.error };
    case "import-started":
      return { ...state, busy: true, error: null };
    case "import-succeeded":
      return { ...state, busy: false, error: null, payloadText: "" };
    case "payload-changed":
      return { ...state, payloadText: action.value };
    case "provider-changed": {
      const provider = normalizeProvider(action.provider);
      return {
        ...state,
        provider,
        sourceLabel: defaultSourceLabel(provider),
      };
    }
    case "source-label-changed":
      return { ...state, sourceLabel: action.value };
  }
}

export function canSubmitImportMemories(state: ImportMemoriesState) {
  return !state.busy && state.payloadText.trim().length > 0;
}

export async function copyAssistantProfilePrompt(
  providerValue: string,
  clipboard: AssistantPromptClipboard | null | undefined,
): Promise<AssistantPromptCopyResult> {
  const provider = normalizeProvider(providerValue);
  if (!isAssistantProfileProvider(provider)) {
    return {
      ok: false,
      error: "Choose ChatGPT or Claude before copying a prompt.",
      prompt: "",
    };
  }

  const prompt = buildAssistantProfilePrompt(provider);
  if (!clipboard?.writeText) {
    return {
      ok: false,
      error: "Clipboard access is unavailable. Select and copy the prompt below.",
      prompt,
    };
  }

  try {
    await clipboard.writeText(prompt);
    return { ok: true, prompt };
  } catch {
    return {
      ok: false,
      error: "The browser blocked clipboard access. Select and copy the prompt below.",
      prompt,
    };
  }
}

function isAssistantProfileProvider(
  provider: string,
): provider is AssistantProfileProvider {
  return provider === "chatgpt" || provider === "claude";
}

export function buildImportMemoriesRequestPayload({
  payloadText,
  provider,
  sourceLabel,
}: Pick<
  ImportMemoriesState,
  "payloadText" | "provider" | "sourceLabel"
>): ImportMemoriesRequestPayload {
  return {
    provider,
    method: "paste",
    sourceLabel: sourceLabel.trim() || "Manual profile import",
    payload: payloadText,
  };
}

export async function submitImportMemories(
  state: ImportMemoriesState,
  fetcher: ImportMemoriesSubmitFetch = fetch,
): Promise<ImportMemoriesSubmitResult> {
  try {
    const response = await fetcher("/api/profile-enrichment/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildImportMemoriesRequestPayload(state)),
    });
    const data = parseImportMemoriesResponse(
      await response.json().catch(() => ({})),
    );

    if (!response.ok || (data.error && !data.snapshot)) {
      return {
        ok: false,
        error: data.error ?? `Request failed with ${response.status}.`,
      };
    }

    return {
      ok: true,
      provider: state.provider,
      snapshot: data.snapshot,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Import failed.",
    };
  }
}

function parseImportMemoriesResponse(value: unknown): {
  error?: string;
  snapshot?: ProfileEnrichmentSnapshot;
} {
  if (!value || typeof value !== "object") return {};
  const record = value as {
    error?: unknown;
    snapshot?: ProfileEnrichmentSnapshot;
  };

  return {
    error: typeof record.error === "string" ? record.error : undefined,
    snapshot: record.snapshot,
  };
}
