import { textAgentOptOutConfirmationCopy } from "../copy";
import type { SupabaseServiceClient } from "../store-types";
import type { HousingAgentTool } from "./types";

export type SmsConsentEventInput = {
  event: "opted_in" | "opted_out";
  message: string;
  method: "keyword" | "nl_revocation" | "agent_tool";
  phone: string;
  userId: string;
};

// One audit row per consent transition, carrying the verbatim inbound text, so
// every opt-out and opt-in stays provable (FCC revocation rule, April 2025).
// Best-effort: the consent-state flip must never be blocked by the ledger.
export async function recordSmsConsentEvent(
  supabase: SupabaseServiceClient,
  { event, message, method, phone, userId }: SmsConsentEventInput,
) {
  const result = await supabase.from("agent_action_log").insert({
    agent_identifier: "kinfolk_text_agent",
    approval_state: "not_required",
    result_summary: `${event} via ${method} for ${phone}: "${message}"`,
    tool_called: "sms_consent_event",
    user_id: userId,
  });

  if (result.error) {
    console.error("[text-agent] consent audit write failed", {
      error: result.error,
      event,
      method,
      userId,
    });
  }
}

export const optOutTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Stop all Kinfolk texts to this person — a full opt-out. Call it whenever they say to stop texting, messaging, or contacting them, however it's phrased (sarcasm, typos, 'enough of these texts', 'pls stop'). Never call it for search or preference tweaks like 'stop showing studios' or 'stop at 3 listings'. After it runs, send only the short goodbye it returns and end the conversation.",
      name: "opt_out",
      parameters: {
        additionalProperties: false,
        properties: {},
        required: [],
        type: "object",
      },
    },
    type: "function",
  },
  async run(context) {
    const phone =
      context.message?.from_phone_e164 ?? context.thread?.to_phone_e164 ?? null;

    if (!context.allowWrites || !phone) {
      return {
        data: { optedOut: false },
        ok: false,
        summary:
          "Could not switch texts off from here. Tell them replying STOP opts them out immediately.",
        toolName: "opt_out",
      };
    }

    const { setPhoneConsentState } = await import("../run-data");
    const [threadUpdate] = await Promise.all([
      context.supabase
        .from("text_threads")
        .update({ status: "opted_out" })
        .eq("id", context.threadId),
      setPhoneConsentState(context.supabase, context.userId, phone, "opted_out"),
      recordSmsConsentEvent(context.supabase, {
        event: "opted_out",
        message: context.body ?? "",
        method: "agent_tool",
        phone,
        userId: context.userId,
      }),
    ]);

    if (threadUpdate.error) {
      throw threadUpdate.error;
    }

    const confirmation = textAgentOptOutConfirmationCopy();
    return {
      data: { confirmation, optedOut: true },
      ok: true,
      summary: `Texts are now off for this person. Close out by sending exactly this and nothing else: ${confirmation}`,
      toolName: "opt_out",
    };
  },
};
