import type { DashboardSnapshot } from "@/lib/shared/types";
import { normalizePhoneE164 } from "@/lib/shared/phone";

type ProfileSetupTaskKey =
  | "phone"
  | "ageComfort"
  | "interview"
  | "budget"
  | "moveIn"
  | "household";

export type ProfileSetupState = {
  phone: string;
  phoneVerified: boolean;
  age: number | null;
  preferredAgeMin: number | null;
  preferredAgeMax: number | null;
  preferredAgeStrict: boolean;
  interviewStatus: string;
  budgetMin: number;
  budgetMax: number;
  moveInStart: string;
  moveInEnd: string;
  householdSizeMin: number;
  householdSizeMax: number;
};

export type ProfileSetupTask = {
  key: ProfileSetupTaskKey;
  label: string;
  description: string;
  href: string;
  isComplete: boolean;
  optional: boolean;
};

export type ProfileSetupProgress = {
  completed: number;
  total: number;
  percent: number;
  tasks: ProfileSetupTask[];
  nextTask: ProfileSetupTask | null;
};

// Order = the new-user funnel. Lead with low-friction, value-producing steps
// (budget, roommate openness, move date) so the first nudge moves the user
// toward matches. Phone verification gates intros / external visibility, not
// basic profile-building, so it comes after the user has invested and seen
// value — not as the very first thing asked.
const TASK_DEFINITIONS: Array<Omit<ProfileSetupTask, "isComplete">> = [
  {
    key: "budget",
    label: "Budget",
    description: "Set the monthly per-person range your agent should respect.",
    href: "/me/profile#setup-budget",
    optional: false,
  },
  {
    key: "household",
    label: "Roommate openness",
    description: "Say whether you are open to roommates and any limits your agent should respect.",
    href: "/me/profile#setup-household",
    optional: false,
  },
  {
    key: "moveIn",
    label: "Looking to move by",
    description: "Tell Kinfolk when you expect to start your lease.",
    href: "/me/profile#setup-move-in",
    optional: false,
  },
  {
    key: "ageComfort",
    label: "Age range",
    description: "Set your age and preferred roommate age range.",
    href: "/me/profile#setup-age-comfort",
    optional: false,
  },
  {
    key: "phone",
    label: "Verify phone",
    description: "Text Kinfolk once so intros and agent messages can reach you.",
    href: "/me/profile#setup-phone",
    optional: false,
  },
  {
    key: "interview",
    label: "Finish interview",
    description: "Capture the roommate context that should not be public profile copy.",
    href: "/me/profile#setup-interview",
    optional: true,
  },
];

export function readProfileSetupState(snapshot: DashboardSnapshot): ProfileSetupState {
  return {
    phone: snapshot.user.phone,
    phoneVerified: snapshot.user.phoneVerified,
    age: snapshot.user.age,
    preferredAgeMin: snapshot.roommate.preferredAgeMin,
    preferredAgeMax: snapshot.roommate.preferredAgeMax,
    preferredAgeStrict: snapshot.roommate.preferredAgeStrict,
    interviewStatus: snapshot.interview.status,
    budgetMin: snapshot.profile.budgetMin,
    budgetMax: snapshot.profile.budgetMax,
    moveInStart: snapshot.profile.moveInStart,
    moveInEnd: snapshot.profile.moveInEnd,
    householdSizeMin: snapshot.profile.householdSizeMin,
    householdSizeMax: snapshot.profile.householdSizeMax,
  };
}

export function getProfileSetupProgress(setup: ProfileSetupState): ProfileSetupProgress {
  const tasks = TASK_DEFINITIONS.map((task) => ({
    ...task,
    isComplete: isProfileSetupTaskComplete(task.key, setup),
  }));
  const requiredTasks = tasks.filter((task) => !task.optional);
  const completed = requiredTasks.filter((task) => task.isComplete).length;
  const total = requiredTasks.length;

  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    tasks,
    nextTask: tasks.find((task) => !task.isComplete && !task.optional) ?? null,
  };
}

function isProfileSetupTaskComplete(key: ProfileSetupTaskKey, setup: ProfileSetupState) {
  switch (key) {
    case "phone":
      return setup.phoneVerified && isRealVerifiedPhone(setup.phone);
    case "ageComfort":
      return isAgeComfortTaskComplete(
        setup.age,
        setup.preferredAgeMin,
        setup.preferredAgeMax,
      );
    case "interview":
      return setup.interviewStatus.toLowerCase() === "completed";
    case "budget":
      return isBudgetTaskComplete(setup.budgetMin, setup.budgetMax);
    case "moveIn":
      return Boolean(setup.moveInStart && setup.moveInEnd);
    case "household":
      return setup.householdSizeMin > 0 && setup.householdSizeMax >= setup.householdSizeMin;
  }
}

function isRealVerifiedPhone(phone: string) {
  return normalizePhoneE164(phone).length > 0;
}

function isAgeComfortTaskComplete(
  age: number | null,
  preferredAgeMin: number | null,
  preferredAgeMax: number | null,
) {
  if (age == null || age < 18 || age > 100) {
    return false;
  }

  if (preferredAgeMin == null || preferredAgeMax == null) {
    return false;
  }

  return preferredAgeMin >= 18 && preferredAgeMax >= preferredAgeMin;
}

function isBudgetTaskComplete(min: number, max: number) {
  const hasMin = min > 0;
  const hasMax = max > 0;

  if (!hasMin && !hasMax) {
    return false;
  }

  return !(hasMin && hasMax && min > max);
}
