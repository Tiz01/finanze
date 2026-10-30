import type { ReactNode } from 'react';

// Il titolo parte più in basso perché iOS sfoca i primi 32 punti circa sotto la barra di stato.
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <header className="border-b border-line bg-surface pt-safe">
        <h1 className="px-page pt-8 pb-3 text-2xl font-bold">{title}</h1>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-page py-4">
        {children}
      </main>
    </>
  );
}

export function ComingSoon({ phase }: { phase: number }) {
  return <p className="pt-8 text-center text-muted">Questa schermata arriva con la fase {phase}.</p>;
}
