import type { ReactNode } from 'react';

const RADIUS = 42;
const THICKNESS = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// In unità del disegno: alla grandezza in cui compare, circa 2 pixel tra una fetta e l'altra.
const GAP = 2;
// Una fetta minuscola deve restare visibile.
const MIN_ARC = 3;

export interface DonutSegment {
  label: string;
  cents: number;
  color: string;
}

/** Le parti di un totale a colpo d'occhio. Il disegno non basta: i numeri vanno sempre scritti accanto. */
export function DonutChart({ segments, children }: { segments: DonutSegment[]; children: ReactNode }) {
  const visible = segments.filter(({ cents }) => cents > 0);
  const total = visible.reduce((sum, { cents }) => sum + cents, 0);
  const gap = visible.length > 1 ? GAP : 0;
  const description = visible.map(({ cents, label }) => `${label} ${Math.round((cents / total) * 100)}%`).join(', ');

  let start = 0;
  return (
    <div className="relative size-28 shrink-0">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={description}>
        {visible.map(({ cents, color, label }) => {
          const share = (cents / total) * CIRCUMFERENCE;
          const arc = Math.max(share - gap, MIN_ARC);
          const offset = -start;
          start += share;
          return (
            <circle
              key={label}
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              stroke={color}
              strokeWidth={THICKNESS}
              strokeDasharray={`${arc} ${CIRCUMFERENCE - arc}`}
              strokeDashoffset={offset}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
