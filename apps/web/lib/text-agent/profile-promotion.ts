import type { TextProfileFact } from "./index";

export function refreshMatchingStateForTextProfileFacts(
  facts: TextProfileFact[],
): boolean | "deferred" {
  return facts.some(isInlineMatchingFact) ? true : "deferred";
}

function isInlineMatchingFact(fact: TextProfileFact) {
  return (
    fact.matching_eligible !== false &&
    fact.sensitivity_level === "standard"
  );
}
