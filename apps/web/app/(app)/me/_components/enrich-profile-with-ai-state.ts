import { getVisibleAssistantProviders } from "./assistant-provider-visibility";
import {
  buildAssistantProfilePrompt,
  buildChatGptProfileImportUrl,
  buildClaudeProfileImportUrl,
  type AssistantProfileProvider,
} from "@/lib/profiles/enrichment-prompt";
import type { ProfileImportSummary } from "@/lib/shared/types";

export const ASSISTANT_PROFILE_PROMPTS: Record<AssistantProfileProvider, string> = {
  chatgpt: buildAssistantProfilePrompt("chatgpt"),
  claude: buildAssistantProfilePrompt("claude"),
};

// Import URLs derive only from the static prompt constants above, so compute
// them once at module load rather than on every render.
const enrichUrl: Record<AssistantProfileProvider, string> = {
  claude: buildClaudeProfileImportUrl(ASSISTANT_PROFILE_PROMPTS.claude),
  chatgpt: buildChatGptProfileImportUrl(ASSISTANT_PROFILE_PROMPTS.chatgpt),
};

export const ENRICH_PROVIDER_STYLE: Record<
  AssistantProfileProvider,
  {
    label: string;
    logoSrc: string;
    logoClassName: string;
    subtitleColor: string;
    chevronColor: string;
    checkColor: string;
  }
> = {
  claude: {
    label: "Enrich with Claude",
    logoSrc: "/assets/claude-square-logo.svg",
    logoClassName:
      "size-9 shrink-0 rounded-[10px] bg-white p-1.5 shadow-[0_1px_3px_rgba(0,0,0,0.18)]",
    subtitleColor: "text-white/80",
    chevronColor: "text-white/70",
    checkColor: "text-white/90",
  },
  chatgpt: {
    label: "Enrich with ChatGPT",
    logoSrc: "/assets/openai-square-logo.svg",
    logoClassName: "size-9 shrink-0",
    subtitleColor: "text-[#6b7a70]",
    chevronColor: "text-[#9aa39d]",
    checkColor: "text-[#264a36]",
  },
};

const emptyImports: ProfileImportSummary[] = [];
const emptyHiddenProviders: AssistantProfileProvider[] = [];

// Where a "N pending" button sends you: the Memories settings page surfaces the
// pending facts to approve/reject at the top.
const REVIEW_HREF = "/me/settings/memories";

export type EnrichProviderRowState = {
  copied: boolean;
  failed: boolean;
  href: string;
  label: string;
  mode: "review" | "enrich";
  pending: number;
  provider: AssistantProfileProvider;
  subtitle: string;
};

export function getEnrichProviderRows({
  copiedProvider = null,
  hiddenProviders = emptyHiddenProviders,
  imports = emptyImports,
  previewAll = false,
}: {
  copiedProvider?: AssistantProfileProvider | null;
  hiddenProviders?: readonly AssistantProfileProvider[];
  imports?: ProfileImportSummary[];
  previewAll?: boolean;
} = {}): EnrichProviderRowState[] {
  return getVisibleAssistantProviders(imports, {
    hiddenProviders,
    previewAll,
  }).map(({ provider, view }) => {
    const style = ENRICH_PROVIDER_STYLE[provider];

    if (!previewAll && view.pending > 0) {
      return {
        copied: false,
        failed: view.failed,
        href: REVIEW_HREF,
        label: style.label,
        mode: "review",
        pending: view.pending,
        provider,
        subtitle: `${view.pending} pending`,
      };
    }

    const copied = copiedProvider === provider;

    return {
      copied,
      failed: view.failed,
      href: enrichUrl[provider],
      label: style.label,
      mode: "enrich",
      pending: view.pending,
      provider,
      subtitle: enrichSubtitle(provider, copied, view.failed),
    };
  });
}

function enrichSubtitle(
  provider: AssistantProfileProvider,
  copied: boolean,
  failed: boolean,
) {
  if (copied) {
    return provider === "claude"
      ? "Prompt copied - opening Claude..."
      : "Prompt copied - paste it into ChatGPT";
  }
  if (failed) {
    return "Import failed - try again";
  }
  return provider === "claude"
    ? "Asks for you - paste the reply back"
    : "Copies the prompt - paste it into ChatGPT";
}
