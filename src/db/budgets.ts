import type { Budget } from '../domain/types';
import { db } from './db';

export type BudgetDraft = Omit<Budget, 'id' | 'order'>;

function prepare(draft: BudgetDraft): BudgetDraft {
  const name = draft.name.trim();
  if (!name) throw new Error('Scrivi il nome della busta');
  if (!Number.isSafeInteger(draft.amountCents) || draft.amountCents <= 0) {
    throw new Error('L’importo deve essere maggiore di zero');
  }
  const onAccount = Boolean(draft.accountId);
  return {
    name,
    kind: draft.kind,
    amountCents: draft.amountCents,
    categoryIds: draft.kind === 'obiettivo' || onAccount ? [] : [...new Set(draft.categoryIds)],
    ...(onAccount ? { accountId: draft.accountId } : {}),
  };
}

export async function createBudget(draft: BudgetDraft): Promise<string> {
  const prepared = prepare(draft);
  const id = crypto.randomUUID();
  await db.transaction('rw', db.budgets, async () => {
    const existing = await db.budgets.toArray();
    const order = Math.max(0, ...existing.map((budget) => budget.order)) + 1;
    await db.budgets.add({ ...prepared, id, order });
  });
  return id;
}

export async function updateBudget(id: string, draft: BudgetDraft): Promise<void> {
  const prepared = prepare(draft);
  await db.transaction('rw', db.budgets, async () => {
    const previous = await db.budgets.get(id);
    if (!previous) throw new Error('La busta non esiste più');
    await db.budgets.put({ ...prepared, id, order: previous.order });
  });
}

export async function deleteBudget(id: string): Promise<void> {
  await db.budgets.delete(id);
}
