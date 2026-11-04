import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Home, UsersRound } from "lucide-react";

export const metadata = {
  title: "For landlords",
  description:
    "Kinfolk brings landlords pre-formed renter groups matched to their floor plans — compatible roommates who already fit the space and the budget.",
};

const landlordProofItems = [
  {
    icon: UsersRound,
    label: "Groups arrive pre-formed — matched roommates sized to your floor plans",
  },
  {
    icon: Home,
    label: "Budget-qualified against live rent data before they ever reach you",
  },
  {
    icon: CheckCircle2,
    label: "Two-sided approval before any contact details change hands",
  },
];

export default function LandlordsPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[var(--background)] px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-18rem] -z-10 size-[760px] -translate-x-1/2 rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(38,74,54,0.08) 0%, rgba(248,246,240,0) 70%)",
        }}
      />

      <header className="relative py-6">
        <Link className="kin-focus inline-flex items-center gap-2.5 rounded-full" href="/">
          <span
            className="grid size-8 place-items-center overflow-hidden rounded-lg border border-[rgba(28,51,38,0.08)] bg-[#f8f5ec]"
            style={{ boxShadow: "0 1px 2px rgba(28,51,38,0.08), inset 0 1px 0 rgba(255,255,255,0.5)" }}
          >
            <Image
              alt=""
              className="size-full object-cover"
              height={32}
              src="/assets/kinfolk-logo-mark.png"
              width={32}
            />
          </span>
          <span className="serif text-[18px] font-normal tracking-[-0.01em] text-[var(--ink-900)]">
            Kinfolk
          </span>
        </Link>
      </header>

      <div className="relative flex flex-1 items-center justify-center pb-20">
        <div className="w-full max-w-[26rem] text-center">
          <p className="mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-500)]">
            For landlords and operators.
          </p>
          <h1 className="serif mt-4 text-[2.4rem] leading-[1.05] tracking-[-0.025em] text-[var(--ink-900)]">
            Meet renter groups who <span className="italic text-[var(--sage)]">already fit.</span>
          </h1>
          <p className="mt-4 text-[15px] leading-[1.55] text-[var(--ink-600)]">
            Kinfolk forms roommate groups around real budgets and move-in windows, then matches
            them to units they can actually take together.
          </p>

          <ul className="mx-auto mt-7 flex w-fit flex-col gap-3.5 text-left">
            {landlordProofItems.map((item) => (
              <li className="flex items-center gap-3" key={item.label}>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--mint-100)] text-[var(--forest-600)]">
                  <item.icon aria-hidden="true" size={15} />
                </span>
                <span className="max-w-[24rem] text-[13.5px] font-medium leading-snug text-[var(--ink-700)]">
                  {item.label}
                </span>
              </li>
            ))}
          </ul>

          <Link
            className="kin-focus mt-8 flex w-full items-center justify-center gap-2.5 rounded-full bg-[var(--forest-600)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_12px_28px_-14px_rgba(38,74,54,0.6)] transition-[background,transform] duration-150 hover:bg-[var(--forest-700)] active:scale-[0.98]"
            href="/me"
          >
            <span className="grid size-[19px] place-items-center overflow-hidden rounded-[5px] bg-[#f8f5ec]">
              <Image
                alt=""
                className="size-full object-cover"
                height={19}
                src="/assets/kinfolk-logo-mark.png"
                width={19}
              />
            </span>
            Continue with Kinfolk
          </Link>

          <p className="mx-auto mt-5 max-w-[18rem] text-[12px] leading-relaxed text-[var(--ink-400)]">
            By continuing you agree to our{" "}
            <Link className="underline underline-offset-2 hover:text-[var(--ink-600)]" href="/terms">
              Terms
            </Link>{" "}
            and{" "}
            <Link
              className="underline underline-offset-2 hover:text-[var(--ink-600)]"
              href="/privacy"
            >
              Privacy
            </Link>
            .
          </p>

          <div className="mt-9 border-t border-[rgba(28,51,38,0.08)] pt-6">
            <Link
              className="kin-focus group inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium text-[var(--ink-500)] transition-colors hover:text-[var(--ink-900)]"
              href="/"
            >
              Looking for a place to live? For renters
              <ArrowRight
                aria-hidden="true"
                className="transition-transform duration-200 group-hover:translate-x-0.5"
                size={14}
                strokeWidth={2.4}
              />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
