"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { ChevronRight, LogOut } from "lucide-react";

export function SignOutRow() {
  const { signOut } = useClerk();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut({ redirectUrl: "/" });
  }

  return (
    <button
      className="kin-focus group flex w-full items-center gap-4 px-4 py-3.5 text-left text-[14px] font-medium text-[#9f3326] transition hover:bg-[rgba(159,51,38,0.04)] disabled:cursor-wait disabled:opacity-70"
      disabled={isSigningOut}
      onClick={handleSignOut}
      type="button"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[rgba(159,51,38,0.08)] text-[#9f3326]"
      >
        <LogOut size={16} strokeWidth={1.7} />
      </span>
      <span className="flex-1">{isSigningOut ? "Logging out..." : "Log out"}</span>
      <ChevronRight
        aria-hidden
        className="text-[#c0a39d] transition-transform group-hover:translate-x-0.5"
        size={14}
      />
    </button>
  );
}
