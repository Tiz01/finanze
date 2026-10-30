import type { Account, IsoDate, Transaction } from './types';

/**
 * I saldi non vengono mai salvati: si ricalcolano da saldo iniziale e movimenti.
 * Conta solo ciò che è avvenuto dalla data del saldo iniziale fino ad `asOf`: i movimenti
 * precedenti sono già compresi nel saldo iniziale e restano utili solo per i report.
 */
export function computeBalances(
  accounts: Account[],
  transactions: Transaction[],
  asOf: IsoDate,
): Map<string, number> {
  const balances = new Map<string, number>();
  const startDates = new Map<string, IsoDate>();
  for (const account of accounts) {
    balances.set(account.id, account.initialBalanceCents);
    startDates.set(account.id, account.initialBalanceDate);
  }

  const apply = (accountId: string | undefined, date: IsoDate, delta: number) => {
    if (accountId === undefined) return;
    const start = startDates.get(accountId);
    if (start === undefined || date < start) return;
    balances.set(accountId, (balances.get(accountId) ?? 0) + delta);
  };

  for (const transaction of transactions) {
    if (transaction.date > asOf) continue;
    const { accountId, toAccountId, amountCents, date, type } = transaction;
    switch (type) {
      case 'entrata':
      case 'rettifica':
        apply(accountId, date, amountCents);
        break;
      case 'uscita':
        apply(accountId, date, -amountCents);
        break;
      case 'trasferimento':
        apply(accountId, date, -amountCents);
        apply(toAccountId, date, amountCents);
        break;
    }
  }
  return balances;
}
