import type { Undo } from '../db/transactions';
import { createStore, useStore } from './store';

export interface Feedback {
  id: number;
  message: string;
  error: boolean;
  undo?: Undo;
}

interface FeedbackState {
  current: Feedback | null;
  /** Resta disponibile anche dopo che l'avviso è sparito, finché non arriva un'altra azione. */
  lastUndo: Undo | null;
}

const store = createStore<FeedbackState>({ current: null, lastUndo: null });
let nextId = 1;

export function notify(message: string, undo?: Undo): void {
  const { lastUndo } = store.get();
  store.set({
    current: { id: nextId++, message, error: false, undo },
    lastUndo: undo ?? lastUndo,
  });
}

export function notifyError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Qualcosa è andato storto';
  store.set({ ...store.get(), current: { id: nextId++, message, error: true } });
}

export function dismissFeedback(id: number): void {
  const state = store.get();
  if (state.current?.id === id) store.set({ ...state, current: null });
}

export async function undoLastAction(): Promise<void> {
  const { lastUndo } = store.get();
  if (!lastUndo) return;
  store.set({ current: null, lastUndo: null });
  try {
    await lastUndo();
    notify('Azione annullata');
  } catch (error) {
    notifyError(error);
  }
}

/** Dopo aver sostituito i dati, l'ultima azione non si può più annullare. */
export function forgetUndo(): void {
  store.set({ ...store.get(), lastUndo: null });
}

export function useFeedback(): FeedbackState {
  return useStore(store);
}
