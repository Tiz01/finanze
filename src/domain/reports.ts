import type { IsoDate, Transaction } from './types';

interface NetAmounts {
  /** Quanto resta di ogni spesa dopo i rimborsi collegati. */
  expense: Map<string, number>;
  /** Quanto di ogni entrata conta come entrata. */
  income: Map<string, number>;
}

/**
 * Un rimborso collegato riduce la spesa e non conta tra le entrate, altrimenti il risparmio
 * risulterebbe gonfiato. Se i rimborsi superano la spesa, l'eccedenza è un'entrata vera.
 */
export function netAmounts(transactions: Transaction[]): NetAmounts {
  const expense = new Map<string, number>();
  const income = new Map<string, number>();
  const refunds: Transaction[] = [];

  for (const transaction of transactions) {
    if (transaction.type === 'uscita') expense.set(transaction.id, transaction.amountCents);
    if (transaction.type === 'entrata') {
      income.set(transaction.id, transaction.amountCents);
      if (transaction.reimbursesId) refunds.push(transaction);
    }
  }

  refunds.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  for (const refund of refunds) {
    const remaining = expense.get(refund.reimbursesId ?? '');
    if (remaining === undefined) continue;
    const used = Math.min(remaining, refund.amountCents);
    expense.set(refund.reimbursesId ?? '', remaining - used);
    income.set(refund.id, refund.amountCents - used);
  }
  return { expense, income };
}

export interface PeriodSummary {
  incomeCents: number;
  expenseCents: number;
  /** Con il loro segno: una rettifica negativa sono soldi persi per strada. */
  adjustmentCents: number;
  savingsCents: number;
  /** Null se nel periodo non ci sono entrate. */
  savingsRate: number | null;
}

/** I trasferimenti non contano: spostano soldi, non li guadagnano né li spendono. */
export function summarizePeriod(transactions: Transaction[], from: IsoDate, to: IsoDate): PeriodSummary {
  const net = netAmounts(transactions);
  let incomeCents = 0;
  let expenseCents = 0;
  let adjustmentCents = 0;

  for (const transaction of transactions) {
    if (transaction.date < from || transaction.date > to) continue;
    if (transaction.type === 'entrata') incomeCents += net.income.get(transaction.id) ?? 0;
    else if (transaction.type === 'uscita') expenseCents += net.expense.get(transaction.id) ?? 0;
    else if (transaction.type === 'rettifica') adjustmentCents += transaction.amountCents;
  }

  const savingsCents = incomeCents - expenseCents + adjustmentCents;
  return {
    incomeCents,
    expenseCents,
    adjustmentCents,
    savingsCents,
    savingsRate: incomeCents > 0 ? savingsCents / incomeCents : null,
  };
}
