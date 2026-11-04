import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "outline" | "verified";

const variantClasses: Record<BadgeVariant, string> = {
  default:
    "border-transparent bg-[var(--pp-ink)] text-[var(--pp-canvas)]",
  secondary:
    "border-transparent bg-[var(--pp-ink-10)] text-[var(--pp-ink-80)]",
  outline:
    "border-[var(--pp-hairline)] text-[var(--pp-ink-80)]",
  verified:
    "border-transparent bg-[rgba(38,74,54,0.08)] text-[#264a36]",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
