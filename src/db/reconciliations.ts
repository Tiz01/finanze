import { computeBalances } from '../domain/balances';
import { CATEGORY_IDS } from '../domain/categories';
import { isValidIsoDate } from '../domain/dates';
import type { IsoDate, Reconciliation } from '../domain/types';
import { db } from './db';
import type { Undo } from './transactions';

interface ReconcileInput {
  accountId: string;
  date: IsoDate;
  realBalanceCents: number;
  /** Se il saldo non coincide, registra la differenza come rettifica. */
  createAdjustment: boolean;
}

/** Registra il saldo letto dalla banca. Il calcolo avviene qui, sui dati del momento. */
export async function reconcileAccount(input: ReconcileInput): Promise<Undo> {
  const { accountId, date, realBalanceCents, createAdjustment } = input;
  if (!isValidIsoDate(date)) throw new Error('Data non valida');
  if (!Number.isSafeInteger(realBalanceCents)) throw new Error('Saldo non valido');

  return db.transaction('rw', db.accounts, db.transactions, db.reconciliations, async () => {
    const account = await db.accounts.get(accountId);
    if (!account) throw new Error('Il conto non esiste più');
    if (date < account.initialBalanceDate) throw new Error('La data è precedente al saldo iniziale del conto');

    const movements = await db.transactions
      .where('accountId')
      .equals(accountId)
      .or('toAccountId')
      .equals(accountId)
      .toArray();
    const computed = computeBalances([account], movements, date).get(accountId) ?? 0;
    const difference = realBalanceCents - computed;
    if (difference !== 0 && !createAdjustment) throw new Error('Il saldo non coincide con quello calcolato');

    const reconciliation: Reconciliation = { id: crypto.randomUUID(), accountId, date, realBalanceCents };
    if (difference !== 0) {
      reconciliation.adjustmentId = crypto.randomUUID();
      await db.transactions.add({
        id: reconciliation.adjustmentId,
        date,
        amountCents: difference,
        type: 'rettifica',
        accountId,
        categoryId: CATEGORY_IDS.nonTracciato,
        createdAt: new Date().toISOString(),
      });
    }
    await db.reconciliations.add(reconciliation);

    return () =>
      db.transaction('rw', db.transactions, db.reconciliations, async () => {
        await db.reconciliations.delete(reconciliation.id);
        if (reconciliation.adjustmentId) await db.transactions.delete(reconciliation.adjustmentId);
      });
  });
}
