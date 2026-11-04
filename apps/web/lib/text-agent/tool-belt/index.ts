import {
  runWithAgentSpan,
  setActiveSpanAttributes,
} from "../../integrations/otel-tracing";
import { getAreaSignalsTool } from "./get-area-signals";
import { getListingDetailsTool } from "./get-listing-details";
import { getMatchesTool } from "./get-matches";
import { getProfileSummaryTool } from "./get-profile-summary";
import { listChatsTool, readChatTool, sendChatMessageTool } from "./chat";
import { manageGroupTool } from "./manage-group";
import { messageRoommateMatchTool } from "./message-match";
import { setNotificationPrefsTool } from "./notification-prefs";
import { optOutTool } from "./opt-out";
import { searchListingsTool } from "./search-listings";
import { updatePrefsTool } from "./update-prefs";
import type {
  HousingAgentTool,
  HousingAgentToolContext,
  HousingAgentToolName,
} from "./types";

const tools = [
  updatePrefsTool,
  searchListingsTool,
  getListingDetailsTool,
  getMatchesTool,
  getAreaSignalsTool,
  getProfileSummaryTool,
  listChatsTool,
  readChatTool,
  sendChatMessageTool,
  messageRoommateMatchTool,
  manageGroupTool,
  setNotificationPrefsTool,
  optOutTool,
] satisfies HousingAgentTool[];

const toolByName = new Map(tools.map((tool) => [tool.definition.function.name, tool]));

export function getHousingAgentToolDefinitions() {
  return tools.map((tool) => tool.definition);
}

export async function runHousingAgentTool(
  context: HousingAgentToolContext,
  name: HousingAgentToolName,
  args: Record<string, unknown>,
) {
  const tool = toolByName.get(name);
  if (!tool) {
    return {
      data: { requestedTool: name },
      ok: false,
      summary: `Unknown housing agent tool: ${name}`,
      toolName: name,
    };
  }

  return runWithAgentSpan(
    {
      attributes: {
        "gen_ai.tool.name": name,
        "kinfolk.run_id": context.runId,
        "kinfolk.thread_id": context.threadId,
        "kinfolk.tool_args": JSON.stringify(args).slice(0, 4000),
        "kinfolk.user_id": context.userId,
      },
      name: `housing_agent_tool:${name}`,
    },
    async () => {
      const result = await tool.run(context, args);
      setActiveSpanAttributes({
        "kinfolk.tool_media_count": result.media?.length ?? 0,
        "kinfolk.tool_ok": result.ok,
        "kinfolk.tool_summary": result.summary.slice(0, 4000),
      });
      return result;
    },
  );
}

export type {
  HousingAgentToolContext,
  HousingAgentToolName,
  HousingAgentToolResult,
} from "./types";
