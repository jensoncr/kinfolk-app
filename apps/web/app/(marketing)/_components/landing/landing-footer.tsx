import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { RevealWordmark } from "@/app/(marketing)/_components/landing/landing-motion";

// "How it works" gets the full standalone page (otherwise unreachable by navigation).
const productLinks = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/", label: "For renters" },
  { href: "/landlords", label: "For landlords" },
  { href: "/apartments", label: "Browse apartments" },
];

export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden bg-[var(--forest-900)] text-[#f3f0e7]">
      <div className="relative border-t border-white/10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(rgba(243,240,231,0.12) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
            backgroundPosition: "0 0",
            maskImage:
              "linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
          }}
        />

        <div className="relative pb-10">
          <div className="page-shell pt-16">
          {/* Company/Connect columns were href="#" placeholders — restore them
              only when real destinations exist. */}
          <div className="grid gap-12 md:grid-cols-[1.6fr_1fr]">
            <div>
              <Link className="kin-focus inline-flex items-center gap-2.5 rounded-full" href="/">
                <span
                  className="grid size-9 place-items-center overflow-hidden rounded-lg border border-white/10 bg-[#f8f5ec]"
                  style={{
                    boxShadow:
                      "0 1px 2px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.4)",
                  }}
                >
                  <Image
                    alt=""
                    className="size-full object-cover"
                    height={36}
                    src="/assets/kinfolk-logo-mark.png"
                    width={36}
                  />
                </span>
                <span className="serif text-[22px] font-normal tracking-[-0.01em] text-white">
                  Kinfolk
                </span>
              </Link>

              <p className="serif mt-8 max-w-[24ch] text-[1.6rem] leading-[1.15] tracking-[-0.01em] text-white">
                &ldquo;An apartment is only as good as who you live with.&rdquo;
              </p>
              <p className="serif mt-2 text-[15px] italic text-white/55">
                &mdash; Now you have a way to find both.
              </p>

              <Link
                className="kin-focus mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--forest-700)] px-5 py-3 text-sm font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] transition hover:bg-[var(--forest-600)]"
                href="/me"
              >
                Talk to Kinfolk
                <ArrowRight aria-hidden="true" size={16} strokeWidth={2.4} />
              </Link>
            </div>

            <FooterColumn heading="Product" links={productLinks} />
          </div>
          </div>

          <div className="page-shell">
            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-[13px] text-white/50">
              <p>&copy; 2026 Kinfolk, Inc. All rights reserved.</p>
              <div className="flex items-center gap-6">
                <Link className="transition hover:text-white" href="/privacy">
                  Privacy
                </Link>
                <Link className="transition hover:text-white" href="/terms">
                  Terms
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dusk streetscape closes the page; the wordmark sits on the scene. */}
      <div aria-hidden="true" className="relative h-[clamp(260px,46vw,640px)] select-none overflow-hidden">
        <Image
          alt=""
          className="object-cover object-bottom"
          fill
          sizes="100vw"
          src="/landing/footer-street.jpg"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--forest-900)_0%,rgba(18,28,22,0.45)_30%,rgba(18,28,22,0)_58%)]" />
        <div className="absolute inset-x-0 bottom-0 overflow-hidden px-4 pb-2 md:px-6">
          <RevealWordmark>
            {/* 26vw of "Kinfolk." clips off a phone screen; below md the wordmark
                scales to fit the viewport instead. */}
            <p className="serif select-none whitespace-nowrap text-center text-[clamp(3.5rem,20vw,28rem)] font-medium leading-[0.85] tracking-[-0.045em] text-[#f0ebdd]/60 md:text-[clamp(5rem,26vw,28rem)]">
              Kinfolk.
            </p>
          </RevealWordmark>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <p className="mono text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
        {heading}
      </p>
      <ul className="mt-4 space-y-3 text-[15px] text-white/85">
        {links.map((link) => (
          <li key={`${heading}-${link.label}`}>
            <Link
              className="kin-focus inline-block rounded transition hover:text-white"
              href={link.href}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
