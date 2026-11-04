import type { ReactNode } from "react";

export function IconBtn({
  children,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className="kin-focus grid size-11 place-items-center rounded-full border border-[var(--border-strong)] bg-white text-[var(--ink-800)] transition hover:bg-[var(--bg-soft)] sm:size-9"
    >
      {children}
    </button>
  );
}

export function Row({
  label,
  children,
  muted,
}: {
  label: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? "text-[var(--ink-500)]" : "text-[var(--ink-700)]"}>{label}</dt>
      <dd
        className={[
          "mono text-xs",
          muted ? "text-[var(--ink-500)]" : "font-semibold text-[var(--ink-900)]",
        ].join(" ")}
      >
        {children}
      </dd>
    </div>
  );
}

export function Section({
  eyebrow,
  title,
  children,
}: {
  // Rendered as a one-line lede beneath the heading (counts, context).
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--ink-900)]">
        {title}
      </h3>
      {eyebrow ? (
        <p className="mt-1 text-sm text-[var(--ink-600)]">{eyebrow}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SkeletonSection({
  eyebrow,
  lineCount = 3,
}: {
  // The section's heading label while its data loads.
  eyebrow: string;
  lineCount?: number;
}) {
  return (
    <section>
      <h3 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--ink-900)]">
        {eyebrow}
      </h3>
      <div className="mt-4 space-y-3">
        {Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--bg-soft)]"
          />
        ))}
      </div>
    </section>
  );
}
