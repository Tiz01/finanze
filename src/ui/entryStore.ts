import type { Transaction } from '../domain/types';
import { createStore } from './store';

export type EntryRequest = { mode: 'new' } | { mode: 'edit'; transaction: Transaction };

export const entryStore = createStore<EntryRequest | null>(null);

export function openNewEntry(): void {
  entryStore.set({ mode: 'new' });
}

export function openEditEntry(transaction: Transaction): void {
  entryStore.set({ mode: 'edit', transaction });
}

export function closeEntry(): void {
  entryStore.set(null);
}
