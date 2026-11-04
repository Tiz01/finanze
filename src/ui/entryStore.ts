import type { IsoDate, Recurring, Transaction } from '../domain/types';
import { createStore } from './store';

export interface TransferPreset {
  accountId?: string;
  toAccountId?: string;
}

export type EntryRequest =
  | { mode: 'new'; transfer?: TransferPreset }
  | { mode: 'edit'; transaction: Transaction }
  | { mode: 'recurring'; recurring: Recurring; date: IsoDate };

export const entryStore = createStore<EntryRequest | null>(null);

export function openNewEntry(): void {
  entryStore.set({ mode: 'new' });
}

export function openNewTransfer(transfer: TransferPreset): void {
  entryStore.set({ mode: 'new', transfer });
}

export function openEditEntry(transaction: Transaction): void {
  entryStore.set({ mode: 'edit', transaction });
}

export function openRecurringEntry(recurring: Recurring, date: IsoDate): void {
  entryStore.set({ mode: 'recurring', recurring, date });
}

export function closeEntry(): void {
  entryStore.set(null);
}
