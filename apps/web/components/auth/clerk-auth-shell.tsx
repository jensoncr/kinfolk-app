"use client";

import { SignUp } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";

const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#264a36",
    colorBackground: "#fdfcf8",
    colorText: "#101914",
    colorTextSecondary: "#6b7a70",
    borderRadius: "18px",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "mx-auto w-full max-w-[460px] shadow-[0_30px_70px_-40px_rgba(14,31,23,0.35)]",
    card: "border border-[rgba(28,51,38,0.08)]",
  },
} as const;

const AUTH_COPY = {
  "/sign-up": {
    title: "Create your Kinfolk account.",
    body: "Sign up to start matching with roommates and see apartments that fit the whole group.",
  },
  "/sign-up/continue": {
    title: "Finish your Kinfolk account.",
    body: "LinkedIn is connected. Clerk needs the remaining account details before Kinfolk can open your workspace.",
  },
} as const;

export function ClerkAuthShell({
  path,
  redirectUrl = "/me",
}: {
  path: "/sign-up" | "/sign-up/continue";
  redirectUrl?: string;
}) {
  const postLoginUrl = `/post-login?redirecturl=${encodeURIComponent(redirectUrl)}`;
  const copy = AUTH_COPY[path];

  return (
    <main className="kin-dotted-bg min-h-screen px-5 py-14 text-[#101914] sm:px-6 sm:py-20">
      <div className="mx-auto flex w-full max-w-[760px] flex-col items-center text-center">
        <Link className="kin-focus inline-flex items-center" href="/" aria-label="Kinfolk home">
          <Image
            alt=""
            height={56}
            priority
            src="/assets/kinfolk-logo-mark.png"
            width={56}
          />
        </Link>

        <h1 className="serif mt-10 text-4xl leading-[1.05] tracking-[-0.02em] sm:text-[52px]">
          {copy.title}
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-7 text-[#6b7a70]">
          {copy.body}
        </p>

        <div className="mt-10 w-full">
          <SignUp
            appearance={CLERK_APPEARANCE}
            fallbackRedirectUrl={redirectUrl}
            forceRedirectUrl={postLoginUrl}
            path={path}
            routing="path"
            signInUrl={redirectUrl}
          />
        </div>
      </div>
    </main>
  );
}
