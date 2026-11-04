import type { SupabaseServiceClient, TableRow } from "../store-types";

export type HousingAgentToolName =
  | "get_area_signals"
  | "get_listing_details"
  | "get_matches"
  | "get_profile_summary"
  | "list_chats"
  | "manage_group"
  | "message_roommate_match"
  | "opt_out"
  | "read_chat"
  | "send_chat_message"
  | "set_notification_prefs"
  | "search_listings"
  | "update_prefs";

type HousingAgentToolDefinition = {
  function: {
    description: string;
    name: HousingAgentToolName;
    parameters: Record<string, unknown>;
  };
  type: "function";
};

export type HousingAgentToolContext = {
  allowWrites?: boolean;
  // The verbatim inbound text and its stored rows. Required for live writes
  // (update_prefs) so persistence reuses Kinfolk's normal incremental path.
  body?: string;
  message?: TableRow<"text_messages">;
  // The current run id, used to scope persisted listing recommendation cards.
  runId?: string;
  // Set while onboarding intake is unfinished: update_prefs still saves, but it
  // stops reporting roommate score motion, so the reply cannot narrate a
  // compatibility percentage the intake gate is simultaneously withholding.
  suppressScoreMotion?: boolean;
  supabase: SupabaseServiceClient;
  thread?: TableRow<"text_threads">;
  threadId: string;
  userId: string;
};

// A renderable card (roommate or listing) a tool surfaced. Labels are the names
// or addresses the agent would say; the loop attaches a card only when its label
// appears in the final reply, so exclusions/filters are respected automatically.
export type HousingAgentToolMedia = {
  label: string;
  url: string;
};

export type HousingAgentToolResult = {
  data: Record<string, unknown>;
  media?: HousingAgentToolMedia[];
  ok: boolean;
  summary: string;
  toolName: HousingAgentToolName;
};

export type HousingAgentTool = {
  definition: HousingAgentToolDefinition;
  run: (
    context: HousingAgentToolContext,
    args: Record<string, unknown>,
  ) => Promise<HousingAgentToolResult>;
};
