import type { ReactNode } from 'react';

interface ScreenProps {
  title?: string;
  /** Sostituisce il titolo: la Home mette qui la liquidità. */
  hero?: ReactNode;
  back?: { href: string; label: string };
  action?: ReactNode;
  children: ReactNode;
}

// Il titolo parte più in basso perché iOS sfoca i primi 32 punti circa sotto la barra di stato.
export function Screen({ title, hero, back, action, children }: ScreenProps) {
  return (
    <>
      <header className="border-b border-line bg-surface pt-safe">
        <div className="flex items-end justify-between gap-3 px-page pt-8 pb-3">
          <div className="min-w-0">
            {back && (
              <a href={back.href} className="block py-1 text-sm font-medium text-accent">
                ‹ {back.label}
              </a>
            )}
            {hero ?? <h1 className="truncate text-2xl font-bold">{title}</h1>}
          </div>
          {action}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-bg px-page py-4">{children}</main>
    </>
  );
}

export function ComingSoon({ phase }: { phase: number }) {
  return <p className="pt-8 text-center text-muted">Questa schermata arriva con la fase {phase}.</p>;
}
