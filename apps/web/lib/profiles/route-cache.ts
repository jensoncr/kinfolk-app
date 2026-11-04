import "server-only";

import { revalidatePath } from "next/cache";

const profileDependentPaths = [
  "/me",
  "/me/profile",
  "/me/matches",
  "/me/settings/memories",
  "/apartments",
];

export function revalidateProfileDependentPaths() {
  for (const path of profileDependentPaths) {
    revalidatePath(path);
  }
}
