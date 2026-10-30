import { daysBetween } from './dates';
import type { Account, IsoDate, Reconciliation } from './types';

/**
 * L'ultima data in cui il saldo del conto è stato confrontato con la banca.
 * Anche il saldo iniziale conta: è stato letto dalla banca quando il conto è stato creato.
 */
export function lastVerifiedDate(account: Account, reconciliations: Reconciliation[]): IsoDate {
  let latest = account.initialBalanceDate;
  for (const { accountId, date } of reconciliations) {
    if (accountId === account.id && date > latest) latest = date;
  }
  return latest;
}

export function verifiedLabel(verifiedOn: IsoDate, today: IsoDate): string {
  const days = daysBetween(verifiedOn, today);
  if (days <= 0) return 'verificato oggi';
  if (days === 1) return 'verificato ieri';
  return `verificato ${days} giorni fa`;
}
