import { CATEGORY_IDS } from '../domain/categories';
import { interestStatus, interestTermsProblem, type InterestCredit } from '../domain/interest';
import type { Account, InterestTerms, IsoDate, Transaction } from '../domain/types';
import { validateTransaction } from '../domain/transactions';
import { db } from './db';
import type { Undo } from './transactions';

/** Il conto diventa remunerato tenendo saldo e movimenti. Cambiare le condizioni non tocca gli accrediti già registrati. */
export async function setAccountInterest(
  accountId: string,
  terms: InterestTerms,
  fields: Pick<Account, 'contaComeLiquidita'>,
): Promise<void> {
  const problem = interestTermsProblem(terms);
  if (problem) throw new Error(problem);
  await db.transaction('rw', db.accounts, db.holdings, async () => {
    const account = await db.accounts.get(accountId);
    if (!account) throw new Error('Il conto non esiste più');
    if ((await db.holdings.where('accountId').equals(accountId).count()) > 0) {
      throw new Error('Il conto ha degli strumenti: togli prima quelli');
    }
    const { creditedThrough } = account.interest ?? {};
    await db.accounts.put({
      ...account,
      ...fields,
      type: 'remunerato',
      interest: { ...terms, ...(creditedThrough ? { creditedThrough } : {}) },
    });
  });
}

/** Il calcolo avviene qui, sui dati del momento. */
async function settle(
  accountId: string,
  today: IsoDate,
  choose: (pending: InterestCredit[]) => { last: InterestCredit; add: Transaction[] },
): Promise<Undo> {
  return db.transaction('rw', db.accounts, db.transactions, async () => {
    const account = await db.accounts.get(accountId);
    if (!account?.interest) throw new Error('Il conto non è più remunerato');
    const movements = await db.transactions.where('accountId').equals(accountId).or('toAccountId').equals(accountId).toArray();
    const pending = interestStatus(account, movements, today)?.pending ?? [];
    if (pending.length === 0) throw new Error('Non ci sono interessi da registrare');

    const { add, last } = choose(pending);
    await db.transactions.bulkAdd(add);
    await db.accounts.put({ ...account, interest: { ...account.interest, creditedThrough: last.date } });

    return () =>
      db.transaction('rw', db.accounts, db.transactions, async () => {
        await db.transactions.bulkDelete(add.map(({ id }) => id));
        await db.accounts.put(account);
      });
  });
}

function interestMovement(accountId: string, date: IsoDate, amountCents: number): Transaction {
  const movement: Transaction = {
    id: crypto.randomUUID(),
    date,
    amountCents,
    type: 'entrata',
    accountId,
    categoryId: CATEGORY_IDS.interessi,
    note: 'Interessi',
    createdAt: new Date().toISOString(),
  };
  const problem = validateTransaction(movement);
  if (problem) throw new Error(problem);
  return movement;
}

function firstOf(pending: InterestCredit[]): InterestCredit {
  const first = pending[0];
  if (!first) throw new Error('Non ci sono interessi da registrare');
  return first;
}

/** Registra il primo accredito in sospeso. Importo e data si possono correggere con quelli della banca. */
export function confirmInterest(
  accountId: string,
  today: IsoDate,
  correction?: { date: IsoDate; amountCents: number },
): Promise<Undo> {
  return settle(accountId, today, (pending) => {
    const last = firstOf(pending);
    return { last, add: [interestMovement(accountId, correction?.date ?? last.date, correction?.amountCents ?? last.netCents)] };
  });
}

export function confirmAllInterest(accountId: string, today: IsoDate): Promise<Undo> {
  return settle(accountId, today, (pending) => ({
    last: pending.at(-1) ?? firstOf(pending),
    add: pending.map(({ date, netCents }) => interestMovement(accountId, date, netCents)),
  }));
}

/** La banca non ha pagato quel periodo: si passa al successivo senza registrare niente. */
export function skipInterest(accountId: string, today: IsoDate): Promise<Undo> {
  return settle(accountId, today, (pending) => ({ last: firstOf(pending), add: [] }));
}
