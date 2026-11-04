"use client";

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * Sky birds — a silhouette crosses the hero every 15-20s and is gone. Never two
 * at once: one bird reads as a sighting, a pair reads as scenery. Flights are
 * randomised on the client only (never during render), so there is nothing to
 * hydrate; reduced-motion visitors get an empty sky.
 */

// One flap cycle as three silhouettes — wings high, level, low — crossfaded.
// At this size the soft blend between frames reads as motion blur, which is
// what a distant bird actually looks like.
const WING_FRAMES = [
  "M3 2.4C7 3.6 10 5.6 12 7c2-1.4 5-3.4 9-4.6",
  "M2 6.1C6 6.4 9.6 6.7 12 7c2.4-.3 6-.6 10-.9",
  "M3 10.6C7 9.7 10 8.4 12 7c2 1.4 5 2.7 9 3.6",
];
const FRAME_FADE = [
  [1, 0, 0, 0, 1],
  [0, 1, 0, 1, 0],
  [0, 0, 1, 0, 0],
];
const FRAME_TIMES = [0, 0.25, 0.5, 0.75, 1];
const DRIFT_TIMES = [0, 0.28, 0.5, 0.76, 1];

const ASPECT = 14 / 24; // of the viewBox, so a bird's height follows its width
const HEADER_CLEARANCE = 16;
const HEADLINE_CLEARANCE = 22;
/** Thinner than this and there is no sky worth flying through. */
const MIN_SKY = 26;
/** Grace on top of a flight's own duration before the reaper claims it. */
const REAP_GRACE_MS = 2000;

type Band = { ceiling: number; floor: number };

type Flight = {
  id: number;
  top: number; // px below the top of the hero
  size: number; // px wide
  opacity: number;
  duration: number; // s to cross
  rightward: boolean;
  drift: number[]; // px, the vertical rise and fall of the glide
  flap: number; // s per wing cycle
  expiresAt: number; // performance.now() — backstop if onAnimationComplete never fires
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * The open sky is the strip that is inside the hero, below the fixed header,
 * and above the headline — the intersection of all three, in hero-local
 * coordinates, sampled at spawn. `MIN_SKY` is the single predicate for "is
 * there sky right now": a short viewport, a hero scrolled up under the header
 * and a hero pushed below it all fall out of it, and when the answer is no the
 * sighting is skipped rather than squeezed in. A fabricated band is what flew a
 * bird through the body copy before.
 *
 * The intersection is complete in space, not in time: it is sampled once, at
 * spawn, and two of its terms co-scroll with the bird while the `position:
 * fixed` header does not. A flight that was legal at spawn can therefore be
 * overtaken during its 9-15s life. Two artifacts follow, both cosmetic on a
 * decorative element, both known and accepted:
 *
 *   - Scroll. As little as ~16-28px puts the bird under the header — the 16px
 *     of HEADER_CLEARANCE alone, once the pill has collapsed. The pill is 94%
 *     opaque at z-50 over this z-0 host, so it occludes rather than collides,
 *     except in the gap either side of it above ~812px viewport width, where
 *     the bird crosses page margin rather than type.
 *   - Resize or rotation, which can reflow the headline under a bird already
 *     airborne.
 *
 * Both are one root cause: a position baked at spawn outliving the measurement
 * it came from. No remedy is named here on purpose — several were proposed
 * across the reviews and none survived scrutiny. Read the PR #32 ledger before
 * you touch this geometry.
 */
function skyBand(host: HTMLElement): Band | null {
  const hostTop = host.getBoundingClientRect().top;
  const header = document.querySelector("header")?.getBoundingClientRect();
  const headline = host.closest("section")?.querySelector("h1")?.getBoundingClientRect();

  const ceiling = Math.max(
    0,
    header ? header.bottom - hostTop + HEADER_CLEARANCE : host.clientHeight * 0.08,
  );
  const floor = Math.min(
    host.clientHeight,
    headline ? headline.top - hostTop - HEADLINE_CLEARANCE : host.clientHeight * 0.26,
  );

  return floor - ceiling >= MIN_SKY ? { ceiling, floor } : null;
}

// Invariant: MIN_SKY > maxSize * ASPECT (26 > 30 * 14/24 = 17.5). That 8.5px of
// slack is the only thing keeping `floor` above `band.ceiling` below. Widening
// the size range without raising MIN_SKY inverts the band — and MIN_SKY would
// still be reporting that there is sky.
function makeFlight(id: number, band: Band): Flight {
  const size = rand(18, 30);
  // A bird hangs below its own top edge, so its height comes out of the floor.
  const floor = band.floor - size * ASPECT;
  const top = rand(band.ceiling, floor);
  // Keep the glide inside the band it was born in, however thin that band is.
  const rise = Math.min(18, top - band.ceiling);
  const fall = Math.min(12, floor - top);
  const duration = rand(9, 15);

  return {
    id,
    top,
    size,
    duration,
    rightward: Math.random() < 0.5,
    opacity: rand(0.45, 0.7),
    drift: [0, -rise, rand(fall * 0.4, fall), -rise * 0.6, 0],
    flap: rand(0.34, 0.52),
    expiresAt: performance.now() + duration * 1000 + REAP_GRACE_MS,
  };
}

export function SkyBirds() {
  const reduce = useReducedMotion();
  const [flights, setFlights] = useState<Flight[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce) return;
    const host = hostRef.current;
    if (!host) return;

    let inView = true;
    let nextId = 0;
    let timer: ReturnType<typeof setTimeout>;

    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
    });
    observer.observe(host);

    const schedule = (min: number, max: number) => {
      timer = setTimeout(
        () => {
          // Skip the sighting rather than queue it up — nobody should scroll
          // back to a flock that accumulated while the tab sat in the background.
          if (inView && !document.hidden) {
            // Built outside the updater: React double-invokes updaters in dev,
            // and this one would otherwise burn ids and reroll the randomness.
            const band = skyBand(host);
            const candidate = band ? makeFlight(nextId++, band) : null;
            const now = performance.now();

            setFlights((current) => {
              // Reap anything whose completion callback never landed, so one
              // missed callback can't quietly retire the feature for the
              // session. This only runs on a tick the guard above let through,
              // so the guarantee is "by the time you are looking at the hero
              // again", not "immediately".
              const live = current.filter((flight) => flight.expiresAt > now);
              if (live.length > 0) return live.length === current.length ? current : live;
              // One bird at a time, always.
              if (candidate) return [candidate];
              return current.length === 0 ? current : live;
            });
          }
          schedule(15, 20);
        },
        rand(min, max) * 1000,
      );
    };

    // Let the hero finish resolving before anything moves through it.
    schedule(3, 7);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [reduce]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      ref={hostRef}
    >
      <LazyMotion features={domAnimation}>
        {flights.map((flight) => (
          <m.div
            animate={{ x: flight.rightward ? "112%" : "-12%" }}
            className="absolute inset-x-0"
            initial={{ x: flight.rightward ? "-12%" : "112%" }}
            key={flight.id}
            onAnimationComplete={() =>
              setFlights((current) => current.filter((other) => other.id !== flight.id))
            }
            style={{ top: flight.top }}
            transition={{ duration: flight.duration, ease: "linear" }}
          >
            <m.div
              animate={{ y: flight.drift }}
              transition={{
                duration: flight.duration,
                ease: "easeInOut",
                times: DRIFT_TIMES,
              }}
            >
              <Bird flight={flight} />
            </m.div>
          </m.div>
        ))}
      </LazyMotion>
    </div>
  );
}

// The silhouette is symmetric about its own centre, so there is nothing to
// mirror for a leftward bird — only the direction of travel differs.
function Bird({ flight }: { flight: Flight }) {
  return (
    <svg
      fill="none"
      height={flight.size * ASPECT}
      style={{ color: "var(--ink-800)", opacity: flight.opacity }}
      viewBox="0 0 24 14"
      width={flight.size}
    >
      {WING_FRAMES.map((d, index) => (
        <m.path
          animate={{ opacity: FRAME_FADE[index] }}
          d={d}
          key={d}
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth={1.5}
          transition={{
            duration: flight.flap,
            ease: "linear",
            repeat: Number.POSITIVE_INFINITY,
            times: FRAME_TIMES,
          }}
        />
      ))}
    </svg>
  );
}
