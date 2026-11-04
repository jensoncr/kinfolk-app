import type { ModelMessage } from "ai";
import type { CompletedTurn } from "./housing-agent-adapter";

// Renders a scenario conversation the way the judge should see it: the words
// each side sent, plus per-agent-turn annotations for what the agent actually
// DID (tools called, cards attached) — behavior a text-only transcript hides.

export function renderTranscript(
  messages: ModelMessage[],
  turns: CompletedTurn[],
): string {
  const lines: string[] = [];
  let agentTurnIndex = 0;

  for (const message of messages) {
    const text = messageText(message);
    if (!text) {
      continue;
    }
    if (message.role === "user") {
      lines.push(`RENTER: ${text}`);
    } else if (message.role === "assistant") {
      const turn = turns[agentTurnIndex];
      agentTurnIndex += 1;
      lines.push(`AGENT: ${text}`);
      if (turn) {
        lines.push(`  [agent turn ${agentTurnIndex}: ${describeTurn(turn)}]`);
      }
    }
  }
  return lines.join("\n");
}

function describeTurn(turn: CompletedTurn): string {
  const tools =
    turn.toolCalls.length > 0
      ? turn.toolCalls
          .map((call) => `${call.name}(${JSON.stringify(call.args).slice(0, 160)})`)
          .join("; ")
      : "no tools called";

  const labelsByUrl = new Map<string, string>();
  for (const result of turn.toolResults) {
    for (const media of result.media ?? []) {
      labelsByUrl.set(media.url, media.label);
    }
  }
  const cards = turn.mediaUrls.map(
    (url) => labelsByUrl.get(url) ?? "unlabeled card",
  );

  return [
    `tools: ${tools}`,
    cards.length > 0
      ? `cards attached: ${cards.join(", ")}`
      : "no cards attached",
    `model: ${turn.model}`,
    `rounds: ${turn.rounds}`,
  ].join(" | ");
}

export function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .map((part) =>
      typeof part === "object" && part !== null && "text" in part
        ? String((part as { text: unknown }).text ?? "")
        : "",
    )
    .join(" ")
    .trim();
}
