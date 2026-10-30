import { compareNewestFirst } from './transactions';
import type { Account, Category, Transaction, TransactionType } from './types';

const TYPE_LABELS: Record<TransactionType, string> = {
  entrata: 'Entrata',
  uscita: 'Uscita',
  trasferimento: 'Trasferimento',
  rettifica: 'Rettifica',
};

const HEADER = ['Data', 'Tipo', 'Importo', 'Conto', 'Conto di destinazione', 'Categoria', 'Nota', 'Tag'];

function textCell(value: string): string {
  // Excel eseguirebbe come formula un testo che inizia con questi caratteri.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function amountCell(cents: number): string {
  const abs = Math.abs(cents);
  const decimals = String(abs % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)},${decimals}`;
}

/** Separatore `;`, virgola decimale e BOM: è il formato che Excel in italiano apre senza passaggi. */
export function transactionsToCsv(
  transactions: Transaction[],
  accounts: Account[],
  categories: Category[],
): string {
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  const rows = [...transactions].sort(compareNewestFirst).map((transaction) =>
    [
      transaction.date,
      TYPE_LABELS[transaction.type],
      amountCell(transaction.amountCents),
      textCell(accountNames.get(transaction.accountId) ?? ''),
      textCell(transaction.toAccountId ? (accountNames.get(transaction.toAccountId) ?? '') : ''),
      textCell(transaction.categoryId ? (categoryNames.get(transaction.categoryId) ?? '') : ''),
      textCell(transaction.note ?? ''),
      textCell((transaction.tags ?? []).join(', ')),
    ].join(';'),
  );
  return `﻿${[HEADER.join(';'), ...rows].join('\r\n')}\r\n`;
}
