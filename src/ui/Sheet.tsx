import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Occupa tutta l'altezza disponibile. */
  tall?: boolean;
  /** Il contenuto gestisce da sé scorrimento e margini. */
  bare?: boolean;
}

export function Sheet({ title, onClose, children, tall = false, bare = false }: SheetProps) {
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Chiudi"
        onClick={onClose}
        className="sheet-backdrop absolute inset-0 bg-black/40"
      />
      {/* Il margine in alto tiene il pannello fuori dalla zona che iOS sfoca sotto la barra di stato. */}
      <div
        className={`sheet-panel relative flex max-h-[calc(100%-2.5rem)] flex-col rounded-t-3xl bg-surface ${
          tall ? 'h-full' : ''
        }`}
      >
        <header className="flex items-center justify-between gap-3 px-page pt-3 pb-2">
          <h2 className="truncate text-lg font-bold">{title}</h2>
          <button
            type="button"
            aria-label="Chiudi"
            onClick={onClose}
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted"
          >
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        {bare ? (
          children
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-page pb-safe-4">{children}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
