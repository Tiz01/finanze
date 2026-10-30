import { addDays, addMonths, endOfMonth, isValidIsoDate, startOfMonth } from './dates';
import { formatCentsPlain, MAX_AMOUNT_CENTS } from './money';
import type { Account, Category, CategoryKind, IsoDate, Transaction, TransactionDraft, TransactionType } from './types';

/** Il primo problema del movimento, oppure null se è valido. */
export function validateTransaction(draft: TransactionDraft): string | null {
  if (!isValidIsoDate(draft.date)) return `Data non valida: ${String(draft.date)}`;
  if (!Number.isSafeInteger(draft.amountCents)) return 'L’importo deve essere un numero intero di centesimi';
  if (Math.abs(draft.amountCents) > MAX_AMOUNT_CENTS) return 'Importo troppo grande';
  if (!draft.accountId) return 'Manca il conto';

  switch (draft.type) {
    case 'entrata':
    case 'uscita':
      if (draft.amountCents <= 0) return 'L’importo deve essere maggiore di zero';
      if (!draft.categoryId) return 'Manca la categoria';
      if (draft.toAccountId) return 'Solo un trasferimento ha un conto di destinazione';
      if (draft.reimbursesId && draft.type !== 'entrata') return 'Solo un’entrata può essere un rimborso';
      return null;
    case 'trasferimento':
      if (draft.amountCents <= 0) return 'L’importo deve essere maggiore di zero';
      if (!draft.toAccountId) return 'Manca il conto di destinazione';
      if (draft.toAccountId === draft.accountId) return 'Scegli due conti diversi';
      if (draft.categoryId) return 'Un trasferimento non ha categoria';
      if (draft.reimbursesId) return 'Solo un’entrata può essere un rimborso';
      return null;
    case 'rettifica':
      if (draft.amountCents === 0) return 'La rettifica non può essere zero';
      if (draft.toAccountId) return 'Solo un trasferimento ha un conto di destinazione';
      if (draft.reimbursesId) return 'Solo un’entrata può essere un rimborso';
      return null;
    default:
      return `Tipo di movimento sconosciuto: ${String(draft.type)}`;
  }
}

/** Dal più recente al più vecchio; a parità di giorno, l'ultimo inserito per primo. */
export function compareNewestFirst(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return 0;
}

export interface DayGroup {
  date: IsoDate;
  transactions: Transaction[];
}

/** Raggruppa per giorno movimenti già ordinati. */
export function groupByDay(transactions: Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const transaction of transactions) {
    const last = groups[groups.length - 1];
    if (last && last.date === transaction.date) last.transactions.push(transaction);
    else groups.push({ date: transaction.date, transactions: [transaction] });
  }
  return groups;
}

const USAGE_WINDOW_DAYS = 90;

/** Le categorie selezionabili, le più usate di recente per prime. */
export function rankCategories(
  categories: Category[],
  transactions: Transaction[],
  kind: CategoryKind,
  today: IsoDate,
): Category[] {
  const since = addDays(today, -USAGE_WINDOW_DAYS);
  const uses = new Map<string, number>();
  for (const { categoryId, date } of transactions) {
    if (categoryId && date >= since && date <= today) uses.set(categoryId, (uses.get(categoryId) ?? 0) + 1);
  }
  return categories
    .filter((category) => category.kind === kind && !category.archived)
    .sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || a.order - b.order);
}

/** Il conto da preselezionare: l'ultimo usato per quel tipo di movimento, altrimenti il primo attivo. */
export function defaultAccountId(
  accounts: Account[],
  transactions: Transaction[],
  type: TransactionType,
): string | undefined {
  const active = new Set(accounts.filter((account) => !account.archived).map((account) => account.id));
  let latest: Transaction | undefined;
  for (const transaction of transactions) {
    if (transaction.type !== type || !active.has(transaction.accountId)) continue;
    if (!latest || transaction.createdAt > latest.createdAt) latest = transaction;
  }
  if (latest) return latest.accountId;
  const preferred = accounts.find((account) => !account.archived && account.type === 'corrente');
  return preferred?.id ?? accounts.find((account) => !account.archived)?.id;
}

/** Quanto è già stato rimborsato di ogni spesa. */
export function reimbursedTotals(transactions: Transaction[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const { reimbursesId, amountCents } of transactions) {
    if (reimbursesId) totals.set(reimbursesId, (totals.get(reimbursesId) ?? 0) + amountCents);
  }
  return totals;
}

export function parseTags(text: string): string[] {
  const tags = text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  return [...new Set(tags)];
}

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export interface TransactionFilter {
  query?: string;
  categoryId?: string;
  accountId?: string;
  from?: IsoDate;
  to?: IsoDate;
}

export interface FilterContext {
  accountNames: Map<string, string>;
  categoryNames: Map<string, string>;
}

function searchableText(transaction: Transaction, context: FilterContext): string {
  const amount = formatCentsPlain(Math.abs(transaction.amountCents));
  return normalizeText(
    [
      transaction.note ?? '',
      (transaction.tags ?? []).join(' '),
      transaction.categoryId ? (context.categoryNames.get(transaction.categoryId) ?? '') : '',
      context.accountNames.get(transaction.accountId) ?? '',
      transaction.toAccountId ? (context.accountNames.get(transaction.toAccountId) ?? '') : '',
      transaction.type === 'trasferimento' ? 'trasferimento' : '',
      transaction.type === 'rettifica' ? 'rettifica' : '',
      amount,
      amount.replaceAll('.', ''),
    ].join(' '),
  );
}

export function filterTransactions(
  transactions: Transaction[],
  filter: TransactionFilter,
  context: FilterContext,
): Transaction[] {
  const terms = normalizeText(filter.query ?? '')
    .split(/\s+/)
    .filter((term) => term !== '');

  return transactions.filter((transaction) => {
    if (filter.from && transaction.date < filter.from) return false;
    if (filter.to && transaction.date > filter.to) return false;
    if (filter.categoryId && transaction.categoryId !== filter.categoryId) return false;
    if (
      filter.accountId &&
      transaction.accountId !== filter.accountId &&
      transaction.toAccountId !== filter.accountId
    ) {
      return false;
    }
    if (terms.length === 0) return true;
    const text = searchableText(transaction, context);
    return terms.every((term) => text.includes(term));
  });
}

export const PERIOD_PRESETS = [
  { id: 'tutto', label: 'Tutto il periodo' },
  { id: 'mese', label: 'Questo mese' },
  { id: 'mese-scorso', label: 'Mese scorso' },
  { id: 'tre-mesi', label: 'Ultimi 3 mesi' },
  { id: 'anno', label: 'Quest’anno' },
  { id: 'personalizzato', label: 'Personalizzato' },
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]['id'];

export function periodRange(preset: PeriodPreset, today: IsoDate): { from?: IsoDate; to?: IsoDate } {
  switch (preset) {
    case 'mese':
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case 'mese-scorso': {
      const previous = addMonths(startOfMonth(today), -1);
      return { from: previous, to: endOfMonth(previous) };
    }
    case 'tre-mesi':
      return { from: addMonths(startOfMonth(today), -2), to: endOfMonth(today) };
    case 'anno':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default:
      return {};
  }
}
