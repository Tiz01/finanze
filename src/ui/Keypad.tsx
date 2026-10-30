import type { KeypadKey } from '../domain/money';

const KEYS: readonly KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'];

export function Keypad({ onKey }: { onKey: (key: KeypadKey) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={key === 'back' ? 'Cancella' : undefined}
          // Al tocco e non al click: digitando veloce iOS scarta i click di dita che si sovrappongono.
          onPointerDown={(event) => {
            event.preventDefault();
            onKey(key);
          }}
          onClick={(event) => {
            if (event.detail === 0) onKey(key);
          }}
          className="flex h-13 items-center justify-center rounded-xl bg-bg text-2xl font-medium active:bg-line"
        >
          {key === 'back' ? (
            <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7 6-7zM17 9.5l-5 5M12 9.5l5 5" />
            </svg>
          ) : (
            key
          )}
        </button>
      ))}
    </div>
  );
}
