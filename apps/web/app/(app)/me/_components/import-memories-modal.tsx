"use client";

import Image from "next/image";
import { useEffect, useReducer, useRef, useState } from "react";
import { AlertCircle, Check, Copy, X } from "lucide-react";
import type { ProfileEnrichmentSnapshot } from "@/lib/shared/types";
import {
  type AssistantPromptCopyResult,
  canSubmitImportMemories,
  copyAssistantProfilePrompt,
  createInitialImportMemoriesState,
  importMemoriesReducer,
  submitImportMemories,
} from "@/app/(app)/me/_components/import-memories-modal-state";
import {
  providerOptions,
} from "@/lib/profiles/enrichment-providers";

// One source of truth for the paste-to-import dialog. Rendered both from the
// first-run welcome modal (preset to the provider the user clicked) and from the
// Memories settings panel. The component is intentionally self-contained — it
// owns its draft + the POST — so any host just toggles `open`.

// Both marks are colored glyphs on transparent, so they sit on a white chip
// (the Claude glyph is itself #D97757 — on an orange chip it would vanish).
const providerMeta: Record<
  string,
  { instructions: string; name: string; logo: string }
> = {
  chatgpt: {
    instructions:
      "ChatGPT opens without the prompt. Paste the Kinfolk prompt there, send it, then paste the reply here.",
    name: "ChatGPT",
    logo: "/assets/openai-square-logo.svg",
  },
  claude: {
    instructions:
      "Send the Kinfolk prompt in Claude, then paste the reply here.",
    name: "Claude",
    logo: "/assets/claude-square-logo.svg",
  },
};

type PromptCopyState =
  | { status: "idle"; message: null; prompt: "" }
  | { status: "copied"; message: string; prompt: string }
  | { status: "failed"; message: string; prompt: string };

const initialPromptCopyState: PromptCopyState = {
  status: "idle",
  message: null,
  prompt: "",
};

export function ImportMemoriesModal({
  open,
  initialProvider,
  initialPromptCopyResult,
  onClose,
  onImported,
}: {
  open: boolean;
  initialProvider?: string;
  initialPromptCopyResult?: Promise<AssistantPromptCopyResult> | null;
  onClose: () => void;
  onImported?: (snapshot: ProfileEnrichmentSnapshot, provider: string) => void;
}) {
  // Hosts remount this via `key` when (re)opening, so initializers are enough —
  // no effect needed to sync the preselected provider or clear the draft.
  const [state, dispatch] = useReducer(
    importMemoriesReducer,
    initialProvider,
    createInitialImportMemoriesState,
  );
  const { busy, error, payloadText, provider, sourceLabel } = state;
  const [promptCopy, setPromptCopy] = useState<PromptCopyState>(
    initialPromptCopyState,
  );

  // Drive the dialog through showModal() (not a bare `open` attribute): that
  // is what makes Escape fire `cancel` and gives the native focus trap the
  // aria-modal semantics promise.
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!initialPromptCopyResult) {
      return;
    }

    let active = true;
    void initialPromptCopyResult.then((result) => {
      if (active) {
        setPromptCopy(promptCopyStateFromResult(result));
      }
    });

    return () => {
      active = false;
    };
  }, [initialPromptCopyResult]);

  if (!open) {
    return null;
  }

  const meta = providerMeta[provider];

  async function handleImport() {
    dispatch({ type: "import-started" });

    const result = await submitImportMemories({
      busy,
      error,
      payloadText,
      provider,
      sourceLabel,
    });

    if (!result.ok) {
      dispatch({
        type: "import-failed",
        error: result.error,
      });
      return;
    }

    if (result.snapshot) {
      onImported?.(result.snapshot, result.provider);
    }
    dispatch({ type: "import-succeeded" });
    onClose();
  }

  async function handleCopyPrompt() {
    const result = await copyAssistantProfilePrompt(provider, navigator.clipboard);
    setPromptCopy(promptCopyStateFromResult(result));
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="import-memories-title"
      className="fixed inset-0 z-[100] m-0 flex h-screen w-screen max-h-none max-w-none items-end justify-center border-0 bg-[rgba(15,26,20,0.42)] px-3 py-3 backdrop-blur-[2px] sm:items-center sm:px-6 sm:py-6"
      data-testid="import-memories-modal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-[640px] overflow-hidden rounded-[18px] border border-[rgba(28,51,38,0.1)] bg-[#fdfcf8] shadow-[0_40px_100px_-45px_rgba(14,31,23,0.7)]">
        <div className="flex items-start justify-between gap-4 border-b border-[rgba(28,51,38,0.08)] bg-[#f4f1e8] px-5 py-4">
          <div className="flex items-start gap-3">
            {meta ? (
              <Image
                alt=""
                aria-hidden="true"
                className="size-9 shrink-0 rounded-[10px] bg-white p-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.14)]"
                height={36}
                src={meta.logo}
                width={36}
              />
            ) : null}
            <div>
              <p className="pp-mono m-0 text-[10.5px] font-medium uppercase tracking-[0.16em] text-[#9aa39d]">
                Import memories
              </p>
              <h3
                className="serif m-0 mt-1 text-[22px] leading-tight text-[#0f1a14]"
                id="import-memories-title"
              >
                {meta ? `Paste your ${meta.name} memories` : "Paste a memory dump"}
              </h3>
              <p className="m-0 mt-1.5 max-w-[52ch] text-[12.5px] leading-[1.55] text-[#5c6b61]">
                {meta
                  ? `${meta.instructions} Kinfolk imports it as draft facts and only applies the ones you approve.`
                  : "Kinfolk imports it as draft facts first, then only applies the standard facts you approve."}
              </p>
            </div>
          </div>
          <button
            aria-label="Close import"
            className="kin-focus inline-grid size-8 shrink-0 place-items-center rounded-full text-[#9aa39d] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[#3a4a40]"
            onClick={onClose}
            type="button"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="max-h-[calc(92vh-150px)] overflow-y-auto px-5 py-4">
          {meta ? (
            <div className="mb-4 border-b border-[rgba(28,51,38,0.08)] pb-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  className="kin-focus inline-flex items-center gap-2 rounded-md border border-[rgba(28,51,38,0.18)] bg-white px-3 py-2 text-[12.5px] font-medium text-[#264a36] transition hover:bg-[#f7f5ef]"
                  data-testid="profile-import-copy-prompt"
                  onClick={() => void handleCopyPrompt()}
                  title={`Copy the Kinfolk prompt for ${meta.name}`}
                  type="button"
                >
                  {promptCopy.status === "copied" ? (
                    <Check aria-hidden size={15} />
                  ) : (
                    <Copy aria-hidden size={15} />
                  )}
                  <span>
                    {promptCopy.status === "copied"
                      ? "Prompt copied"
                      : "Copy assistant prompt"}
                  </span>
                </button>
                {promptCopy.message ? (
                  <span
                    className={
                      promptCopy.status === "failed"
                        ? "text-[12px] text-[#8a4b20]"
                        : "text-[12px] text-[#5c6b61]"
                    }
                    role="status"
                  >
                    {promptCopy.message}
                  </span>
                ) : null}
              </div>
              {promptCopy.status === "failed" && promptCopy.prompt ? (
                <textarea
                  aria-label={`${meta.name} profile prompt`}
                  className="kin-focus pp-mono mt-3 min-h-[132px] w-full resize-y rounded-lg border border-[rgba(155,77,32,0.2)] bg-white px-3 py-2 text-[11px] leading-[1.45] text-[#0f1a14]"
                  onFocus={(event) => event.currentTarget.select()}
                  readOnly
                  value={promptCopy.prompt}
                />
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="pp-mono text-[10.5px] uppercase tracking-[0.12em] text-[#9aa39d]">
                Source
              </span>
              <select
                className="kin-focus mt-1 w-full rounded-lg border border-[rgba(28,51,38,0.18)] bg-white px-3 py-2 text-[13px] text-[#0f1a14]"
                data-testid="profile-import-provider"
                value={provider}
                onChange={(e) => {
                  dispatch({ type: "provider-changed", provider: e.target.value });
                  setPromptCopy(initialPromptCopyState);
                }}
              >
                {providerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="pp-mono text-[10.5px] uppercase tracking-[0.12em] text-[#9aa39d]">
                Label
              </span>
              <input
                aria-label="Profile import label"
                className="kin-focus mt-1 w-full rounded-lg border border-[rgba(28,51,38,0.18)] bg-white px-3 py-2 text-[13px] text-[#0f1a14]"
                data-testid="profile-import-source-label"
                value={sourceLabel}
                onChange={(e) =>
                  dispatch({ type: "source-label-changed", value: e.target.value })
                }
              />
            </label>
          </div>
          <textarea
            aria-label="Profile import payload"
            className="kin-focus pp-mono mt-3 min-h-[240px] w-full resize-y rounded-lg border border-[rgba(28,51,38,0.18)] bg-white px-3 py-2.5 text-[12px] leading-[1.5] text-[#0f1a14]"
            data-testid="profile-import-payload"
            placeholder="Paste the JSON your assistant returned. Markdown code fences are okay."
            value={payloadText}
            onChange={(e) => dispatch({ type: "payload-changed", value: e.target.value })}
            spellCheck={false}
          />
          {error ? (
            <div
              className="mt-3 flex gap-2 rounded-lg border border-[rgba(155,77,32,0.2)] bg-[rgba(155,77,32,0.06)] px-3 py-2 text-[12.5px] leading-[1.5] text-[#8a4b20]"
              role="status"
            >
              <AlertCircle aria-hidden className="mt-0.5 shrink-0" size={14} />
              <span>{error}</span>
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              className="kin-focus inline-flex items-center rounded-md px-2.5 py-1.5 text-[12px] font-medium text-[#6b7a70] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[#0f1a14] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="kin-focus inline-flex items-center rounded-full bg-[#264a36] px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#1c3526] disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="profile-import-submit"
              disabled={!canSubmitImportMemories(state)}
              onClick={handleImport}
              type="button"
            >
              {busy ? "Importing..." : "Import"}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function promptCopyStateFromResult(
  result: AssistantPromptCopyResult,
): PromptCopyState {
  return result.ok
    ? {
        status: "copied",
        message: "Prompt copied",
        prompt: result.prompt,
      }
    : {
        status: "failed",
        message: result.error,
        prompt: result.prompt,
      };
}
