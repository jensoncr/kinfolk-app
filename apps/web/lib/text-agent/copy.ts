import type { TextAgentIntakeStep } from "./index";

// Every canned line the deterministic spine can send lives here, written in
// soul.md's voice: warm, specific, one idea per line, never a "Reply X to do Y"
// menu. Behavior stays deterministic — same triggers, same flow, only words.

function copyVariantIndex(seed: string | null | undefined, length: number) {
  if (!seed) {
    return 0;
  }

  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

export function textAgentScopeDeclineCopy() {
  return "That one's outside my world — I live in SF apartments and roommates. Neighborhoods, rent, listings, your matches: that I can do all day.";
}

export const textAgentOutageReplyVariants = [
  "Hit a snag on my end — give me a minute and ask me again?",
  "Something jammed on my side just now. Try me again in a bit and I'll pick it right up.",
  "I lost my train of thought for a second — mind sending that again in a minute?",
] as const;

// Seeded by run id so a retried run resends the same bubble (idempotent) while
// back-to-back failures on different runs don't repeat the exact same line.
export function textAgentOutageReplyCopy(seed?: string | null) {
  return textAgentOutageReplyVariants[
    copyVariantIndex(seed, textAgentOutageReplyVariants.length)
  ];
}

export function textAgentReviewReplyCopy({
  intent,
  reviewUrl,
}: {
  intent: string;
  reviewUrl?: string | null;
}) {
  const lead =
    intent === "edit"
      ? "Sure — everything I've saved about you is yours to edit."
      : "Your profile update is sitting in Kinfolk, ready for a look.";
  return reviewUrl
    ? `${lead} ${reviewUrl}`
    : `${lead} In the app it lives under Settings, then Memories.`;
}

// The one place SKIP is explained — questions themselves never repeat it.
export function textAgentIntakeIntroCopy(question: string) {
  return [
    "You're connected. A few quick questions so the matches actually fit — say SKIP to any of them.",
    "",
    question,
  ].join("\n");
}

export function textAgentIntakeQuestionCopy(step: TextAgentIntakeStep) {
  switch (step) {
    case "budget":
      return "What monthly rent feels comfortable? A ceiling like $3,000 is plenty to go on.";
    case "move_in":
      return "When do you want to move? A rough month is fine.";
    case "roommates":
      return "Are you open to roommates, or hunting solo?";
    case "age_comfort":
      return "What roommate age range feels right? Toss in your own age if you'd like.";
    case "commute":
      return "Where do you head most weeks — an office, campus, gym? I'll favor places with an easy trip there.";
    case "sleep_schedule":
      return "What's your sleep schedule like — early bird, night owl, somewhere in between?";
    case "work_from_home":
      return "How often are you home working during the day?";
    case "cleanliness":
      return "How clean do shared spaces need to be for you to relax?";
    case "noise_tolerance":
      return "How do you feel about noise at home — music, calls, late-night footsteps?";
    case "guests":
      return "What guest rhythm feels normal to you — friends over a lot, rarely, somewhere in between?";
    case "social_energy":
      return "What energy do you want at home — roommates who hang out, or quiet coexisting?";
    case "communication_style":
      return "How should roommates raise house stuff with you — direct texts, casual check-ins, house meetings?";
    case "conflict_repair":
      return "When friction comes up at home, how do you like to clear the air?";
    case "trust_context":
      return "Anything that helps roommates trust the fit — work, school, mutual friends, references?";
    case "interests":
      return "What are you into outside work — the weekend things a roommate would notice?";
    case "pets":
      return "Any pets in the picture, or strong feelings about living with them?";
    case "must_haves":
      return "Any apartment must-haves beyond what you've already told me?";
    case "dealbreakers":
      return "Any hard no's — for the place or the people in it?";
    case "rent_tradeoff":
      return "Where would you flex first — rent, neighborhood, commute, room size, or lease certainty?";
    case "home_preferences":
      return "Any home must-haves or hard no's I should hold onto?";
    case "neighborhoods":
    default:
      return "First up — which SF neighborhoods are you drawn to? A few names is perfect.";
  }
}

const intakeAckVariants = [
  (list: string) => `Got your ${list}.`,
  (list: string) => `Saved your ${list}.`,
  (list: string) => `Locked in your ${list}.`,
] as const;

export function textAgentIntakeAckCopy(labelList: string, seed: string) {
  return intakeAckVariants[copyVariantIndex(seed, intakeAckVariants.length)](
    labelList,
  );
}

export function textAgentIntakeWrapCopy() {
  return "That's plenty to work with — I'll keep matching from here. Text me whenever something changes.";
}

export function textAgentIntakeNoDetailsCopy() {
  return "All good — we can come back to those anytime. Let's start simple.";
}

export function textAgentOptOutConfirmationCopy() {
  return "Done — I'll stop texting you. If you ever want back in, text START and we'll pick it right back up.";
}

export function textAgentOptInConfirmationCopy() {
  return "Good to have you back — texts are on again. Text STOP anytime to turn them off. Otherwise, tell me what's changed and I'll get to work.";
}
