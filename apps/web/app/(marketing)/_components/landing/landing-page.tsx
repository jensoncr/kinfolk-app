import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AgentConversation } from "@/app/(marketing)/_components/landing/agent-conversation";
import { LandingFooter } from "@/app/(marketing)/_components/landing/landing-footer";
import { LandingHeader } from "@/app/(marketing)/_components/landing/landing-header";
import { RevealCard, RevealSlide, Resolve } from "@/app/(marketing)/_components/landing/landing-motion";
import { SkyBirds } from "@/app/(marketing)/_components/landing/sky-birds";

const trustItems = ["Move in 4-12 weeks", "Two-sided approval", "Anonymous until you say"];

// Official marks, rendered monochrome; the marquee loops them full-width.
const worksWithLogos = [
  { alt: "AppFolio", height: 22, src: "/landing/logos/logo-appfolio.svg" },
  { alt: "Yardi", height: 19, src: "/landing/logos/logo-yardi.svg" },
  { alt: "Buildium", height: 30, src: "/landing/logos/logo-buildium.svg" },
  { alt: "RealPage", height: 19, src: "/landing/logos/logo-realpage.svg" },
  { alt: "DoorLoop", height: 22, src: "/landing/logos/logo-doorloop.svg" },
  { alt: "Compass", height: 17, src: "/landing/logos/logo-compass.svg" },
  { alt: "Equity Residential", height: 30, src: "/landing/logos/logo-equity.svg" },
  { alt: "Essex Property Trust", height: 26, src: "/landing/logos/logo-essex.svg" },
  { alt: "Veritas Investments", height: 24, src: "/landing/logos/logo-veritas.png" },
];

function LogoRow({ hidden = false }: { hidden?: boolean }) {
  return (
    <div
      aria-hidden={hidden || undefined}
      className="flex shrink-0 items-center gap-x-14 pr-14 lg:gap-x-16 lg:pr-16"
    >
      {worksWithLogos.map((logo) => (
        // eslint-disable-next-line @next/next/no-img-element -- decorative brand SVGs with per-logo intrinsic sizing
        <img
          alt={hidden ? "" : logo.alt}
          className="w-auto max-w-none opacity-[0.66] [filter:grayscale(1)_brightness(0.38)]"
          key={logo.alt}
          src={logo.src}
          style={{ height: logo.height }}
        />
      ))}
    </div>
  );
}

export function LandingPage() {
  return (
    <>
      <LandingHeader />
      <main>
        <HeroSection />
        <AgentConversation />
        <StatementBand />
        <HowItWorks />
        <FaqSection />
      </main>
      <LandingFooter />
    </>
  );
}

function HeroSection() {
  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden pb-36 pt-24 text-center sm:pb-44 sm:pt-32">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-20 select-none">
        <Image
          alt=""
          className="object-cover object-bottom"
          fill
          priority
          sizes="100vw"
          src="/landing/hero-sky.jpg"
        />
        {/* cream veil keeps the ink type at full contrast over the photo */}
        <div className="absolute inset-0 bg-[rgba(248,246,240,0.30)]" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-52 left-1/2 -z-10 size-[800px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(38,74,54,0.08) 0%, rgba(248,246,240,0) 70%)",
        }}
      />
      <SkyBirds />
      <div className="page-shell relative z-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="serif text-[clamp(2rem,8.7vw,2.5rem)] font-semibold leading-[1] tracking-[-0.028em] text-[var(--ink-900)] sm:text-[clamp(2.5rem,7vw,5.25rem)]">
            <Resolve as="span" className="inline-block" delay={0.13}>
              Matching changes
            </Resolve>
            <br />
            <Resolve
              as="span"
              className="inline-block italic font-medium text-[var(--sage)]"
              delay={0.24}
            >
              which doors are open.
            </Resolve>
          </h1>

          <Resolve
            as="p"
            className="mx-auto mt-5 max-w-[40rem] text-[1.0625rem] leading-[1.55] text-[var(--ink-600)] sm:text-[1.125rem]"
            delay={0.33}
          >
            Kinfolk understands you and your network, matches you with compatible roommates, and
            finds the apartment your group can afford together. Ambient across SMS, quiet until it
            has something worth your time.
          </Resolve>

          <Resolve className="mt-8 flex justify-center" delay={0.42}>
            <Link className="shiny-cta kin-focus" href="/me">
              <span className="shiny-cta-inner">
                Talk to Kinfolk
                <ArrowRight aria-hidden="true" className="shiny-cta-arrow" strokeWidth={2.4} />
              </span>
            </Link>
          </Resolve>

          <Resolve
            className="mt-6 flex flex-col items-center gap-y-1.5 text-sm text-[var(--ink-600)] sm:flex-row sm:justify-center sm:gap-x-3"
            delay={0.5}
          >
            {trustItems.map((label, index) => (
              <span className="inline-flex items-center gap-x-3" key={label}>
                {/* separator only when the items sit on one line (sm+) */}
                {index > 0 && (
                  <span aria-hidden="true" className="hidden sm:inline">
                    ·
                  </span>
                )}
                {label}
              </span>
            ))}
          </Resolve>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 bg-[linear-gradient(to_top,rgba(248,245,238,0.94)_0%,rgba(248,245,238,0.78)_55%,rgba(248,245,238,0)_100%)] pb-6 pt-10">
        <div className="page-shell">
          <p className="mono text-left text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-600)]">
            Compatible with
          </p>
        </div>
        <div
          className="mt-3.5 flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]"
        >
          <div className="flex w-max animate-[kin-marquee_45s_linear_infinite] motion-reduce:animate-none">
            <LogoRow />
            <LogoRow hidden />
          </div>
        </div>
      </div>
    </section>
  );
}

function StatementBand() {
  // TODO(founder): when real social proof exists (a formed group's quote +
  // "N groups formed · N cities"), it belongs in a strip under this band.
  // Do NOT ship fabricated numbers or quotes.
  return (
    <section className="bg-[var(--forest-900)] py-20 md:py-28">
      <div className="page-shell">
        <RevealSlide from="up">
          <h2 className="serif max-w-3xl text-balance text-[clamp(1.875rem,4.6vw,3.25rem)] font-semibold leading-[1.12] tracking-[-0.02em]">
            <span className="text-[#f3f0e7]/70">Alone, you rent what’s left.</span>{" "}
            <span className="text-[#f3f0e7]">Together, you choose.</span>
          </h2>
        </RevealSlide>
      </div>
    </section>
  );
}

const faqItems = [
  {
    q: "Is Kinfolk free?",
    a: "Getting matched is free. You tell Kinfolk what you're looking for, it finds your group and a place you can split — there's no Kinfolk fee to do that.",
  },
  {
    q: "Are these real apartments?",
    a: "Yes. Kinfolk pulls from real listings with live rent estimates, and only surfaces units your group can actually afford together.",
  },
  {
    q: "How do you keep me safe with people I just met?",
    a: "You stay anonymous — name, photo, and number hidden — until you and a match both say yes. Nothing is ever shared one-sidedly, and matching is grounded in your real identity and the people you already know in common, not anonymous profiles.",
  },
  {
    q: "Which cities is Kinfolk in?",
    a: "Kinfolk is live in San Francisco today and rolling out one metro at a time after that. Tell it where you're looking and it'll say whether matching is open near you yet.",
  },
];

function FaqSection() {
  return (
    <section className="bg-[var(--background)] py-16 md:py-20" id="faq">
      <div className="page-shell">
        <RevealSlide from="up">
          <p className="text-[13px] font-medium text-[var(--ink-600)]">Questions</p>
          <h2 className="serif mt-3 max-w-2xl text-[clamp(2rem,4vw,3rem)] font-normal leading-[1.05] tracking-[-0.02em] text-[var(--ink-900)]">
            The honest answers.
          </h2>
        </RevealSlide>
        <dl className="mt-10 grid gap-x-12 gap-y-8 md:mt-12 md:grid-cols-2 md:gap-y-10">
          {faqItems.map((item) => (
            <RevealCard as="div" key={item.q}>
              <dt className="serif text-xl text-[var(--ink-900)]">{item.q}</dt>
              <dd className="mt-2 text-[0.95rem] leading-[1.6] text-[var(--ink-600)]">{item.a}</dd>
            </RevealCard>
          ))}
        </dl>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      className="relative scroll-mt-20 overflow-hidden bg-[linear-gradient(180deg,var(--background)_0%,#f1efe6_100%)] py-16 md:py-28"
      id="how-it-works"
    >
      <div className="page-shell">
        <RevealSlide from="up">
          <div className="max-w-3xl">
            <p className="text-[13px] font-medium text-[var(--ink-600)]">How it works</p>
            <h2 className="serif mt-3 text-balance text-[clamp(2rem,4.6vw,3rem)] font-normal leading-[1.08] tracking-[-0.02em] text-[var(--ink-900)]">
              From first text to signed lease.
            </h2>
            <p className="mt-4 max-w-[42rem] text-[1.0625rem] leading-[1.6] text-[var(--ink-600)]">
              Kinfolk runs the search end to end. You approve the people and the place.
            </p>
          </div>
        </RevealSlide>

        <div className="mt-12 grid gap-12 md:mt-16 md:grid-cols-3 md:gap-8">
          <StepColumn
            body="Budget, neighborhoods, how you live — a few texts is enough. Kinfolk keeps your profile current from there."
            digit="01"
            index={0}
            title="Text Kinfolk what you're looking for"
            visual={
              <ChatPanel
                messages={[
                  { from: "you", text: "Rincon Hill or SoMa, ~$2.4k each, mid-October." },
                  { from: "kin", text: "Saved. I’ll text you when something fits." },
                ]}
              />
            }
          />
          <StepColumn
            body="When someone fits your neighborhoods, budget, and rhythm, Kinfolk introduces you with the reasoning."
            digit="02"
            index={1}
            title="Meet roommates who fit"
            visual={
              <ChatPanel
                messages={[
                  { from: "kin", text: "Met Maya — Rincon Hill, same window. Connect?" },
                  { from: "you", text: "yes" },
                  { from: "kin", text: "She approved you back." },
                ]}
              />
            }
          />
          <StepColumn
            body="Splitting rent puts better apartments in reach. Kinfolk lines up the tour, the split, and the lease."
            digit="03"
            index={2}
            title="Lease a place you can split"
            visual={
              <ChatPanel
                messages={[
                  { from: "kin", text: "399 Fremont, 2-bed — $2,400 each with Maya. Tour Thursday at 11?" },
                  { from: "you", text: "Book it." },
                ]}
              />
            }
          />
        </div>
      </div>
    </section>
  );
}

function StepColumn({
  body,
  digit,
  index,
  title,
  visual,
}: {
  body: string;
  digit: string;
  index: number;
  title: string;
  visual: React.ReactNode;
}) {
  return (
    <RevealSlide className="flex h-full flex-col" delay={index * 0.1} from="up">
      <p className="mono border-t border-[rgba(28,51,38,0.16)] pt-5 text-[13px] font-medium text-[var(--forest-600)]">
        {digit}
      </p>
      <h3 className="mt-3 text-[1.0625rem] font-semibold leading-snug text-[var(--ink-900)]">
        {title}
      </h3>
      <p className="mt-2 max-w-[44ch] text-[0.9375rem] leading-[1.6] text-[var(--ink-600)]">
        {body}
      </p>
      <div className="mt-auto w-full max-w-[19rem] pt-7">{visual}</div>
    </RevealSlide>
  );
}

type ChatMessage = { from: "kin" | "you"; text: string };

/**
 * The one visual species used for step evidence: the product's own surface,
 * an SMS thread. Three panels read left-to-right as one conversation.
 */
function ChatPanel({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="kin-card flex min-h-[178px] flex-col justify-end gap-2 p-4">
      {messages.map((message) => (
        <div
          className={`flex ${message.from === "you" ? "justify-end" : "justify-start"}`}
          key={message.text}
        >
          <p
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-[1.45] ${
              message.from === "you"
                ? "rounded-br bg-[var(--forest-800)] text-[#f3f0e7]"
                : "rounded-bl bg-[var(--bg-soft)] text-[var(--ink-800)]"
            }`}
          >
            {message.text}
          </p>
        </div>
      ))}
    </div>
  );
}

