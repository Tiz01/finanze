import type { ImportMapping, ImportProfile, ImportRule, Transaction, TransactionDraft } from '../domain/types';
import { db } from './db';
import { prepareDraft, type Undo } from './transactions';

/** Tutto o niente. Salta chi ha già quell'identificatore: un secondo tocco su Importa non crea doppioni. */
export async function importMovements(drafts: TransactionDraft[]): Promise<{ count: number; undo: Undo }> {
  const prepared = drafts.map(prepareDraft);
  return db.transaction('rw', db.transactions, async () => {
    const importIds = prepared.flatMap((draft) => (draft.importId ? [draft.importId] : []));
    const existing = await db.transactions.where('importId').anyOf(importIds).toArray();
    const known = new Set(existing.map((transaction) => transaction.importId));
    const now = Date.now();
    const rows = prepared
      .filter((draft) => !draft.importId || !known.has(draft.importId))
      .map((draft, index): Transaction => ({ ...draft, id: crypto.randomUUID(), createdAt: new Date(now + index).toISOString() }));
    await db.transactions.bulkAdd(rows);
    const ids = rows.map((row) => row.id);
    return { count: rows.length, undo: () => db.transactions.bulkDelete(ids) };
  });
}

export interface ProfileDraft {
  name: string;
  signature: string;
  mapping: ImportMapping;
  accountId?: string;
}

/** Una mappatura per banca: se le intestazioni sono le stesse aggiorna quella che c'è già. */
export async function saveProfile(draft: ProfileDraft, id?: string): Promise<string> {
  const name = draft.name.trim();
  if (!name) throw new Error('Scrivi il nome della banca');
  return db.transaction('rw', db.importProfiles, async () => {
    const sameFile = draft.signature
      ? await db.importProfiles.filter((profile) => profile.signature === draft.signature).first()
      : undefined;
    const profileId = id ?? sameFile?.id ?? crypto.randomUUID();
    const profile: ImportProfile = { id: profileId, name, signature: draft.signature, mapping: draft.mapping };
    if (draft.accountId) profile.accountId = draft.accountId;
    await db.importProfiles.put(profile);
    return profileId;
  });
}

export async function renameProfile(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Scrivi il nome della banca');
  await db.importProfiles.update(id, { name: trimmed });
}

export async function deleteProfile(id: string): Promise<void> {
  await db.importProfiles.delete(id);
}

export type RuleDraft = Omit<ImportRule, 'id'>;

function prepareRule(draft: RuleDraft): RuleDraft {
  const contains = draft.contains.trim();
  if (!contains) throw new Error('Scrivi il testo da cercare');
  if (draft.transferAccountId) return { contains, transferAccountId: draft.transferAccountId };
  if (!draft.categoryId) throw new Error('Scegli la categoria');
  return { contains, categoryId: draft.categoryId };
}

export async function createRule(draft: RuleDraft): Promise<ImportRule> {
  const rule = { ...prepareRule(draft), id: crypto.randomUUID() };
  await db.importRules.add(rule);
  return rule;
}

export async function updateRule(id: string, draft: RuleDraft): Promise<void> {
  await db.importRules.put({ ...prepareRule(draft), id });
}

export async function deleteRule(id: string): Promise<void> {
  await db.importRules.delete(id);
}
