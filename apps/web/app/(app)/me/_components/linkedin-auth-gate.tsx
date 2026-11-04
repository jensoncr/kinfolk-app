"use client";

import { useClerk, useReverification, useSignIn, useUser } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import {
  buildAuthRedirectUrls,
  buildExternalAccountCallbackUrl,
  getOAuthErrorMessage,
} from "@/lib/integrations/clerk-oauth";

type AuthProvider = "linkedin" | "google";

export function LinkedInAuthGate() {
  return (
    <Suspense fallback={<LinkedInAuthGateFallback />}>
      <LinkedInAuthGateContent />
    </Suspense>
  );
}

function LinkedInAuthGateContent() {
  const clerk = useClerk();
  const { fetchStatus, signIn } = useSignIn();
  const { isLoaded: userLoaded, user } = useUser();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [authProvider, setAuthProvider] = useState<AuthProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const ready = userLoaded && (Boolean(user) || (fetchStatus !== "fetching" && Boolean(signIn)));
  const isRedirecting = authProvider !== null;
  const shouldShowRecovery = showRecovery && !ready;

  useEffect(() => {
    if (ready) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowRecovery(true);
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [ready]);
  const createExternalAccount = useReverification(async (provider: AuthProvider) => {
    if (!user) {
      throw new Error("Sign in again before connecting an account.");
    }

    const account = await user.createExternalAccount({
      strategy: provider === "linkedin" ? "oauth_linkedin_oidc" : "oauth_google",
      redirectUrl: buildExternalAccountCallbackUrl({
        origin: window.location.origin,
        pathname,
        searchParams,
        spreadSearchParams: true,
      }),
      oidcPrompt: provider === "linkedin" ? "consent" : undefined,
    });

    const url = account.verification?.externalVerificationRedirectURL;
    if (url) {
      window.location.assign(url.toString());
      return;
    }

    if (account.verification?.status === "verified") {
      await user.reload();
      return;
    }

    const providerLabel = provider === "linkedin" ? "LinkedIn" : "Google";
    throw new Error(`Couldn't start the ${providerLabel} connection. Try again.`);
  });

  async function handleAuth(provider: AuthProvider) {
    if (!ready || isRedirecting) {
      return;
    }

    setAuthProvider(provider);
    setErrorMessage(null);

    const { callbackUrl, completeUrl } = buildAuthRedirectUrls({
      origin: window.location.origin,
      pathname,
      searchParams,
      spreadSearchParams: true,
    });

    try {
      if (user) {
        await createExternalAccount(provider);
        return;
      }

      if (!signIn) {
        throw new Error("Clerk sign-in is still loading.");
      }

      if (provider === "linkedin") {
        await clerk.client.signIn.authenticateWithRedirect({
          strategy: "oauth_linkedin_oidc",
          redirectUrl: callbackUrl,
          redirectUrlComplete: completeUrl,
          continueSignIn: false,
          continueSignUp: false,
          oidcPrompt: "consent",
        });
        return;
      }

      await clerk.client.signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: callbackUrl,
        redirectUrlComplete: completeUrl,
        continueSignIn: false,
        continueSignUp: false,
      });
    } catch (error) {
      const providerLabel = provider === "linkedin" ? "LinkedIn" : "Google";
      console.error(`[${providerLabel} OAuth] Clerk redirect failed`, error);
      if (isReverificationCancelledError(error)) {
        setErrorMessage(`${providerLabel} connection was canceled before verification finished.`);
      } else {
        setErrorMessage(
          getOAuthErrorMessage(
            error,
            `${providerLabel} sign-in is not fully configured yet. Please try again later.`,
          ),
        );
      }
      setAuthProvider(null);
    }
  }

  async function resetAuthSession() {
    if (isRedirecting) {
      return;
    }

    setErrorMessage(null);
    setAuthProvider("linkedin");

    try {
      await clerk.signOut({ redirectUrl: window.location.href });
    } catch (error) {
      console.error("[Clerk OAuth] Session reset failed", error);
      setErrorMessage("Refresh the page and try again. Secure sign-in is still warming up.");
      setAuthProvider(null);
    }
  }

  return (
    <main className="kin-dotted-bg flex min-h-screen flex-col text-[#101914]">
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col items-center px-5 pb-8 pt-16 text-center sm:px-6 sm:pt-24">
        <Link className="kin-focus inline-flex items-center" href="/" aria-label="Kinfolk home">
          <Image
            alt=""
            height={64}
            priority
            src="/assets/kinfolk-logo-mark.png"
            width={64}
          />
        </Link>

        <h1 className="serif mt-12 text-5xl leading-[1.02] tracking-[-0.02em] text-[#101914] sm:mt-14 sm:text-[64px]">
          Welcome to Kinfolk.
        </h1>
        <h2 className="serif mt-3 text-4xl leading-[1.05] tracking-[-0.02em] text-[#a9b4a3] sm:text-[52px]">
          What&rsquo;s your LinkedIn?
        </h2>

        <div className="mt-12 w-full max-w-[560px]">
          <div className="rounded-[28px] border border-[rgba(28,51,38,0.08)] bg-[#fdfcf8] px-6 py-8 shadow-[0_30px_70px_-40px_rgba(14,31,23,0.35)] sm:px-8">
            <div className="flex flex-col gap-4">
              <button
                aria-label="Continue with LinkedIn"
                className="kin-focus group inline-flex w-full items-center justify-center gap-3 rounded-full bg-[#264a36] px-7 py-4 text-[15px] font-semibold text-white shadow-[0_18px_38px_-20px_rgba(38,74,54,0.7)] transition hover:bg-[#1c3526] disabled:cursor-not-allowed disabled:bg-[#264a36]/80"
                data-clerk="linkedin-oauth"
                disabled={!ready || isRedirecting}
                onClick={() => handleAuth("linkedin")}
                type="button"
              >
              {ready && authProvider !== "linkedin" ? (
                <>
                  <Image
                    alt=""
                    aria-hidden="true"
                    className="size-6 rounded-[5px]"
                    height={24}
                    src="/assets/LinkedIn_icon.svg.png"
                    width={24}
                  />
                  <span>Continue with LinkedIn</span>
                  <ArrowRight
                    aria-hidden="true"
                    className="transition-transform group-hover:translate-x-0.5"
                    size={16}
                  />
                </>
              ) : (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" size={18} />
                  <span>{authProvider === "linkedin" ? "Opening LinkedIn" : "Loading secure sign-in"}</span>
                </>
              )}
            </button>
              <button
                className="kin-focus inline-flex items-center justify-center gap-2 text-[13px] leading-5 text-[#7a857e] underline underline-offset-2 transition hover:text-[#101914] disabled:cursor-not-allowed disabled:text-[#9aa39d]"
                data-clerk="google-oauth"
                disabled={!ready || isRedirecting}
                onClick={() => handleAuth("google")}
                type="button"
              >
              {authProvider === "google" ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" size={14} />
                  <span>Opening Google</span>
                </>
              ) : (
                "I don't have LinkedIn"
              )}
              </button>
              {errorMessage ? (
                <p className="text-[13px] leading-5 text-[#9f3326]" role="alert">
                  {errorMessage}
                </p>
              ) : null}
              {shouldShowRecovery ? (
                <button
                  className="kin-focus inline-flex items-center justify-center gap-2 text-[13px] leading-5 text-[#7a857e] underline underline-offset-2 transition hover:text-[#101914] disabled:cursor-not-allowed disabled:text-[#9aa39d]"
                  disabled={isRedirecting}
                  type="button"
                  onClick={() => {
                    void resetAuthSession();
                  }}
                >
                  Reset secure sign-in
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex justify-center">
            <div id="clerk-captcha" />
          </div>
          <p className="mt-6 text-[12.5px] leading-5 text-[#7a857e]">
            By continuing you agree to our{" "}
            <Link className="kin-focus underline underline-offset-2 hover:text-[#101914]" href="/terms">
              Terms
            </Link>{" "}
            and{" "}
            <Link className="kin-focus underline underline-offset-2 hover:text-[#101914]" href="/privacy">
              Privacy
            </Link>
            .
          </p>
          <p className="mx-auto mt-3 max-w-md text-[12px] leading-5 text-[#7a857e]">
            Your identity and contact details stay hidden until both sides approve. Kinfolk only shares
            context.
          </p>
        </div>

        <footer className="mt-auto flex w-full flex-col items-center pt-16 text-center">
          <div
            aria-hidden="true"
            className="flex items-center gap-6 text-[10px] uppercase tracking-[0.24em] text-[#9aa39d]/70"
          >
            <span className="mono">SOC 2</span>
            <span className="h-px w-8 bg-[rgba(28,51,38,0.1)]" />
            <span className="mono">Encrypted</span>
            <span className="h-px w-8 bg-[rgba(28,51,38,0.1)]" />
            <span className="mono">Audit log</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

function LinkedInAuthGateFallback() {
  return (
    <main className="kin-dotted-bg min-h-screen text-[#101914]">
      <div className="mx-auto flex w-full max-w-[760px] flex-col items-center px-5 pb-20 pt-16 text-center sm:px-6 sm:pt-24">
        <Image alt="" height={64} priority src="/assets/kinfolk-logo-mark.png" width={64} />
        <div className="mt-12 inline-flex items-center gap-3 rounded-full bg-[#264a36] px-6 py-3 text-[14px] font-semibold text-white">
          <Loader2 aria-hidden="true" className="animate-spin" size={18} />
          Loading secure sign-in
        </div>
        <div id="clerk-captcha" />
      </div>
    </main>
  );
}
