"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

// Root-anchored: this header also renders on /how-it-works, /privacy, and
// /terms, where a bare "#how-it-works" hash has no target and does nothing.
const navItems = [
  { href: "/#how-it-works", label: "How it works" },
];

const easeOut = "cubic-bezier(0.32,0.72,0,1)";
const collapseTransition = `max-width 360ms ${easeOut}, padding 360ms ${easeOut}, border-radius 360ms ${easeOut}, background-color 360ms ${easeOut}, border-color 360ms ${easeOut}, box-shadow 360ms ${easeOut}`;
const sizeTransition = `width 360ms ${easeOut}, height 360ms ${easeOut}, border-radius 360ms ${easeOut}, font-size 360ms ${easeOut}`;
const segTransition = `padding 360ms ${easeOut}, background 360ms ${easeOut}, border-color 360ms ${easeOut}`;
const tabTransition = `max-width 360ms ${easeOut}, padding 360ms ${easeOut}, opacity 220ms ease, background 150ms ease, color 150ms ease`;

export function LandingHeader() {
  const pathname = usePathname();
  // Always start false to match the server render — reading window.scrollY
  // during the first render breaks hydration when the browser restores a
  // scrolled position before React mounts. The effect below syncs on mount.
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;

    function update() {
      setIsScrolled(window.scrollY > 8);
      ticking = false;
    }

    update();

    function handleScroll() {
      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(update);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="pointer-events-none fixed left-1/2 top-4 z-50 flex w-[calc(100%-32px)] -translate-x-1/2 justify-center">
      <div
        className="pointer-events-auto relative flex w-full items-center justify-between gap-6 border backdrop-blur-2xl"
        style={{
          maxWidth: isScrolled ? 780 : "100%",
          padding: isScrolled ? "8px 10px 8px 16px" : "12px 22px",
          borderRadius: isScrolled ? 9999 : "14px 14px 0 0",
          background: isScrolled ? "rgba(255,255,255,0.94)" : "rgba(248,246,240,0.94)",
          borderColor: isScrolled ? "rgba(28,51,38,0.10)" : "rgba(28,51,38,0.06)",
          boxShadow: isScrolled
            ? "0 1px 2px rgba(28,51,38,0.04), 0 14px 32px -12px rgba(28,51,38,0.20), inset 0 1px 0 rgba(255,255,255,0.55)"
            : "0 1px 0 rgba(28,51,38,0.02), inset 0 1px 0 rgba(255,255,255,0.4)",
          transition: collapseTransition,
        }}
      >
        <div className="flex shrink-0 items-center gap-3.5">
          <Link className="kin-focus flex shrink-0 items-center gap-2.5 rounded-full" href="/">
            <span
              className="grid place-items-center overflow-hidden border border-[rgba(28,51,38,0.08)] bg-[#f8f5ec]"
              style={{
                width: isScrolled ? 30 : 34,
                height: isScrolled ? 30 : 34,
                borderRadius: isScrolled ? 8 : 9,
                boxShadow:
                  "0 1px 2px rgba(28,51,38,0.08), inset 0 1px 0 rgba(255,255,255,0.5)",
                transition: sizeTransition,
              }}
            >
              <Image
                alt=""
                className="size-full object-cover"
                height={34}
                priority
                src="/assets/kinfolk-logo-mark.png"
                width={34}
              />
            </span>
            <span
              className="serif font-normal tracking-[-0.01em] text-[var(--ink-900)]"
              style={{
                fontSize: isScrolled ? 17 : 20,
                transition: sizeTransition,
              }}
            >
              Kinfolk
            </span>
          </Link>

          {/* Plain navigation links (NOT role=tablist/tab: there is no
              tabpanel or arrow-key behavior, and hardcoded aria-selected lied
              on every non-landing route). aria-current tracks the real path. */}
          <nav
            aria-label="Audience"
            className="hidden items-center rounded-full md:inline-flex"
            style={{
              padding: isScrolled ? 0 : 4,
              background: isScrolled ? "transparent" : "rgba(28,51,38,0.06)",
              border: `1px solid ${isScrolled ? "transparent" : "rgba(28,51,38,0.06)"}`,
              transition: segTransition,
            }}
          >
            <Link
              aria-current={pathname === "/" ? "page" : undefined}
              className="inline-flex items-center overflow-hidden whitespace-nowrap rounded-full text-[12px] font-semibold text-[var(--ink-900)]"
              href="/"
              style={{
                background: isScrolled ? "transparent" : "#ffffff",
                maxWidth: isScrolled ? 0 : 200,
                padding: isScrolled ? "5px 0" : "5px 12px",
                opacity: isScrolled ? 0 : 1,
                pointerEvents: isScrolled ? "none" : "auto",
                boxShadow: isScrolled ? "none" : "0 1px 2px rgba(28,51,38,0.06)",
                transition: tabTransition,
              }}
              tabIndex={isScrolled ? -1 : 0}
            >
              For renters
            </Link>
            <Link
              aria-current={pathname === "/landlords" ? "page" : undefined}
              className="inline-flex items-center whitespace-nowrap rounded-full text-[12px] font-semibold text-[var(--ink-700)] transition-colors hover:text-[var(--ink-900)]"
              href="/landlords"
              style={{
                background: isScrolled ? "rgba(28,51,38,0.06)" : "transparent",
                padding: isScrolled ? "6px 14px" : "5px 12px",
                transition: tabTransition,
              }}
            >
              For landlords
            </Link>
          </nav>
        </div>

        <nav
          aria-label="Primary"
          className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-7 lg:flex"
        >
          {navItems.map((item) => (
            <a
              className="kin-focus rounded-full text-[13px] font-medium text-[var(--ink-600)] transition-colors hover:text-[var(--ink-900)]"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <Link
          className="kin-focus inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#264a36] px-4 py-2 text-[13px] font-semibold tracking-[-0.005em] text-white shadow-[inset_0_0_0_1px_#162c20,0_8px_22px_-12px_rgba(38,74,54,0.45)] transition-[background,transform] duration-150 hover:bg-[#1c3526] active:scale-[0.97]"
          href="/me"
        >
          Go to app
          <ArrowRight aria-hidden="true" size={14} strokeWidth={2.4} />
        </Link>
      </div>
    </header>
  );
}
