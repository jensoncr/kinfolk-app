"use client";

import { useMemo } from "react";
import { type BudgetHistogramBucket } from "./types";

type Props = {
  buckets: BudgetHistogramBucket[];
  rangeMin: number;
  rangeMax: number;
  height?: number;
  className?: string;
};

export function BudgetHistogram({
  buckets,
  rangeMin,
  rangeMax,
  height = 56,
  className,
}: Props) {
  const maxCount = useMemo(
    () => buckets.reduce((acc, bucket) => Math.max(acc, bucket.count), 0),
    [buckets],
  );

  if (buckets.length === 0) {
    return <div className={className} style={{ height }} aria-hidden="true" />;
  }

  return (
    <svg
      viewBox={`0 0 ${buckets.length} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="presentation"
      aria-hidden="true"
      className={className}
    >
      {buckets.map((bucket, index) => {
        const heightPct = maxCount > 0 ? (bucket.count / maxCount) * (height - 4) : 0;
        const y = height - heightPct;
        // Bucket is "in range" when any of it overlaps the active range.
        const inRange = bucket.end > rangeMin && bucket.start < rangeMax;
        const fill = inRange ? "var(--forest-700)" : "var(--ink-300)";
        const opacity = inRange ? 0.75 : 0.4;
        return (
          <rect
            key={`${bucket.start}-${bucket.end}`}
            x={index + 0.2}
            y={y}
            width={0.6}
            height={Math.max(heightPct, 1.5)}
            rx={0.2}
            fill={fill}
            fillOpacity={opacity}
          />
        );
      })}
    </svg>
  );
}
