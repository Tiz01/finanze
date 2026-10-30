import type { Category } from '../domain/types';
import { db } from './db';

export type CategoryDraft = Omit<Category, 'id' | 'order' | 'system'>;

function prepare(draft: CategoryDraft): CategoryDraft {
  const name = draft.name.trim();
  if (!name) throw new Error('Scrivi il nome della categoria');
  if (!draft.emoji) throw new Error('Scegli un’emoji');
  return { ...draft, name, group: draft.group.trim() };
}

export async function createCategory(draft: CategoryDraft): Promise<string> {
  const prepared = prepare(draft);
  const id = crypto.randomUUID();
  await db.transaction('rw', db.categories, async () => {
    const last = await db.categories.toCollection().toArray();
    const order = Math.max(0, ...last.map((category) => category.order)) + 1;
    await db.categories.add({ ...prepared, id, order, system: false });
  });
  return id;
}

export async function updateCategory(id: string, draft: CategoryDraft): Promise<void> {
  const prepared = prepare(draft);
  await db.transaction('rw', db.categories, async () => {
    const previous = await db.categories.get(id);
    if (!previous) throw new Error('La categoria non esiste più');
    await db.categories.put({ ...previous, ...prepared });
  });
}

export async function deleteCategory(id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.transactions, db.recurring, db.budgets, async () => {
    const category = await db.categories.get(id);
    if (!category) return;
    if (category.system) throw new Error('Questa categoria serve ai report: puoi solo rinominarla');
    const usedByRecurring = await db.recurring.filter(({ template }) => template.categoryId === id).count();
    if (usedByRecurring > 0) throw new Error('La categoria è usata da una ricorrenza: togli prima quella');
    const used = await db.transactions.where('categoryId').equals(id).count();
    if (used > 0) throw new Error('La categoria ha dei movimenti: puoi solo archiviarla');
    await db.categories.delete(id);
    await db.budgets
      .filter((budget) => budget.categoryIds.includes(id))
      .modify((budget) => {
        budget.categoryIds = budget.categoryIds.filter((categoryId) => categoryId !== id);
      });
  });
}
