import { profileMatchBandForScore } from "@/lib/matching/profile-match-calibration";

// Fit colour carries meaning, not decoration: green reads "good", ochre "worth a
// look", muted "not really a fit". Every surface that shows a score derives from
// the same calibration band so a low score can never wear a confident green.
export type FitTone = "positive" | "caution" | "muted";

export function fitToneForScore(score: number): FitTone {
  const { rank } = profileMatchBandForScore(score);
  if (rank >= 3) return "positive"; // promising · good · strong
  if (rank === 2) return "caution"; // needs a check
  return "muted"; // low fit
}

export const FIT_TEXT: Record<FitTone, string> = {
  positive: "text-[var(--forest-700)]",
  caution: "text-[#7a5220]",
  muted: "text-[var(--ink-500)]",
};
