import type { BudgetProgress, BudgetStatus } from '../domain/budgets';
import { formatCents } from '../domain/money';
import { routeHref } from '../router';

// Un obiettivo non ancora raggiunto è neutro: diventa verde solo quando è raggiunto.
const TONES: Record<BudgetStatus, { fill: string; track: string }> = {
  regolare: { fill: 'bg-series-1', track: 'bg-series-1/15' },
  vicino: { fill: 'bg-warning', track: 'bg-warning/20' },
  superato: { fill: 'bg-critical', track: 'bg-critical/20' },
  'in-corso': { fill: 'bg-muted', track: 'bg-muted/20' },
  raggiunto: { fill: 'bg-good', track: 'bg-good/20' },
};

function statusText({ budget, remainingCents, status }: BudgetProgress): string {
  switch (status) {
    case 'superato':
      return `Superata di ${formatCents(-remainingCents)}`;
    case 'raggiunto':
      return 'Obiettivo raggiunto';
    case 'in-corso':
      return `Mancano ${formatCents(remainingCents)}`;
    case 'vicino':
      return remainingCents === 0 ? 'Limite raggiunto' : `Restano solo ${formatCents(remainingCents)}`;
    case 'regolare':
      return budget.categoryIds.length === 0 && !budget.accountId
        ? 'Nessuna categoria: tocca per sceglierle'
        : `Restano ${formatCents(remainingCents)}`;
  }
}

// Lo stato si legge sempre anche dal testo: il colore da solo non basta.
function StatusIcon({ status }: { status: BudgetStatus }) {
  if (status === 'raggiunto') {
    return (
      <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-good" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (status === 'vicino' || status === 'superato') {
    return (
      <svg viewBox="0 0 24 24" className={`size-4 shrink-0 ${status === 'vicino' ? 'text-warning' : 'text-critical'}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4 2.5 20h19L12 4zM12 10v4M12 17h.01" />
      </svg>
    );
  }
  return null;
}

function BudgetRow({ progress }: { progress: BudgetProgress }) {
  const { budget, fill, status, usedCents } = progress;
  const tone = TONES[status];
  return (
    <a href={routeHref('impostazioni/buste')} className="block px-4 py-3 active:bg-bg">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate">{budget.name}</span>
        <span className="shrink-0 text-sm tabular-nums">
          {formatCents(usedCents)} <span className="text-muted">di {formatCents(budget.amountCents)}</span>
        </span>
      </span>
      <span className={`mt-1.5 block h-2 overflow-hidden rounded-[4px] ${tone.track}`} aria-hidden="true">
        <span className={`block h-full rounded-r-[4px] ${tone.fill}`} style={{ width: `${fill * 100}%` }} />
      </span>
      <span className="mt-1 flex items-center gap-1 text-xs text-muted">
        <StatusIcon status={status} />
        {statusText(progress)}
      </span>
    </a>
  );
}

export function BudgetList({ progress }: { progress: BudgetProgress[] }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
      {progress.map((item) => (
        <BudgetRow key={item.budget.id} progress={item} />
      ))}
    </div>
  );
}
