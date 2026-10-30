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

function addTo(totals: Map<string, number>, key: string, cents: number): void {
  totals.set(key, (totals.get(key) ?? 0) + cents);
}

/**
 * Un tetto somma le spese delle sue categorie, oppure tutte quelle pagate dal suo conto: sempre al netto dei rimborsi.
 * Un obiettivo su un conto somma i trasferimenti in arrivo, perché un prelievo non cancella quanto si è messo da parte.
 * Senza conto misura i trasferimenti netti verso i conti investimento, come il report.
 */
export function budgetProgress(budgets: Budget[], data: ReportData, from: IsoDate, to: IsoDate): BudgetProgress[] {
  const net = netAmounts(data.transactions);
  const { investedCents } = summarizePeriod(data, from, to, net);

  const spentByCategory = new Map<string, number>();
  const spentByAccount = new Map<string, number>();
  const receivedByAccount = new Map<string, number>();
  for (const { accountId, amountCents, categoryId, date, id, toAccountId, type } of data.transactions) {
    if (date < from || date > to) continue;
    if (type === 'uscita') {
      const spent = net.expense.get(id) ?? 0;
      addTo(spentByAccount, accountId, spent);
      if (categoryId) addTo(spentByCategory, categoryId, spent);
    } else if (type === 'trasferimento' && toAccountId) {
      addTo(receivedByAccount, toAccountId, amountCents);
    }
  }

  function usedBy({ accountId, categoryIds, kind }: Budget): number {
    if (kind === 'obiettivo') return accountId ? (receivedByAccount.get(accountId) ?? 0) : investedCents;
    if (accountId) return spentByAccount.get(accountId) ?? 0;
    return categoryIds.reduce((total, id) => total + (spentByCategory.get(id) ?? 0), 0);
  }

  return budgets.map((budget) => {
    const usedCents = usedBy(budget);
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
