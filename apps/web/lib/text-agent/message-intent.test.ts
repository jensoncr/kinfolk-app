import { describe, expect, it } from "vitest";
import { isExplicitListingAsk } from "./message-intent";

// This classifier is the escape hatch on the onboarding listing gate, so both
// error directions are real bugs: a false negative refuses someone who asked to
// see places, and a false positive re-opens the studio dump the gate exists to
// stop.
describe("isExplicitListingAsk", () => {
  it.each([
    "can you show me some apartments in nob hill?",
    "show me places under 2k",
    "what do you have?",
    "what can we get in the mission or bernal?",
    "any 2brs available?",
    "whats available in soma",
    "find me a studio near the caltrain",
    "let's look for listings this weekend",
  ])("treats %j as a request to see places", (body) => {
    expect(isExplicitListingAsk(body)).toBe(true);
  });

  it.each([
    // Intake ANSWERS — these are what the live failure misread as a search cue.
    "let's do nob hill and the marina",
    "$3000 max",
    "3000 a month per person",
    "september 1st works",
    "i'm open to 2 roommates",
    "yeah i'd live with roommates",
    // Listing-adjacent statements that are not asks.
    "i have a place in mind already",
    "we got a place lined up but it fell through",
  ])("treats %j as not a request to see places", (body) => {
    expect(isExplicitListingAsk(body)).toBe(false);
  });
});
