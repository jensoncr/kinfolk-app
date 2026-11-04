import type { ReactNode } from "react";
import Link from "next/link";
import { LandingFooter } from "@/app/(marketing)/_components/landing/landing-footer";
import { LandingHeader } from "@/app/(marketing)/_components/landing/landing-header";

export function LegalPlaceholderPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <LandingHeader />
      <main className="kin-dotted-bg min-h-screen px-5 pb-16 pt-32 text-[var(--ink-900)] sm:px-6 sm:pt-36">
        <article className="mx-auto max-w-2xl rounded-3xl border border-[rgba(28,51,38,0.08)] bg-[#fdfcf8] p-6 shadow-[0_30px_70px_-45px_rgba(14,31,23,0.35)] sm:p-8">
          <p className="mono text-xs uppercase tracking-[0.18em] text-[var(--ink-500)]">
            Kinfolk
          </p>
          <h1 className="serif mt-3 text-4xl leading-tight tracking-[-0.02em]">{title}</h1>
          {children}
          <Link
            className="kin-focus mt-8 inline-flex rounded-full bg-[var(--forest-600)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--forest-700)]"
            href="/"
          >
            Back to home
          </Link>
        </article>
      </main>
      <LandingFooter />
    </>
  );
}
