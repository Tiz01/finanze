import { CATEGORY_IDS } from './categories';
import { addMonths, endOfMonth, startOfMonth } from './dates';
import { monthStarts, periodMonths } from './periods';
import type { Account, Category, IsoDate, Transaction } from './types';

export interface ReportData {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
}

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

export interface IncomeSources {
  salaryCents: number;
  giftsCents: number;
  refundsCents: number;
  otherCents: number;
}

export interface PeriodSummary {
  incomeCents: number;
  sources: IncomeSources;
  /** Rimborsi già sottratti dalle spese, e quindi fuori dalle entrate. */
  nettedRefundsCents: number;
  expenseCents: number;
  fixedCents: number;
  variableCents: number;
  /** Con il loro segno: una rettifica negativa sono soldi persi per strada. */
  adjustmentCents: number;
  /** Le rettifiche dei conti investimento sono andamento del mercato, non risparmio. */
  marketCents: number;
  /** Trasferimenti netti verso i conti investimento: sono risparmio, non spesa. */
  investedCents: number;
  savingsCents: number;
  /** Sulle entrate totali. Null se non ce ne sono. */
  savingsRate: number | null;
  /** Come se lo stipendio fosse l'unica entrata. Null se non c'è stipendio. */
  salarySavingsRate: number | null;
}

/** I trasferimenti tra conti non contano: spostano soldi, non li guadagnano né li spendono. */
export function summarizePeriod(
  { accounts, categories, transactions }: ReportData,
  from: IsoDate,
  to: IsoDate,
  net: NetAmounts = netAmounts(transactions),
): PeriodSummary {
  const investmentAccounts = new Set(
    accounts.filter((account) => account.type === 'investimento').map((account) => account.id),
  );
  const fixedCategories = new Set(categories.filter((category) => category.fissa).map((category) => category.id));

  const sources: IncomeSources = { salaryCents: 0, giftsCents: 0, refundsCents: 0, otherCents: 0 };
  let nettedRefundsCents = 0;
  let fixedCents = 0;
  let variableCents = 0;
  let adjustmentCents = 0;
  let marketCents = 0;
  let investedCents = 0;

  for (const transaction of transactions) {
    if (transaction.date < from || transaction.date > to) continue;
    const { accountId, amountCents, categoryId, recurringId, toAccountId } = transaction;

    switch (transaction.type) {
      case 'entrata': {
        const cents = net.income.get(transaction.id) ?? 0;
        nettedRefundsCents += amountCents - cents;
        if (categoryId === CATEGORY_IDS.stipendio) sources.salaryCents += cents;
        else if (categoryId === CATEGORY_IDS.regaliRicevuti) sources.giftsCents += cents;
        else if (categoryId === CATEGORY_IDS.rimborsi) sources.refundsCents += cents;
        else sources.otherCents += cents;
        break;
      }
      case 'uscita': {
        const cents = net.expense.get(transaction.id) ?? 0;
        if (recurringId || (categoryId && fixedCategories.has(categoryId))) fixedCents += cents;
        else variableCents += cents;
        break;
      }
      case 'rettifica':
        if (investmentAccounts.has(accountId)) marketCents += amountCents;
        else adjustmentCents += amountCents;
        break;
      case 'trasferimento': {
        const entering = toAccountId !== undefined && investmentAccounts.has(toAccountId);
        const leaving = investmentAccounts.has(accountId);
        if (entering && !leaving) investedCents += amountCents;
        if (leaving && !entering) investedCents -= amountCents;
        break;
      }
    }
  }

  const { salaryCents, giftsCents, refundsCents, otherCents } = sources;
  const incomeCents = salaryCents + giftsCents + refundsCents + otherCents;
  const expenseCents = fixedCents + variableCents;
  const savingsCents = incomeCents - expenseCents + adjustmentCents;
  const salarySavingsCents = salaryCents - expenseCents + adjustmentCents;

  return {
    incomeCents,
    sources,
    nettedRefundsCents,
    expenseCents,
    fixedCents,
    variableCents,
    adjustmentCents,
    marketCents,
    investedCents,
    savingsCents,
    savingsRate: incomeCents > 0 ? savingsCents / incomeCents : null,
    salarySavingsRate: salaryCents > 0 ? salarySavingsCents / salaryCents : null,
  };
}

const BASELINE_MONTHS = 3;

/**
 * I mesi completi su cui calcolare le medie: i tre prima del mese di `from`,
 * il mese in corso falserebbe la media. Quelli anteriori alla prima spesa non contano.
 */
export function baselineMonths(transactions: Transaction[], from: IsoDate): IsoDate[] {
  let firstExpense: IsoDate | null = null;
  for (const { date, type } of transactions) {
    if (type === 'uscita' && (firstExpense === null || date < firstExpense)) firstExpense = date;
  }
  if (firstExpense === null) return [];

  const firstMonth = startOfMonth(firstExpense);
  const start = startOfMonth(from);
  const months: IsoDate[] = [];
  for (let back = BASELINE_MONTHS; back >= 1; back -= 1) {
    const month = addMonths(start, -back);
    if (month >= firstMonth) months.push(month);
  }
  return months;
}

export interface ExpenseBaseline {
  months: IsoDate[];
  averageCents: number;
}

export function averageMonthlyExpense(transactions: Transaction[], from: IsoDate): ExpenseBaseline | null {
  const months = baselineMonths(transactions, from);
  if (months.length === 0) return null;

  const keys = new Set(months.map((month) => month.slice(0, 7)));
  const net = netAmounts(transactions);
  let total = 0;
  for (const { date, id, type } of transactions) {
    if (type === 'uscita' && keys.has(date.slice(0, 7))) total += net.expense.get(id) ?? 0;
  }
  return { months, averageCents: Math.round(total / months.length) };
}

export interface CategoryExpense {
  categoryId: string;
  cents: number;
  /** Media mensile nei mesi di confronto. Null se non ce ne sono. */
  averageCents: number | null;
  /** La stessa media riportata alla durata del periodo, per confrontarla con `cents`. */
  expectedCents: number | null;
}

/** Le spese del periodo per categoria, dalla più alta. */
export function expensesByCategory(transactions: Transaction[], from: IsoDate, to: IsoDate): CategoryExpense[] {
  const net = netAmounts(transactions);
  const months = baselineMonths(transactions, from);
  const keys = new Set(months.map((month) => month.slice(0, 7)));
  const length = periodMonths(from, to);

  const current = new Map<string, number>();
  const past = new Map<string, number>();
  for (const { categoryId, date, id, type } of transactions) {
    if (type !== 'uscita' || !categoryId) continue;
    const cents = net.expense.get(id) ?? 0;
    if (date >= from && date <= to) current.set(categoryId, (current.get(categoryId) ?? 0) + cents);
    if (keys.has(date.slice(0, 7))) past.set(categoryId, (past.get(categoryId) ?? 0) + cents);
  }

  const rows: CategoryExpense[] = [];
  for (const categoryId of new Set([...current.keys(), ...past.keys()])) {
    const cents = current.get(categoryId) ?? 0;
    const total = past.get(categoryId) ?? 0;
    if (cents === 0 && total === 0) continue;
    const average = months.length > 0 ? total / months.length : null;
    rows.push({
      categoryId,
      cents,
      averageCents: average === null ? null : Math.round(average),
      expectedCents: average === null ? null : Math.round(average * length),
    });
  }
  return rows.sort((a, b) => b.cents - a.cents || (b.averageCents ?? 0) - (a.averageCents ?? 0));
}

export interface MonthSummary {
  month: IsoDate;
  incomeCents: number;
  expenseCents: number;
  savingsCents: number;
}

export function monthlyBreakdown(data: ReportData, from: IsoDate, to: IsoDate): MonthSummary[] {
  const net = netAmounts(data.transactions);
  const rows = monthStarts(from, to).map((month) => {
    const lastDay = endOfMonth(month);
    const summary = summarizePeriod(data, month < from ? from : month, lastDay > to ? to : lastDay, net);
    return {
      month,
      incomeCents: summary.incomeCents,
      expenseCents: summary.expenseCents,
      savingsCents: summary.savingsCents,
    };
  });
  // Prima del primo mese con qualcosa non c'è niente da dire; da lì in poi anche un mese vuoto è un dato.
  const first = rows.findIndex((row) => row.incomeCents !== 0 || row.expenseCents !== 0 || row.savingsCents !== 0);
  return first === -1 ? [] : rows.slice(first);
}

/** Per quanti mesi basterebbe la liquidità alle spese medie. Null se non c'è una media. */
export function autonomyMonths(liquidityCents: number, averageExpenseCents: number | null): number | null {
  if (averageExpenseCents === null || averageExpenseCents <= 0) return null;
  return Math.max(0, liquidityCents) / averageExpenseCents;
}
