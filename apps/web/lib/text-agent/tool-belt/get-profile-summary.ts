import type { HousingAgentTool } from "./types";

export const getProfileSummaryTool: HousingAgentTool = {
  definition: {
    function: {
      description:
        "Summarize the user's approved Kinfolk housing and roommate profile facts.",
      name: "get_profile_summary",
      parameters: {
        additionalProperties: false,
        properties: {},
        type: "object",
      },
    },
    type: "function",
  },
  async run(context) {
    const threadDataModule = import("../thread-data");
    const [{ summarizeTextProfileFacts }, facts] = await Promise.all([
      import(".."),
      threadDataModule.then(({ loadUserTextAgentCoverageFacts }) =>
        loadUserTextAgentCoverageFacts(context.supabase, context.userId),
      ),
    ]);
    const summary = summarizeTextProfileFacts(facts);

    return {
      data: {
        factCount: facts.length,
        summary,
      },
      ok: true,
      summary: summary || "No approved profile facts are available yet.",
      toolName: "get_profile_summary",
    };
  },
};
