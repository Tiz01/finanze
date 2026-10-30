import type { ReactNode } from 'react';

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 [&>*:nth-child(even)]:border-l [&>*:nth-child(even)]:border-line [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-line">
      {children}
    </dl>
  );
}

// Cifre proporzionali: quelle a larghezza fissa servono solo quando i numeri stanno in colonna.
export function StatTile({
  label,
  value,
  hint,
  negative = false,
}: {
  label: string;
  value: string;
  hint?: string;
  negative?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-lg font-semibold ${negative ? 'text-danger' : ''}`}>{value}</dd>
      {hint && <dd className="pt-0.5 text-xs text-muted">{hint}</dd>}
    </div>
  );
}
