"use client";

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Landing motion kit (Motion / motion-react).
 *
 * Deliberately NOT one blanket reveal — each section gets its own gesture so
 * the page reads as composed rather than templated:
 *   - Resolve       hero settles in place without hiding first paint.
 *   - RevealCard    cards spring/"set down" from slightly below — physical character.
 *   - RevealSlide   section headers and columns rise into place; every current
 *                   caller uses from="up" (the lateral variants are kept for
 *                   API generality but the approved SaaS register doesn't use
 *                   lateral slides).
 *   - RevealWordmark the giant footer wordmark slowly develops.
 *
 * Easing + spring values follow Emil Kowalski's standards (animations.dev):
 * strong ease-out curve (built-in easings are too weak) and subtle-bounce
 * springs for "alive" elements. Reduced motion renders fully resolved.
 */

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const VIEWPORT = { once: true, margin: "0px 0px -12% 0px" } as const;

const TAGS = {
  div: m.div,
  span: m.span,
  p: m.p,
  article: m.article,
} as const;

const PLAIN_TAGS = {
  div: "div",
  span: "span",
  p: "p",
  article: "article",
} as const;

type TagName = keyof typeof TAGS;

type BaseProps = {
  children: ReactNode;
  className?: string;
  as?: TagName;
  delay?: number;
  id?: string;
};

/**
 * Hero settle — plays on mount (above the fold). A tiny position resolve on a
 * strong ease-out curve; distinct from the spring-rise used for cards below.
 */
export function Resolve({ children, className, as = "div", delay = 0, id }: BaseProps) {
  const reduce = useReducedMotion();
  // Same motion prop surface across tags for our usage; cast keeps TS happy.
  const Tag = TAGS[as] as typeof m.div;

  if (reduce) {
    const Plain = PLAIN_TAGS[as];
    return (
      <Plain className={className} id={id}>
        {children}
      </Plain>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <Tag
        animate={{ opacity: 1, y: 0 }}
        className={className}
        id={id}
        initial={{ opacity: 1, y: 3 }}
        transition={{ duration: 0.4, ease: EASE_OUT, delay }}
      >
        {children}
      </Tag>
    </LazyMotion>
  );
}

/**
 * Card "set-down" — a subtle-bounce spring rising from slightly below + small,
 * anchored at its bottom edge so it reads as settling into place. This is the
 * physical character that the flat fade was missing.
 */
export function RevealCard({ children, className, as = "div", delay = 0 }: BaseProps) {
  const reduce = useReducedMotion();
  const Tag = TAGS[as] as typeof m.div;

  if (reduce) {
    const Plain = PLAIN_TAGS[as];
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <LazyMotion features={domAnimation}>
      <Tag
        className={className}
        initial={{ opacity: 1, y: 26, scale: 0.965 }}
        style={{ transformOrigin: "center bottom" }}
        transition={{ type: "spring", duration: 0.7, bounce: 0.2, delay }}
        viewport={VIEWPORT}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
      >
        {children}
      </Tag>
    </LazyMotion>
  );
}

/**
 * Section reveal — headers and columns rise into place ("up", the only
 * direction current callers use). The lateral variants remain for API
 * generality only.
 */
export function RevealSlide({
  children,
  className,
  as = "div",
  delay = 0,
  from = "up",
}: BaseProps & { from?: "left" | "right" | "up" }) {
  const reduce = useReducedMotion();
  const Tag = TAGS[as] as typeof m.div;
  const offset = from === "left" ? { x: -22 } : from === "right" ? { x: 22 } : { y: 16 };

  if (reduce) {
    const Plain = PLAIN_TAGS[as];
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <LazyMotion features={domAnimation}>
      <Tag
        className={className}
        initial={{ opacity: 1, ...offset }}
        transition={{ duration: 0.6, ease: EASE_OUT, delay }}
        viewport={VIEWPORT}
        whileInView={{ opacity: 1, x: 0, y: 0 }}
      >
        {children}
      </Tag>
    </LazyMotion>
  );
}

/**
 * Slow develop for the giant footer wordmark — a long, gentle scale + fade.
 */
export function RevealWordmark({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className={className}
        initial={{ opacity: 1, scale: 0.975 }}
        transition={{ duration: 1.1, ease: EASE_OUT }}
        viewport={{ once: true, margin: "0px 0px -6% 0px" }}
        whileInView={{ opacity: 1, scale: 1 }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}
