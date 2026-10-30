import { daysBetween } from './dates';
import { matchRule } from './importRules';
import { plainText, type StatementRow } from './statementMapping';
import type { Category, ImportRule, Transaction, TransactionDraft } from './types';

/** La data di un movimento inserito a mano può differire di qualche giorno da quella della banca. */
const DUPLICATE_WINDOW_DAYS = 3;

const FALLBACK_CATEGORIES = { uscita: 'cat-altro', entrata: 'cat-straordinarie' } as const;

export type RowStatus = 'nuovo' | 'gia-importato' | 'forse-presente';

export interface PreviewRow extends StatementRow {
  key: number;
  importId: string;
  status: RowStatus;
  /** Il movimento già presente che ha fatto scattare il dubbio. */
  match?: Transaction;
  include: boolean;
  type: 'entrata' | 'uscita' | 'trasferimento';
  categoryId?: string;
  otherAccountId?: string;
  fromRule: boolean;
  /** Toccata a mano: le regole non la cambiano più. */
  edited: boolean;
}

export interface PreviewContext {
  accountId: string;
  transactions: Transaction[];
  rules: ImportRule[];
  categories: Category[];
}

/** Quanto il movimento cambia il saldo del conto; null se non lo tocca o se è una rettifica. */
function signedOn(transaction: Transaction, accountId: string): number | null {
  const { amountCents, toAccountId, type } = transaction;
  switch (type) {
    case 'entrata':
      return transaction.accountId === accountId ? amountCents : null;
    case 'uscita':
      return transaction.accountId === accountId ? -amountCents : null;
    case 'trasferimento':
      if (transaction.accountId === accountId) return -amountCents;
      return toAccountId === accountId ? amountCents : null;
    case 'rettifica':
      return null;
  }
}

export function fallbackCategoryId(categories: Category[], kind: 'entrata' | 'uscita'): string | undefined {
  const active = categories.filter((category) => category.kind === kind && !category.archived);
  return active.find(({ id }) => id === FALLBACK_CATEGORIES[kind])?.id ?? active.at(-1)?.id;
}

function categorize(row: StatementRow, rules: ImportRule[], categories: Category[]) {
  const kind = row.amountCents < 0 ? 'uscita' : 'entrata';
  const rule = matchRule(rules, categories, row.description, kind);
  return { type: kind, categoryId: rule?.categoryId ?? fallbackCategoryId(categories, kind), fromRule: rule !== null } as const;
}

/**
 * Decide per ogni riga se è nuova.
 * L'identificatore comprende il numero della ripetizione: due caffè uguali nello stesso giorno sono due movimenti,
 * ma reimportando lo stesso file risultano entrambi già presenti.
 */
export function buildPreview(rows: StatementRow[], context: PreviewContext): PreviewRow[] {
  const { accountId, categories, rules, transactions } = context;
  const onAccount = transactions.filter((transaction) => signedOn(transaction, accountId) !== null);
  const byImportId = new Map(onAccount.flatMap((transaction) => (transaction.importId ? [[transaction.importId, transaction] as const] : [])));

  const repetitions = new Map<string, number>();
  const used = new Set<string>();
  const entries = rows.map((row) => {
    const base = `${row.date}|${row.amountCents}|${plainText(row.description)}`;
    const repetition = repetitions.get(base) ?? 0;
    repetitions.set(base, repetition + 1);
    const importId = `${accountId}|${base}|${repetition}`;
    const exact = byImportId.get(importId);
    if (exact) used.add(exact.id);
    return { row, importId, exact };
  });

  const byAmount = new Map<number, Transaction[]>();
  for (const transaction of onAccount) {
    const amount = signedOn(transaction, accountId) ?? 0;
    byAmount.set(amount, [...(byAmount.get(amount) ?? []), transaction]);
  }

  // Dal giorno esatto in poi: la coppia più vicina si forma per prima, e ogni movimento vale per una riga sola.
  const similar = new Map<number, Transaction>();
  for (let distance = 0; distance <= DUPLICATE_WINDOW_DAYS; distance += 1) {
    entries.forEach(({ exact, row }, index) => {
      if (exact || similar.has(index)) return;
      const found = byAmount
        .get(row.amountCents)
        ?.find((transaction) => !used.has(transaction.id) && Math.abs(daysBetween(transaction.date, row.date)) === distance);
      if (found) {
        used.add(found.id);
        similar.set(index, found);
      }
    });
  }

  const preview = entries.map(({ exact, importId, row }, key): PreviewRow => {
    const possible = similar.get(key);
    const base = { ...row, key, importId, edited: false, ...categorize(row, rules, categories) };
    if (exact) return { ...base, status: 'gia-importato', match: exact, include: false };
    if (possible) return { ...base, status: 'forse-presente', match: possible, include: false };
    return { ...base, status: 'nuovo', include: true };
  });
  return preview.sort((a, b) => (a.date === b.date ? a.key - b.key : a.date < b.date ? 1 : -1));
}

/** Dopo una nuova regola: aggiorna le righe, senza toccare quelle cambiate a mano. */
export function applyRules(rows: PreviewRow[], rules: ImportRule[], categories: Category[]): PreviewRow[] {
  return rows.map((row) => (row.edited ? row : { ...row, ...categorize(row, rules, categories) }));
}

export function previewDrafts(rows: PreviewRow[], accountId: string): TransactionDraft[] {
  return rows
    .filter((row) => row.include)
    .map((row): TransactionDraft => {
      const common = { date: row.date, amountCents: Math.abs(row.amountCents), importId: row.importId, note: row.description };
      if (row.type !== 'trasferimento') return { ...common, type: row.type, accountId, categoryId: row.categoryId };
      const outgoing = row.amountCents < 0;
      return {
        ...common,
        type: 'trasferimento',
        accountId: outgoing ? accountId : (row.otherAccountId ?? ''),
        toAccountId: outgoing ? row.otherAccountId : accountId,
      };
    });
}

export interface PreviewSummary {
  count: number;
  incomeCents: number;
  expenseCents: number;
  transfers: number;
}

export function summarizePreview(rows: PreviewRow[]): PreviewSummary {
  const summary: PreviewSummary = { count: 0, incomeCents: 0, expenseCents: 0, transfers: 0 };
  for (const row of rows) {
    if (!row.include) continue;
    summary.count += 1;
    if (row.type === 'trasferimento') summary.transfers += 1;
    else if (row.type === 'entrata') summary.incomeCents += Math.abs(row.amountCents);
    else summary.expenseCents += Math.abs(row.amountCents);
  }
  return summary;
}
