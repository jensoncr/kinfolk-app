"use client";

import { useReverification, useUser } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { useState } from "react";
import type { ReactNode } from "react";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import {
  buildExternalAccountCallbackUrl,
  getOAuthErrorMessage,
} from "@/lib/integrations/clerk-oauth";

type Provider = {
  key: string;
  label: string;
  strategy: "oauth_linkedin_oidc" | "oauth_google";
  match: (provider: string) => boolean;
};

const PROVIDERS: Provider[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    strategy: "oauth_linkedin_oidc",
    match: (p) => p.toLowerCase().includes("linkedin"),
  },
  {
    key: "google",
    label: "Google",
    strategy: "oauth_google",
    match: (p) => p.toLowerCase().includes("google"),
  },
];

export function ConnectedAccountsModal({ trigger }: { trigger: ReactNode }) {
  const { isLoaded, user } = useUser();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createExternalAccount = useReverification(async (provider: Provider) => {
    if (!user) {
      throw new Error("Sign in again before connecting an account.");
    }

    return user.createExternalAccount({
      strategy: provider.strategy,
      redirectUrl: buildExternalAccountCallbackUrl({
        origin: window.location.origin,
        pathname: window.location.pathname,
        searchParams: new URLSearchParams(window.location.search),
        hash: window.location.hash,
      }),
      oidcPrompt: provider.key === "linkedin" ? "consent" : undefined,
    });
  });

  const externalAccounts = user?.externalAccounts ?? [];

  const rows = PROVIDERS.map((provider) => {
    const account = externalAccounts.find((a) => provider.match(a.provider));
    return {
      provider,
      account,
      identifier: account?.emailAddress || account?.username || "",
      verified: account?.verification?.status === "verified",
    };
  });

  const connect = async (provider: Provider) => {
    if (!user) return;
    setBusyKey(provider.key);
    setError(null);
    try {
      const account = await createExternalAccount(provider);
      const url = account.verification?.externalVerificationRedirectURL;
      if (url) {
        window.location.assign(url.toString());
        return;
      }

      if (account.verification?.status === "verified") {
        await user.reload();
        return;
      }

      setError(`Couldn't start the ${provider.label} connection. Try again.`);
    } catch (err) {
      if (isReverificationCancelledError(err)) {
        setError(`Connect ${provider.label} was canceled before verification finished.`);
        return;
      }

      setError(getOAuthErrorMessage(err, `Couldn't connect ${provider.label}.`));
    } finally {
      setBusyKey(null);
    }
  };

  const connected = rows.filter((r) => r.account);
  const available = rows.filter((r) => !r.account);

  return (
    <Modal>
      <ModalTrigger asChild>{trigger}</ModalTrigger>
      <ModalContent
        title="Connected accounts"
        description="Sign-in providers linked to your Kinfolk account."
      >
        <div className="-mt-1 space-y-5">
          <section className="space-y-2">
            <p className="pp-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--pp-ink-40)]">
              Connected
            </p>
            {!isLoaded ? (
              <RowSkeleton />
            ) : connected.length === 0 ? (
              <p className="text-[13px] text-[var(--pp-ink-60)]">No providers linked yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {connected.map(({ provider, identifier, verified }) => (
                  <li
                    key={provider.key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--pp-hairline)] bg-[var(--pp-canvas)] px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <ProviderMark provider={provider.key} />
                        <span className="text-[13.5px] font-medium text-[var(--pp-ink)]">
                          {provider.label}
                        </span>
                        {verified ? (
                          <span className="rounded-full bg-[var(--pp-mint-soft)] px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-[0.08em] text-[#205c3e]">
                            Verified
                          </span>
                        ) : null}
                      </div>
                      {identifier ? (
                        <p className="mt-0.5 truncate pl-6 text-[12px] text-[var(--pp-ink-60)]">
                          {identifier}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {available.length > 0 ? (
            <section className="space-y-2 border-t border-[var(--pp-hairline)] pt-4">
              <p className="pp-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--pp-ink-40)]">
                Add account
              </p>
              <div className="space-y-1.5">
                {available.map(({ provider }) => (
                  <button
                    key={provider.key}
                    type="button"
                    disabled={!isLoaded || busyKey === provider.key}
                    onClick={() => connect(provider)}
                    className="kin-focus group flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--pp-hairline)] bg-white px-3.5 py-2.5 text-left transition hover:border-[var(--pp-hairline-strong)] hover:bg-[var(--pp-canvas-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex items-center gap-2">
                      <ProviderMark provider={provider.key} />
                      <span className="text-[13.5px] font-medium text-[var(--pp-ink)]">
                        Connect {provider.label}
                      </span>
                    </span>
                    <span className="text-[11.5px] text-[var(--pp-ink-40)]">
                      {busyKey === provider.key ? "Opening…" : "→"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-[#e7c8c2] bg-[#fbeeea] px-3 py-2 text-[12.5px] leading-snug text-[#7a2f24]">
              {error}
            </p>
          ) : null}
        </div>
      </ModalContent>
    </Modal>
  );
}

function RowSkeleton() {
  return (
    <div className="h-[44px] animate-pulse rounded-xl border border-[var(--pp-hairline)] bg-[var(--pp-canvas)]" />
  );
}

function ProviderMark({ provider }: { provider: string }) {
  if (provider === "google") {
    return (
      <svg aria-hidden="true" viewBox="0 0 18 18" className="size-[14px]">
        <path
          fill="#4285F4"
          d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.614z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        />
      </svg>
    );
  }
  if (provider === "linkedin") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[14px]" fill="#0A66C2">
        <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.37V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.35-1.85 3.58 0 4.24 2.36 4.24 5.43v6.31zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zm1.78 13.02H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z" />
      </svg>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-[14px] place-items-center rounded-sm bg-[var(--pp-canvas-soft)] text-[10px] text-[var(--pp-ink-60)]"
    >
      ?
    </span>
  );
}
