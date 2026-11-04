type ProfileMatchBandKey =
  | "strong_match"
  | "good_match"
  | "promising"
  | "needs_a_check"
  | "low_fit";

type ProfileMatchBand = {
  key: ProfileMatchBandKey;
  label: string;
  minScore: number;
  rank: number;
};

const profileMatchBands: Record<ProfileMatchBandKey, ProfileMatchBand> = {
  strong_match: {
    key: "strong_match",
    label: "Strong match",
    minScore: 88,
    rank: 5,
  },
  good_match: {
    key: "good_match",
    label: "Good match",
    minScore: 76,
    rank: 4,
  },
  promising: {
    key: "promising",
    label: "Promising",
    minScore: 62,
    rank: 3,
  },
  needs_a_check: {
    key: "needs_a_check",
    label: "Needs a check",
    minScore: 45,
    rank: 2,
  },
  low_fit: {
    key: "low_fit",
    label: "Low fit",
    minScore: 0,
    rank: 1,
  },
};

export function profileMatchBandForScore(score: number) {
  if (score >= profileMatchBands.strong_match.minScore) {
    return profileMatchBands.strong_match;
  }
  if (score >= profileMatchBands.good_match.minScore) {
    return profileMatchBands.good_match;
  }
  if (score >= profileMatchBands.promising.minScore) {
    return profileMatchBands.promising;
  }
  if (score >= profileMatchBands.needs_a_check.minScore) {
    return profileMatchBands.needs_a_check;
  }
  return profileMatchBands.low_fit;
}
