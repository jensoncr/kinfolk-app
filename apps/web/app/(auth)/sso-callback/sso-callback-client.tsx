"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

export function SsoCallbackClient() {
  return (
    <main className="kin-dotted-bg grid min-h-screen place-items-center px-5 text-[#101914]">
      <div className="flex flex-col items-center text-center">
        <Image
          alt=""
          height={56}
          priority
          src="/assets/kinfolk-logo-mark.png"
          width={56}
        />
        <p className="serif mt-8 text-[26px] leading-[1.05] tracking-[-0.02em]">
          Completing sign in…
        </p>
        <Loader2
          aria-hidden="true"
          className="mt-6 animate-spin text-[#6b7a70]"
          size={18}
        />
        <Suspense fallback={<div id="clerk-captcha" />}>
          <SsoCallbackRedirect />
        </Suspense>
      </div>
    </main>
  );
}

function SsoCallbackRedirect() {
  const searchParams = useSearchParams();
  const redirectUrl = getSafeRedirectUrl(searchParams.get("kinfolkRedirectUrl"));

  return (
    <>
      <div id="clerk-captcha" />
      <AuthenticateWithRedirectCallback
        continueSignUpUrl="/sign-up/continue"
        signInForceRedirectUrl={redirectUrl}
        signInUrl="/me"
        signUpForceRedirectUrl={redirectUrl}
        signUpUrl="/sign-up"
        verifyPhoneNumberUrl="/sign-up/continue"
      />
    </>
  );
}

function getSafeRedirectUrl(value: string | null) {
  if (!value) {
    return "/post-login";
  }

  try {
    const redirectUrl = new URL(value, window.location.origin);
    if (redirectUrl.origin !== window.location.origin) {
      return "/post-login";
    }

    return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
  } catch {
    return "/post-login";
  }
}
