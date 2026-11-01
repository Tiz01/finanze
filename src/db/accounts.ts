import { balanceFieldsFor } from '../domain/balances';
import { isValidIsoDate } from '../domain/dates';
import type { Account, IsoDate } from '../domain/types';
import { db } from './db';
import type { Undo } from './transactions';

export type AccountDraft = Omit<Account, 'id' | 'createdAt'>;

function prepare(draft: AccountDraft): AccountDraft {
  const name = draft.name.trim();
  if (!name) throw new Error('Scrivi il nome del conto');
  if (!Number.isSafeInteger(draft.initialBalanceCents)) throw new Error('Saldo iniziale non valido');
  if (!isValidIsoDate(draft.initialBalanceDate)) throw new Error('Data del saldo iniziale non valida');
  return { ...draft, name };
}

export async function createAccount(draft: AccountDraft): Promise<string> {
  const id = crypto.randomUUID();
  await db.accounts.add({ ...prepare(draft), id, createdAt: new Date().toISOString() });
  return id;
}

export async function updateAccount(id: string, draft: AccountDraft): Promise<void> {
  const prepared = prepare(draft);
  await db.transaction('rw', db.accounts, db.holdings, async () => {
    const previous = await db.accounts.get(id);
    if (!previous) throw new Error('Il conto non esiste più');
    if (prepared.type !== 'investimento' && (await db.holdings.where('accountId').equals(id).count()) > 0) {
      throw new Error('Il conto ha degli strumenti: per cambiare tipo togli prima quelli');
    }
    await db.accounts.put({ ...prepared, id, createdAt: previous.createdAt });
  });
}

/** Il saldo di oggi di un conto: da qui in poi contano solo i movimenti nuovi. */
export async function setAccountBalance(id: string, cents: number, today: IsoDate): Promise<Undo> {
  if (!Number.isSafeInteger(cents)) throw new Error('Importo non valido');
  return db.transaction('rw', db.accounts, db.transactions, async () => {
    const account = await db.accounts.get(id);
    if (!account) throw new Error('Il conto non esiste più');
    const movements = await db.transactions.where('accountId').equals(id).or('toAccountId').equals(id).toArray();
    await db.accounts.put({ ...account, ...balanceFieldsFor(account, cents, movements, today) });
    return () => db.accounts.put(account).then(() => undefined);
  });
}

export async function deleteAccount(id: string): Promise<void> {
  const tables = [db.accounts, db.transactions, db.reconciliations, db.recurring, db.budgets, db.importProfiles, db.importRules, db.holdings];
  await db.transaction('rw', tables, async () => {
    const usedByRecurring = await db.recurring
      .filter(({ template }) => template.accountId === id || template.toAccountId === id)
      .count();
    if (usedByRecurring > 0) throw new Error('Il conto è usato da una ricorrenza: togli prima quella');
    const used =
      (await db.transactions.where('accountId').equals(id).count()) +
      (await db.transactions.where('toAccountId').equals(id).count()) +
      (await db.reconciliations.where('accountId').equals(id).count());
    if (used > 0) throw new Error('Il conto ha dei movimenti: puoi solo archiviarlo');
    if ((await db.holdings.where('accountId').equals(id).count()) > 0) {
      throw new Error('Il conto ha degli strumenti: togli prima quelli, oppure archivialo');
    }
    await db.accounts.delete(id);
    await db.budgets
      .filter((budget) => budget.accountId === id)
      .modify((budget) => {
        delete budget.accountId;
      });
    await db.importProfiles
      .filter((profile) => profile.accountId === id)
      .modify((profile) => {
        delete profile.accountId;
      });
    await db.importRules.filter((rule) => rule.transferAccountId === id).delete();
  });
}
