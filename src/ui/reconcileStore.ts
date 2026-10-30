import type { IsoDate } from '../domain/types';
import { createStore } from './store';

export interface ReconcileRequest {
  accountId: string;
  date: IsoDate;
  /** Il saldo letto dalla banca, una volta inserito. */
  realBalanceCents: number | null;
  /** False mentre si cerca il movimento mancante nella lista: la verifica resta in sospeso. */
  open: boolean;
}

export const reconcileStore = createStore<ReconcileRequest | null>(null);

export function openReconcile(accountId: string, today: IsoDate): void {
  reconcileStore.set({ accountId, date: today, realBalanceCents: null, open: true });
}

export function resumeReconcile(): void {
  const request = reconcileStore.get();
  if (request) reconcileStore.set({ ...request, open: true });
}

export function closeReconcile(): void {
  reconcileStore.set(null);
}
