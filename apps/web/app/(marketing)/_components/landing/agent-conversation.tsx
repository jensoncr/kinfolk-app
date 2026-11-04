"use client";

import { ChevronLeft, Mic, Plus, Video } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "motion/react";

/**
 * The agent story: a LinkedIn sign-in screen, then an iMessage thread where
 * you verify, answer a couple of questions, and Kinfolk texts back real
 * apartment matches. Modeled 1:1 on the live product (flow/1 sign-in screen,
 * flow/4 listing-card text) so nothing here over-promises.
 *
 * The whole timeline is driven off a single integer `step`, and exactly one
 * scene is rendered at a time (AnimatePresence) — so the sign-in card and the
 * phone never stack on top of each other. What advances `step` differs by
 * device: on desktop the section is tall, the stage is pinned, and scroll
 * scrubs the story; on mobile the stage sits in normal flow and the story
 * autoplays on a timer once it scrolls into view. Scroll-scrubbing a pinned
 * stage is unusable on iOS — collapsing the URL bar resizes the viewport
 * mid-scroll, which re-maps scroll progress and makes the steps jitter.
 */

type Beat =
  | { kind: "out" | "in"; text: string }
  | {
      kind: "listing";
      neighborhood: string;
      address: string;
      specs: string;
      price: string;
      priceUnit: string;
      fit: number;
    }
  | { kind: "roommate"; name: string; initial: string; match: number; tags: string[] }
  | { kind: "group"; unit: string; price: string; note: string };

const BEATS: Beat[] = [
  { kind: "out", text: "KIN VERIFY Z3K8HQ" },
  {
    kind: "in",
    text: "You’re connected. A few quick questions so the matches actually fit — say SKIP to any of them.",
  },
  { kind: "in", text: "Which SF neighborhoods are you drawn to? A few names is perfect." },
  { kind: "out", text: "Rincon Hill, SoMa, or the Mission." },
  { kind: "in", text: "Got those saved. What’s your budget for your own share of the rent?" },
  { kind: "out", text: "Around $2,500 — I’d rather split a great place than go solo." },
  { kind: "in", text: "Smart. Here’s what’s open in Rincon Hill right now —" },
  {
    kind: "listing",
    neighborhood: "Rincon Hill",
    address: "399 Fremont St",
    specs: "Studio · available now",
    price: "$4,182",
    priceUnit: "/mo",
    fit: 92,
  },
  { kind: "in", text: "Solo, that’s over your number. But you don’t have to go it alone —" },
  {
    kind: "roommate",
    name: "Maya",
    initial: "M",
    match: 94,
    tags: ["Same neighborhoods", "~$2,400 budget", "Quiet weeknights"],
  },
  { kind: "in", text: "You two could split a 2-bed in the same building." },
  {
    kind: "group",
    unit: "2-bed in Rincon Hill",
    price: "$2,400 each",
    note: "Neither of you could take it solo.",
  },
  { kind: "out", text: "Yes — introduce us 🙌" },
  { kind: "in", text: "On it. Nothing’s shared until you both say yes." },
];

const TOTAL = BEATS.length;
// 0: sign-in idle · 1: sign-in clicked · 2..: phone with (step-1) messages · +1 tail
const STEPS = TOTAL + 3;

export function AgentConversation() {
  const reduce = useReducedMotion();

  if (reduce) {
    return (
      <section className="bg-[var(--background)] py-20" id="how-kinfolk-works">
        <div className="page-shell flex flex-col items-center">
          <Caption eyebrow="How Kinfolk works" title="It all happens over text." />
          <div className="mt-10">
            <PhoneFrame>
              <MessageList count={TOTAL} animate={false} />
            </PhoneFrame>
          </div>
        </div>
      </section>
    );
  }

  return <AgentStory />;
}

/**
 * Both breakpoints pin the stage and let scroll scrub the story, Pluto-style.
 * Progress is deliberately NOT useScroll's viewport-relative offsets: on iOS
 * the URL-bar collapse changes window.innerHeight mid-gesture, and any mapping
 * that involves it re-targets progress and makes the steps jitter (this is why
 * mobile used to autoplay instead). scrollY, offsetHeight, and
 * getBoundingClientRect all live in the fixed layout viewport, so a mapping
 * built only from those pixel values stays stable while the URL bar animates.
 * The section heights are static CSS at every width, so server markup keeps
 * the right document height under a restored scroll position (the header hit
 * this exact hydration bug class; see landing-header.tsx). The reduced-motion
 * branch above still swaps to the shorter static section at hydration — a
 * pre-existing, narrower instance of the same class.
 */
function AgentStory() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const [step, setStep] = useState(0);

  useMotionValueEvent(scrollY, "change", (y) => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!section || !stage) return;
    const top = section.getBoundingClientRect().top + y;
    const scrubLength = Math.max(1, section.offsetHeight - stage.offsetHeight);
    const next = Math.max(
      0,
      Math.min(STEPS - 1, Math.floor(((y - top) / scrubLength) * STEPS)),
    );
    setStep((prev) => (prev === next ? prev : next));
  });

  return (
    <section
      ref={sectionRef}
      className="relative h-[350svh] bg-[var(--background)] md:h-[340vh]"
      id="how-kinfolk-works"
      aria-label="How Kinfolk works: sign in, then text"
    >
      {/* pt keeps the caption clear of the floating sticky header, which
          otherwise overlaps it at 100svh. */}
      <div
        className="sticky top-0 flex h-[100svh] flex-col items-center justify-center overflow-hidden pt-16"
        ref={stageRef}
      >
        <StoryStage step={step} />
      </div>
    </section>
  );
}

function StoryStage({ step }: { step: number }) {
  const scene: "signin" | "phone" = step < 2 ? "signin" : "phone";
  const clicked = step >= 1;
  const messageCount = Math.max(0, Math.min(TOTAL, step - 1));

  return (
    <div className="page-shell flex w-full flex-col items-center">
      <div className="relative h-[4.75rem] w-full">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="absolute inset-x-0 top-0"
            exit={{ opacity: 0, y: -6 }}
            initial={{ opacity: 0, y: 6 }}
            key={scene}
            transition={{ duration: 0.3 }}
          >
            {scene === "signin" ? (
              <Caption eyebrow="Step one" title="Sign in once with LinkedIn." />
            ) : (
              <Caption eyebrow="Then that’s it" title="Just text Kinfolk like a friend." />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="relative mt-5 grid place-items-center">
        <AnimatePresence initial={false} mode="popLayout">
          {scene === "signin" ? (
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="col-start-1 row-start-1 w-[clamp(280px,86vw,340px)]"
              exit={{ opacity: 0, scale: 0.93, y: -24 }}
              initial={{ opacity: 0, scale: 0.97 }}
              key="signin"
              transition={{ duration: 0.4 }}
            >
              <SigninCard clicked={clicked} />
            </motion.div>
          ) : (
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="col-start-1 row-start-1"
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              initial={{ opacity: 0, scale: 0.93, y: 60 }}
              key="phone"
              transition={{ type: "spring", bounce: 0.18, duration: 0.6 }}
            >
              <PhoneFrame>
                <MessageList count={messageCount} animate />
              </PhoneFrame>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Caption({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center">
      <p className="text-[13px] font-medium text-[var(--ink-600)]">{eyebrow}</p>
      <h2 className="serif mt-2 text-[clamp(1.5rem,3.4vw,2.25rem)] font-normal leading-tight tracking-[-0.02em] text-[var(--ink-900)]">
        {title}
      </h2>
    </div>
  );
}

/* ---------- Phone ---------- */

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative h-[min(72svh,640px)] md:h-[min(78svh,780px)]"
      style={{ aspectRatio: "452 / 932" }}
    >
      {/* screen content, masked into the bezel cutout (frame image sits on top) */}
      <div
        className="absolute flex flex-col overflow-hidden bg-white"
        style={{
          left: "4.2%",
          top: "1.7%",
          width: "91.6%",
          height: "96.6%",
          borderRadius: "8% / 3.7%",
        }}
      >
        {/* status bar */}
        <div className="relative flex items-center justify-between px-7 pt-3 text-[12px] font-semibold text-[#0b0b0c]">
          <span>9:41</span>
          <div className="pointer-events-none absolute left-1/2 top-[9px] h-[22px] w-[78px] -translate-x-1/2 rounded-full bg-[#0b0b0c]" />
          <span className="flex items-center gap-1">
            <SignalDots />
            <WifiGlyph />
            <BatteryGlyph />
          </span>
        </div>

        {/* contact header */}
        <div className="flex items-center justify-between border-b border-black/[0.06] px-4 pb-2 pt-2.5">
          <ChevronLeft className="text-[#1f88fe]" size={22} strokeWidth={2.5} aria-hidden="true" />
          <div className="flex flex-col items-center gap-1">
            <span className="grid size-9 place-items-center overflow-hidden rounded-full ring-1 ring-black/5">
              <Image
                alt="Kinfolk"
                className="size-full object-cover"
                height={36}
                src="/assets/kinfolk-contact-logo.png"
                width={36}
              />
            </span>
            <span className="text-[12px] font-semibold leading-none text-[#0b0b0c]">
              Kinfolk ›
            </span>
          </div>
          <Video className="text-[#1f88fe]" size={22} strokeWidth={2} aria-hidden="true" />
        </div>

        {/* thread */}
        <div className="flex flex-1 flex-col justify-end gap-1.5 overflow-hidden px-3.5 pb-2 pt-3">
          {children}
        </div>

        {/* input bar */}
        <div className="flex items-center gap-2 px-3 pb-3 pt-1.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-black/[0.06] text-[#0b0b0c]">
            <Plus size={18} aria-hidden="true" />
          </span>
          <span className="flex h-8 flex-1 items-center justify-between rounded-full border border-black/10 pl-3.5 pr-2 text-[13px] text-[#a8a8ad]">
            iMessage
            <Mic size={15} aria-hidden="true" />
          </span>
        </div>
      </div>

      {/* iPhone bezel — layered above the screen so its edges mask the content */}
      <Image
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 h-full w-full select-none object-contain"
        draggable={false}
        fill
        priority
        sizes="(max-width: 768px) 90vw, 420px"
        src="/assets/iphone-frame.png"
        style={{ filter: "drop-shadow(0 40px 70px rgba(14,31,23,0.4))" }}
      />
    </div>
  );
}

function MessageList({ count, animate }: { count: number; animate: boolean }) {
  return (
    <>
      <p className="pb-1 text-center text-[10px] font-medium text-[#aeaeb2]">
        iMessage · Today 9:41 AM
      </p>
      {BEATS.slice(0, count).map((beat, i) => (
        <motion.div
          className={beat.kind === "out" ? "flex justify-end" : "flex flex-col items-start"}
          layout={animate}
          {...(animate
            ? {
                initial: { opacity: 0, y: 10, scale: 0.92 },
                animate: { opacity: 1, y: 0, scale: 1 },
                transition: { type: "spring", bounce: 0.3, duration: 0.5 },
              }
            : {})}
          key={`${beat.kind}-${i}`}
        >
          {beat.kind === "listing" ? (
            <ListingCard beat={beat} />
          ) : beat.kind === "roommate" ? (
            <RoommateCard beat={beat} />
          ) : beat.kind === "group" ? (
            <GroupCard beat={beat} />
          ) : (
            <span
              className={
                beat.kind === "out"
                  ? "max-w-[78%] rounded-[18px] rounded-br-[5px] bg-[#1f88fe] px-3 py-2 text-[13.5px] leading-snug text-white"
                  : "max-w-[80%] rounded-[18px] rounded-bl-[5px] bg-[#e9e9eb] px-3 py-2 text-[13.5px] leading-snug text-[#0b0b0c]"
              }
            >
              {beat.text}
            </span>
          )}
        </motion.div>
      ))}
    </>
  );
}

function ListingCard({ beat }: { beat: Extract<Beat, { kind: "listing" }> }) {
  return (
    <div className="w-[92%] overflow-hidden md:w-[82%]">
      <div className="relative aspect-[5/4] w-full overflow-hidden rounded-[16px] bg-[#e9e9eb]">
        <Image
          alt=""
          className="object-cover"
          fill
          sizes="240px"
          src="/assets/listings/rincon-hill-399-fremont.jpg"
          style={{ objectPosition: "center 58%" }}
        />
        <span className="absolute bottom-2 right-2 rounded-md bg-[var(--mint-100)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--forest-700)] shadow-sm">
          {beat.fit}%
        </span>
      </div>
      <span className="mt-1 block rounded-[18px] rounded-bl-[5px] bg-[#e9e9eb] px-3 py-2 text-[13px] leading-snug text-[#0b0b0c]">
        <span className="font-semibold">
          {beat.address} · {beat.neighborhood}
        </span>
        <br />
        {beat.specs}
        <br />
        <span className="font-semibold">{beat.price}</span>
        {beat.priceUnit} · {beat.fit}% fit for you
      </span>
    </div>
  );
}

function RoommateCard({ beat }: { beat: Extract<Beat, { kind: "roommate" }> }) {
  return (
    <div className="w-[92%] rounded-[18px] rounded-bl-[5px] bg-[#e9e9eb] p-3 md:w-[82%]">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--forest-800)] text-sm font-semibold text-[#f3f0e7]">
          {beat.initial}
        </span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight text-[#0b0b0c]">
          {beat.name}
        </p>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--forest-700)]">
          {beat.match}%
        </span>
      </div>
      {/* full-width so it wraps instead of squeezing beside the badge on the
          narrow mobile phone */}
      <p className="mt-1.5 text-[11px] leading-snug text-[#76767b]">
        Roommate match · anonymous until you both say yes
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {beat.tags.map((tag) => (
          <span className="rounded-full bg-white px-2 py-[3px] text-[11px] text-[#46464a]" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function GroupCard({ beat }: { beat: Extract<Beat, { kind: "group" }> }) {
  return (
    <div className="w-[92%] rounded-[18px] rounded-bl-[5px] bg-[#e9e9eb] p-3.5 text-[#0b0b0c] md:w-[82%]">
      <p className="mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--forest-700)]">
        Group forming
      </p>
      <div className="mt-2 flex items-center gap-2.5">
        <span className="flex -space-x-2">
          <span className="grid size-7 place-items-center rounded-full bg-[var(--forest-800)] text-[10px] font-bold text-[#f3f0e7] ring-2 ring-[#e9e9eb]">
            Y
          </span>
          <span className="grid size-7 place-items-center rounded-full bg-[#c08a3e] text-[11px] font-bold text-white ring-2 ring-[#e9e9eb]">
            M
          </span>
        </span>
        <p className="text-[13px] font-semibold">{beat.unit}</p>
      </div>
      <p className="mt-2.5 text-[22px] font-semibold leading-none text-[var(--forest-800)]">
        {beat.price}
      </p>
      <p className="mt-1.5 text-[12px] leading-snug text-[#5b5b60]">{beat.note}</p>
    </div>
  );
}

/* ---------- Sign-in (Phase 1) ---------- */

function SigninCard({ clicked }: { clicked: boolean }) {
  return (
    <div
      className="relative overflow-hidden rounded-[28px] border border-black/[0.06] bg-[var(--background)] px-7 pb-8 pt-9 text-center shadow-[0_50px_120px_-50px_rgba(14,31,23,0.5)]"
      style={{
        backgroundImage: "radial-gradient(rgba(28,51,38,0.06) 1px, transparent 1px)",
        backgroundSize: "18px 18px",
      }}
    >
      <span className="mx-auto grid size-12 place-items-center">
        <Image
          alt="Kinfolk"
          className="size-full object-contain"
          height={48}
          src="/assets/kinfolk-logo-mark.png"
          width={48}
        />
      </span>
      <h3 className="serif mt-4 text-[1.7rem] leading-none tracking-[-0.02em] text-[var(--ink-900)]">
        Welcome to Kinfolk.
      </h3>
      <p className="serif mt-1 text-[1.3rem] italic leading-tight text-[var(--sage)]">
        What’s your LinkedIn?
      </p>
      <div className="relative mt-6">
        <motion.div
          animate={{ scale: clicked ? 0.96 : 1 }}
          className="relative flex w-full items-center justify-center gap-2.5 rounded-full bg-[var(--forest-900)] px-5 py-3.5 text-sm font-semibold text-[#f3f0e7]"
          transition={{ duration: 0.18 }}
        >
          <motion.span
            animate={{ opacity: clicked ? 0 : 1 }}
            className="flex items-center gap-2.5"
            transition={{ duration: 0.15 }}
          >
            <Image
              alt=""
              className="rounded-[3px]"
              height={18}
              src="/assets/LinkedIn_icon.svg.png"
              width={18}
            />
            Continue with LinkedIn
          </motion.span>
          <motion.span
            animate={{ opacity: clicked ? 1 : 0 }}
            className="absolute inset-0 flex items-center justify-center gap-2.5"
            transition={{ duration: 0.15 }}
          >
            <span className="size-3.5 animate-spin rounded-full border-2 border-[#f3f0e7]/40 border-t-[#f3f0e7]" />
            Connecting…
          </motion.span>
        </motion.div>
        <motion.div
          animate={{ x: clicked ? 0 : 64, y: clicked ? 0 : 40, opacity: 1 }}
          className="pointer-events-none absolute left-1/2 top-1/2"
          initial={false}
          transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
        >
          <Cursor />
        </motion.div>
      </div>
      <p className="mt-3 text-[13px] font-medium text-[var(--ink-500)] underline underline-offset-2">
        I don’t have LinkedIn
      </p>
      <p className="mx-auto mt-5 max-w-[16rem] text-[11px] leading-relaxed text-[var(--ink-400)]">
        Your identity and contact details stay hidden until both sides approve.
        Kinfolk only shares context.
      </p>
    </div>
  );
}

function Cursor() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5.5 3.5L19 11.5L12.5 13L9.5 19.5L5.5 3.5Z"
        fill="#0b0b0c"
        stroke="white"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------- Phone status-bar glyphs ---------- */

function SignalDots() {
  return (
    <span className="flex items-end gap-[2px]">
      {[3, 5, 7, 9].map((h) => (
        <span className="w-[3px] rounded-[1px] bg-[#0b0b0c]" key={h} style={{ height: h }} />
      ))}
    </span>
  );
}

function WifiGlyph() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
      <path
        d="M8 10.5l2.2-2.6a3.4 3.4 0 00-4.4 0L8 10.5zM3.4 5a7 7 0 019.2 0M1 2.4a10.6 10.6 0 0114 0"
        stroke="#0b0b0c"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BatteryGlyph() {
  return (
    <span className="relative ml-[1px] flex h-[11px] w-[22px] items-center rounded-[3px] border border-[#0b0b0c]/40 px-[1.5px]">
      <span className="h-[7px] w-[13px] rounded-[1px] bg-[#0b0b0c]" />
      <span className="absolute -right-[2.5px] top-1/2 h-[4px] w-[1.5px] -translate-y-1/2 rounded-r bg-[#0b0b0c]/40" />
    </span>
  );
}
