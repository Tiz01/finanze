import { isValidIsoDate } from '../domain/dates';
import { firstOccurrenceOnOrAfter, nextOccurrence, validateRule } from '../domain/recurring';
import { validateTransaction } from '../domain/transactions';
import type { IsoDate, Recurring, RecurringRule, TransactionDraft } from '../domain/types';
import { db } from './db';
import { prepareDraft, type Undo } from './transactions';

export type RecurringDraft = Omit<Recurring, 'id' | 'nextDue'>;

function prepare(draft: RecurringDraft): RecurringDraft {
  const name = draft.name.trim();
  if (!name) throw new Error('Scrivi il nome della ricorrenza');
  if (!isValidIsoDate(draft.anchorDate)) throw new Error('Data della prima scadenza non valida');
  const ruleProblem = validateRule(draft);
  if (ruleProblem) throw new Error(ruleProblem);
  const templateProblem = validateTransaction({ ...draft.template, date: draft.anchorDate });
  if (templateProblem) throw new Error(templateProblem);

  const { type, amountCents, accountId, toAccountId, categoryId } = draft.template;
  const prepared: RecurringDraft = {
    name,
    frequency: draft.frequency,
    anchorDate: draft.anchorDate,
    active: draft.active,
    template: { type, amountCents, accountId },
  };
  if (toAccountId) prepared.template.toAccountId = toAccountId;
  if (categoryId) prepared.template.categoryId = categoryId;
  if (draft.frequency === 'personalizzata') {
    prepared.interval = draft.interval;
    prepared.intervalUnit = draft.intervalUnit;
  }
  return prepared;
}

export async function createRecurring(draft: RecurringDraft): Promise<string> {
  const prepared = prepare(draft);
  const id = crypto.randomUUID();
  await db.recurring.add({ ...prepared, id, nextDue: prepared.anchorDate });
  return id;
}

function sameRule(a: RecurringRule, b: RecurringRule): boolean {
  return (
    a.frequency === b.frequency &&
    a.anchorDate === b.anchorDate &&
    a.interval === b.interval &&
    a.intervalUnit === b.intervalUnit
  );
}

export async function updateRecurring(id: string, draft: RecurringDraft): Promise<void> {
  const prepared = prepare(draft);
  await db.transaction('rw', db.recurring, async () => {
    const previous = await db.recurring.get(id);
    if (!previous) throw new Error('La ricorrenza non esiste più');
    // Cambiando le date non si torna indietro: ciò che è già stato gestito resta gestito.
    const nextDue = sameRule(previous, prepared)
      ? previous.nextDue
      : firstOccurrenceOnOrAfter(prepared, previous.nextDue);
    await db.recurring.put({ ...prepared, id, nextDue });
  });
}

export async function deleteRecurring(id: string): Promise<void> {
  await db.recurring.delete(id);
}

function defaultDraft(recurring: Recurring, date: IsoDate): TransactionDraft {
  return { ...recurring.template, date, note: recurring.name };
}

async function advance(recurring: Recurring, occurrence: IsoDate): Promise<void> {
  await db.recurring.update(recurring.id, { nextDue: nextOccurrence(recurring, occurrence) });
}

async function loadDue(id: string, occurrence: IsoDate): Promise<Recurring> {
  const recurring = await db.recurring.get(id);
  if (!recurring) throw new Error('La ricorrenza non esiste più');
  // Protegge dal doppio tocco: la stessa scadenza non crea due movimenti.
  if (recurring.nextDue !== occurrence) throw new Error('Questa scadenza è già stata gestita');
  return recurring;
}

/** Crea il movimento della scadenza, così com'è oppure con le modifiche passate in `draft`. */
export async function confirmOccurrence(id: string, occurrence: IsoDate, draft?: TransactionDraft): Promise<Undo> {
  return db.transaction('rw', db.recurring, db.transactions, async () => {
    const recurring = await loadDue(id, occurrence);
    const movementId = crypto.randomUUID();
    await db.transactions.add({
      ...prepareDraft(draft ?? defaultDraft(recurring, occurrence)),
      recurringId: id,
      id: movementId,
      createdAt: new Date().toISOString(),
    });
    await advance(recurring, occurrence);
    return () =>
      db.transaction('rw', db.recurring, db.transactions, async () => {
        await db.transactions.delete(movementId);
        await db.recurring.update(id, { nextDue: occurrence });
      });
  });
}

export async function skipOccurrence(id: string, occurrence: IsoDate): Promise<Undo> {
  return db.transaction('rw', db.recurring, async () => {
    const recurring = await loadDue(id, occurrence);
    await advance(recurring, occurrence);
    return () => db.recurring.update(id, { nextDue: occurrence }).then(() => undefined);
  });
}
