import { netAmounts, summarizePeriod, type ReportData } from './reports';
import type { Budget, IsoDate } from './types';

// Identificatori stabili: un backup importato non deve ricrearle due volte.
const DEFAULT_BUDGETS: readonly Budget[] = [
  {
    id: 'busta-svago',
    name: 'Svago + spese',
    kind: 'tetto',
    amountCents: 30000,
    categoryIds: ['cat-ristoranti', 'cat-regali-fatti'],
    order: 1,
  },
  { id: 'busta-viaggi', name: 'Viaggi', kind: 'tetto', amountCents: 20000, categoryIds: ['cat-viaggi'], order: 2 },
  { id: 'busta-previste', name: 'Spese previste', kind: 'tetto', amountCents: 20000, categoryIds: [], order: 3 },
  { id: 'busta-pac', name: 'PAC ETF', kind: 'obiettivo', amountCents: 10000, categoryIds: [], order: 4 },
];

/** Le buste iniziali, senza le categorie che non esistono più. */
export function defaultBudgets(existingCategoryIds: ReadonlySet<string>): Budget[] {
  return DEFAULT_BUDGETS.map((budget) => ({
    ...budget,
    categoryIds: budget.categoryIds.filter((id) => existingCategoryIds.has(id)),
  }));
}

export type BudgetStatus = 'regolare' | 'vicino' | 'superato' | 'in-corso' | 'raggiunto';

export interface BudgetProgress {
  budget: Budget;
  /** Speso per un tetto, messo da parte per un obiettivo. */
  usedCents: number;
  /** Quanto resta: per un tetto è negativo se è stato superato. */
  remainingCents: number;
  /** Tra 0 e 1, per disegnare la barra. */
  fill: number;
  status: BudgetStatus;
}

const NEAR_LIMIT = 0.85;

function statusOf(budget: Budget, usedCents: number): BudgetStatus {
  if (budget.kind === 'obiettivo') return usedCents >= budget.amountCents ? 'raggiunto' : 'in-corso';
  if (usedCents > budget.amountCents) return 'superato';
  return usedCents >= budget.amountCents * NEAR_LIMIT ? 'vicino' : 'regolare';
}

/**
 * Un tetto somma le spese delle sue categorie, al netto dei rimborsi e su qualunque conto.
 * Un obiettivo misura i trasferimenti netti verso i conti investimento.
 */
export function budgetProgress(budgets: Budget[], data: ReportData, from: IsoDate, to: IsoDate): BudgetProgress[] {
  const net = netAmounts(data.transactions);
  const { investedCents } = summarizePeriod(data, from, to, net);

  const spentByCategory = new Map<string, number>();
  for (const { categoryId, date, id, type } of data.transactions) {
    if (type !== 'uscita' || !categoryId || date < from || date > to) continue;
    spentByCategory.set(categoryId, (spentByCategory.get(categoryId) ?? 0) + (net.expense.get(id) ?? 0));
  }

  return budgets.map((budget) => {
    const usedCents =
      budget.kind === 'obiettivo'
        ? investedCents
        : budget.categoryIds.reduce((total, id) => total + (spentByCategory.get(id) ?? 0), 0);
    const ratio = budget.amountCents > 0 ? usedCents / budget.amountCents : 0;
    return {
      budget,
      usedCents,
      remainingCents: budget.amountCents - usedCents,
      fill: Math.min(1, Math.max(0, ratio)),
      status: statusOf(budget, usedCents),
    };
  });
}
