import { validateTransaction } from '../domain/transactions';
import type { IsoDate, Transaction, TransactionDraft } from '../domain/types';
import { db } from './db';

/** Annulla l'azione appena compiuta, ripristinando esattamente lo stato precedente. */
export type Undo = () => Promise<void>;

function prepare(draft: TransactionDraft): TransactionDraft {
  const problem = validateTransaction(draft);
  if (problem) throw new Error(problem);
  const prepared: TransactionDraft = {
    date: draft.date,
    amountCents: draft.amountCents,
    type: draft.type,
    accountId: draft.accountId,
  };
  if (draft.toAccountId) prepared.toAccountId = draft.toAccountId;
  if (draft.categoryId) prepared.categoryId = draft.categoryId;
  const note = draft.note?.trim();
  if (note) prepared.note = note;
  if (draft.tags && draft.tags.length > 0) prepared.tags = draft.tags;
  if (draft.recurringId) prepared.recurringId = draft.recurringId;
  if (draft.importId) prepared.importId = draft.importId;
  if (draft.reimbursesId) prepared.reimbursesId = draft.reimbursesId;
  return prepared;
}

async function assertReimbursedExpense(draft: TransactionDraft): Promise<void> {
  if (!draft.reimbursesId) return;
  const expense = await db.transactions.get(draft.reimbursesId);
  if (expense?.type !== 'uscita') throw new Error('La spesa da rimborsare non esiste più');
}

async function unlinkRefunds(expenseId: string): Promise<string[]> {
  const refunds = await db.transactions.where('reimbursesId').equals(expenseId).toArray();
  await Promise.all(
    refunds.map(({ reimbursesId: _removed, ...refund }) => db.transactions.put(refund)),
  );
  return refunds.map((refund) => refund.id);
}

async function relinkRefunds(expenseId: string, refundIds: string[]): Promise<void> {
  await db.transactions.where('id').anyOf(refundIds).modify({ reimbursesId: expenseId });
}

export async function addTransaction(draft: TransactionDraft): Promise<Undo> {
  const prepared = prepare(draft);
  return db.transaction('rw', db.transactions, async () => {
    await assertReimbursedExpense(prepared);
    const id = crypto.randomUUID();
    await db.transactions.add({ ...prepared, id, createdAt: new Date().toISOString() });
    return () => db.transactions.delete(id);
  });
}

export async function editTransaction(id: string, draft: TransactionDraft): Promise<Undo> {
  const prepared = prepare(draft);
  return db.transaction('rw', db.transactions, async () => {
    const previous = await db.transactions.get(id);
    if (!previous) throw new Error('Il movimento non esiste più');
    await assertReimbursedExpense(prepared);

    // Una spesa che smette di essere tale non può più avere rimborsi collegati.
    const unlinked = previous.type === 'uscita' && prepared.type !== 'uscita' ? await unlinkRefunds(id) : [];
    const edited: Transaction = { ...prepared, id, createdAt: previous.createdAt };
    if (previous.recurringId) edited.recurringId = previous.recurringId;
    if (previous.importId) edited.importId = previous.importId;
    await db.transactions.put(edited);

    return () =>
      db.transaction('rw', db.transactions, async () => {
        await db.transactions.put(previous);
        await relinkRefunds(id, unlinked);
      });
  });
}

export async function deleteTransaction(id: string): Promise<Undo> {
  return db.transaction('rw', db.transactions, async () => {
    const previous = await db.transactions.get(id);
    if (!previous) throw new Error('Il movimento non esiste più');
    const unlinked = await unlinkRefunds(id);
    await db.transactions.delete(id);
    return () =>
      db.transaction('rw', db.transactions, async () => {
        await db.transactions.put(previous);
        await relinkRefunds(id, unlinked);
      });
  });
}

export async function duplicateTransaction(id: string, date: IsoDate): Promise<Undo> {
  const original = await db.transactions.get(id);
  if (!original) throw new Error('Il movimento non esiste più');
  const {
    id: _id,
    createdAt: _createdAt,
    recurringId: _recurringId,
    importId: _importId,
    ...fields
  } = original;
  return addTransaction({ ...fields, date });
}
