import { useEffect } from 'react';
import { dismissFeedback, undoLastAction, useFeedback } from './feedback';

const VISIBLE_MS = 6000;

export function ToastHost() {
  const { current } = useFeedback();

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => dismissFeedback(current.id), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-50 flex justify-center px-page">
      <div
        role="status"
        className={`pointer-events-auto flex min-h-12 max-w-full items-center gap-3 rounded-2xl px-4 py-2 text-sm shadow-lg ${
          current.error ? 'bg-danger text-on-danger' : 'bg-ink text-surface'
        }`}
      >
        <span>{current.message}</span>
        {current.undo && (
          <button type="button" onClick={() => void undoLastAction()} className="min-h-10 shrink-0 px-1 font-semibold underline">
            Annulla
          </button>
        )}
      </div>
    </div>
  );
}
