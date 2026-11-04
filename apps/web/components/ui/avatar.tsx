import Image from "next/image";

type AvatarProps = {
  imageUrl: string | null;
  initials: string;
  seed: string;
  size?: number;
  /** Extra classes appended to the base avatar tile classes. */
  className?: string;
  /**
   * Explicit font size (px) for the initials fallback. When omitted, font
   * sizing falls back to whatever `className`/CSS supplies.
   */
  fontSize?: number;
};

/**
 * Deterministic warm tint per seed; circular tile with initials fallback.
 * Shared by the dashboard header/sidebar and the matches pane.
 */
export function Avatar({
  imageUrl,
  initials,
  seed,
  size = 56,
  className,
  fontSize,
}: AvatarProps) {
  const hue = Array.from(seed).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
  return (
    <span
      aria-hidden="true"
      className={`mono grid place-items-center overflow-hidden rounded-full border border-[rgba(28,51,38,0.08)] font-semibold text-[#264a36]${
        className ? ` ${className}` : ""
      }`}
      style={{
        width: size,
        height: size,
        ...(fontSize != null ? { fontSize } : null),
        background: `linear-gradient(135deg, hsl(${hue} 35% 90%), hsl(${(hue + 40) % 360} 30% 82%))`,
      }}
    >
      {imageUrl ? (
        <Image alt="" className="size-full object-cover" height={size} src={imageUrl} width={size} />
      ) : (
        initials
      )}
    </span>
  );
}
