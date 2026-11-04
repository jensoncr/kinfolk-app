"use client";

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Props = {
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
  formatValue?: (value: number) => string;
  ariaLabelMin?: string;
  ariaLabelMax?: string;
  showTooltip?: boolean;
};

type ActiveThumb = "min" | "max" | null;

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
}

function snap(value: number, step: number) {
  return Math.round(value / step) * step;
}

export function DualRangeSlider({
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
  ariaLabelMin = "Minimum",
  ariaLabelMax = "Maximum",
  showTooltip = true,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<ActiveThumb>(null);
  const span = max - min;

  const [valueMin, valueMax] = value;
  const minPct = span > 0 ? ((valueMin - min) / span) * 100 : 0;
  const maxPct = span > 0 ? ((valueMax - min) / span) * 100 : 100;

  const pointerToValue = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return min;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return snap(min + ratio * span, step);
    },
    [min, span, step],
  );

  const updateForPointer = useCallback(
    (thumb: ActiveThumb, clientX: number) => {
      if (!thumb) return;
      const raw = pointerToValue(clientX);
      if (thumb === "min") {
        const next = clamp(raw, min, valueMax - step);
        if (next !== valueMin) onChange([next, valueMax]);
      } else {
        const next = clamp(raw, valueMin + step, max);
        if (next !== valueMax) onChange([valueMin, next]);
      }
    },
    [max, min, onChange, pointerToValue, step, valueMax, valueMin],
  );

  const handlePointerDown = (thumb: ActiveThumb) => (event: ReactPointerEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive(thumb);
    updateForPointer(thumb, event.clientX);
  };

  const handlePointerMove = (thumb: ActiveThumb) => (event: ReactPointerEvent<HTMLInputElement>) => {
    if (active !== thumb) return;
    updateForPointer(thumb, event.clientX);
  };

  const handlePointerRelease = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setActive(null);
  };

  const handleInputChange = (thumb: "min" | "max") => (nextValue: number) => {
    if (thumb === "min") {
      const next = clamp(nextValue, min, valueMax - step);
      if (next !== valueMin) onChange([next, valueMax]);
    } else {
      const next = clamp(nextValue, valueMin + step, max);
      if (next !== valueMax) onChange([valueMin, next]);
    }
  };

  const fillStyle: CSSProperties = {
    left: `${minPct}%`,
    right: `${100 - maxPct}%`,
  };

  return (
    <div className="relative w-full select-none py-3">
      <div
        ref={trackRef}
        className="relative h-1 w-full rounded-full bg-[var(--border-strong)]"
      >
        <div
          className="absolute top-0 h-1 rounded-full bg-[var(--forest-700)]"
          style={fillStyle}
        />

        <Thumb
          ariaLabel={ariaLabelMin}
          value={valueMin}
          min={min}
          max={valueMax - step}
          step={step}
          percent={minPct}
          isActive={active === "min"}
          formatValue={formatValue}
          showTooltip={showTooltip}
          onPointerDown={handlePointerDown("min")}
          onPointerMove={handlePointerMove("min")}
          onPointerUp={handlePointerRelease}
          onPointerCancel={handlePointerRelease}
          onValueChange={handleInputChange("min")}
          z={active === "min" ? 30 : 20}
        />
        <Thumb
          ariaLabel={ariaLabelMax}
          value={valueMax}
          min={valueMin + step}
          max={max}
          step={step}
          percent={maxPct}
          isActive={active === "max"}
          formatValue={formatValue}
          showTooltip={showTooltip}
          onPointerDown={handlePointerDown("max")}
          onPointerMove={handlePointerMove("max")}
          onPointerUp={handlePointerRelease}
          onPointerCancel={handlePointerRelease}
          onValueChange={handleInputChange("max")}
          z={active === "max" ? 30 : 21}
        />
      </div>
    </div>
  );
}

function Thumb({
  ariaLabel,
  value,
  min,
  max,
  step,
  percent,
  isActive,
  formatValue,
  showTooltip,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onValueChange,
  z,
}: {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  percent: number;
  isActive: boolean;
  formatValue?: (value: number) => string;
  showTooltip: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLInputElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLInputElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLInputElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLInputElement>) => void;
  onValueChange: (nextValue: number) => void;
  z: number;
}) {
  return (
    <span
      className="absolute top-1/2 block size-5 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${percent}%`, zIndex: z }}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        aria-valuetext={formatValue?.(value)}
        onChange={(event) => onValueChange(Number(event.currentTarget.value))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onFocus={() => undefined}
        className="peer absolute inset-0 z-10 size-5 cursor-grab touch-none opacity-0"
      />
      <span
        aria-hidden="true"
        className={[
          "pointer-events-none absolute inset-0 grid size-5 place-items-center rounded-full border-2 border-white bg-[var(--forest-700)] shadow-[0_2px_6px_rgba(14,31,23,0.25)] transition-transform peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--forest-700)]",
          isActive ? "scale-110" : "",
        ].join(" ")}
      >
      {showTooltip && isActive && formatValue ? (
        <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--forest-800)] px-2 py-1 text-[11px] font-semibold text-white shadow-md">
          {formatValue(value)}
        </span>
      ) : null}
      </span>
    </span>
  );
}
