import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LandingHeader } from "@/app/(marketing)/_components/landing/landing-header";
import { LandingFooter } from "@/app/(marketing)/_components/landing/landing-footer";

export const metadata = {
  title: "How Kinfolk works",
  description:
    "From “what’s your LinkedIn?” to a forming group — how Kinfolk matches you with roommates and an apartment you can afford together, across web and iMessage.",
};

type Step = {
  n: number;
  kicker: string;
  title: string;
  body: ReactNode;
  src: string;
  alt: string;
  width: number;
  height: number;
  device: "web" | "phone";
};

const steps: Step[] = [
  {
    n: 1,
    kicker: "Onboard",
    title: "What’s your LinkedIn?",
    body: (
      <>
        One tap to sign in. <strong>Your identity stays hidden</strong> until both sides approve —
        Kinfolk shares only context.
      </>
    ),
    src: "/assets/flow/1.png",
    alt: "Welcome to Kinfolk — continue with LinkedIn",
    width: 1341,
    height: 738,
    device: "web",
  },
  {
    n: 2,
    kicker: "Your hub",
    title: "Hey Jenson.",
    body: (
      <>
        Profile ready, <strong>80 matches already in review.</strong> Browse on the web, or scan to
        continue on your phone.
      </>
    ),
    src: "/assets/flow/2.png",
    alt: "Kinfolk dashboard — your rent hub at a glance",
    width: 1303,
    height: 627,
    device: "web",
  },
  {
    n: 3,
    kicker: "Verify & enrich",
    title: "A few quick questions.",
    body: (
      <>
        Text <strong>KIN VERIFY</strong> and the agent learns the rest — neighborhoods, budget — the
        read no form catches.
      </>
    ),
    src: "/assets/flow/3.png",
    alt: "iMessage — Kinfolk asks your neighborhoods and budget",
    width: 902,
    height: 410,
    device: "web",
  },
  {
    n: 4,
    kicker: "Matches come to you",
    title: "New match, texted.",
    body: (
      <>
        A fit lands in iMessage — photo, <strong>per-person rent, and a % fit.</strong> No dashboard
        refresh required.
      </>
    ),
    src: "/assets/flow/4.png",
    alt: "iMessage — new apartment match in Forest Knolls",
    width: 828,
    height: 1792,
    device: "phone",
  },
  {
    n: 5,
    kicker: "Ask for the real story",
    title: "Tell me more.",
    body: (
      <>
        Comps, square footage, pet policy — even <strong>open building complaints on file.</strong>{" "}
        Just ask in the thread.
      </>
    ),
    src: "/assets/flow/5.png",
    alt: "iMessage — deep detail on the Valencia Street unit",
    width: 828,
    height: 1792,
    device: "phone",
  },
  {
    n: 6,
    kicker: "Form the group",
    title: "1 spot left.",
    body: (
      <>
        Per-person rent, the split, a forming group — <strong>join it or request a tour</strong>,
        back on the web.
      </>
    ),
    src: "/assets/flow/6.png",
    alt: "Apartment detail — join a forming group on Kinfolk",
    width: 1915,
    height: 1337,
    device: "web",
  },
];

const DOTS = ["#e2685c", "#e7b14c", "#5fb86b"];

function StepMedia({ step }: { step: Step }) {
  const imagePriority = step.n === 1;

  if (step.device === "phone") {
    return (
      <div className="w-full max-w-[296px] rounded-[34px] bg-[#0a0d0b] p-[9px] shadow-[0_2px_2px_rgba(255,255,255,0.12)_inset,0_44px_74px_-44px_rgba(0,0,0,0.7)]">
        <div className="overflow-hidden rounded-[26px] bg-white">
          <Image
            src={step.src}
            alt={step.alt}
            width={step.width}
            height={step.height}
            sizes="296px"
            className="block h-auto w-full"
            priority={imagePriority}
          />
        </div>
      </div>
    );
  }
  return (
    <figure className="w-full max-w-[720px] overflow-hidden rounded-[14px] border border-[rgba(28,51,38,0.16)] bg-white shadow-[0_2px_4px_rgba(28,51,38,0.05),0_40px_70px_-46px_rgba(14,31,23,0.5)]">
      <div className="flex h-[34px] items-center gap-[7px] border-b border-[rgba(28,51,38,0.08)] bg-[#e7e2d6] px-3.5">
        {DOTS.map((color) => (
          <span key={color} className="size-[11px] rounded-full" style={{ background: color }} />
        ))}
      </div>
      <Image
        src={step.src}
        alt={step.alt}
        width={step.width}
        height={step.height}
        sizes="(max-width: 720px) 100vw, 720px"
        className="block h-auto w-full"
        priority={imagePriority}
      />
    </figure>
  );
}

export default function HowItWorksPage() {
  return (
    <>
      <LandingHeader />
      <main className="kin-dotted-bg min-h-screen pb-16 pt-32 sm:pt-36">
        <div className="mx-auto w-[min(100%-2.75rem,1000px)]">
          <header className="text-center">
            <p className="mono text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--ink-500)]">
              How it works
            </p>
            <h1 className="serif mx-auto mt-4 max-w-[18ch] text-[clamp(2.1rem,6vw,3.4rem)] font-normal leading-[1.02] tracking-[-0.028em] text-[var(--ink-900)]">
              From <em className="italic text-[var(--sage)]">“what’s your LinkedIn?”</em> to a
              forming group.
            </h1>
            <p className="mx-auto mt-4 max-w-[50ch] text-[15.5px] leading-[1.55] text-[var(--ink-600)]">
              One agent across web and iMessage. You answer a few things; compatible roommates and an
              apartment your group can afford surface with the reasoning attached.
            </p>
          </header>

          <div className="mt-6">
            {steps.map((step, index) => {
              const reverse = index % 2 === 1;
              return (
              <div key={step.n}>
                <section className="flex flex-col items-center gap-5 text-center md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-center md:gap-10 md:text-left">
                  <div className={`max-w-[54ch] ${reverse ? "md:order-2" : ""}`}>
                    <div className="inline-flex items-center gap-[9px]">
                      <span className="mono grid size-[30px] place-items-center rounded-full bg-[var(--forest-600)] text-[13px] font-semibold text-white">
                        {step.n}
                      </span>
                      <span className="mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-500)]">
                        {step.kicker}
                      </span>
                    </div>
                    <h2 className="serif mt-3.5 text-[clamp(1.5rem,3.4vw,2rem)] font-normal leading-[1.05] tracking-[-0.02em] text-[var(--ink-900)]">
                      {step.title}
                    </h2>
                    <p className="mt-2.5 text-[14.5px] leading-[1.55] text-[var(--ink-600)] [&_strong]:font-semibold [&_strong]:text-[var(--forest-700)]">
                      {step.body}
                    </p>
                  </div>
                  <div className={`flex w-full justify-center ${reverse ? "md:order-1" : ""}`}>
                    <StepMedia step={step} />
                  </div>
                </section>
                {index < steps.length - 1 ? (
                  <div className="flex justify-center py-[18px]" aria-hidden="true">
                    <span
                      className="h-[46px] w-0.5"
                      style={{
                        background:
                          "repeating-linear-gradient(180deg,rgba(28,51,38,0.16) 0 6px,transparent 6px 13px)",
                      }}
                    />
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>

          <div className="mt-10 border-t border-[rgba(28,51,38,0.08)] pt-9 text-center">
            <p className="serif mx-auto max-w-[46ch] text-[16px] italic leading-[1.5] text-[var(--ink-600)]">
              Onboard, enrich, match, decide. Quiet until it has something worth your time.
            </p>
            <Link
              className="kin-focus mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--forest-600)] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_12px_28px_-14px_rgba(38,74,54,0.6)] transition hover:bg-[var(--forest-700)]"
              href="/me"
            >
              Talk to Kinfolk
              <ArrowRight aria-hidden="true" size={16} strokeWidth={2.4} />
            </Link>
          </div>
        </div>
      </main>
      <LandingFooter />
    </>
  );
}
