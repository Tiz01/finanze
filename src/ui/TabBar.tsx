import type { ReactNode } from 'react';
import { routeHref, type Tab } from '../router';
import { openNewEntry } from './entryStore';

const ICONS: Record<Tab, ReactNode> = {
  home: <path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5" />,
  movimenti: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  report: <path d="M5 20v-7M12 20V5M19 20v-10" />,
  impostazioni: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />,
};

const LABELS: Record<Tab, string> = {
  home: 'Home',
  movimenti: 'Movimenti',
  report: 'Report',
  impostazioni: 'Impostazioni',
};

function TabLink({ tab, current }: { tab: Tab; current: Tab }) {
  const active = tab === current;
  return (
    <a
      href={routeHref(tab)}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
        active ? 'text-accent' : 'text-muted'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICONS[tab]}
      </svg>
      {LABELS[tab]}
    </a>
  );
}

export function TabBar({ current }: { current: Tab }) {
  return (
    <nav aria-label="Schermate" className="border-t border-line bg-surface pb-safe">
      <div className="grid grid-cols-5 items-center px-1 pt-1">
        <TabLink tab="home" current={current} />
        <TabLink tab="movimenti" current={current} />
        <div className="flex justify-center">
          <button
            type="button"
            aria-label="Nuovo movimento"
            onClick={openNewEntry}
            className="flex size-12 items-center justify-center rounded-full bg-accent text-on-accent active:opacity-80"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <TabLink tab="report" current={current} />
        <TabLink tab="impostazioni" current={current} />
      </div>
    </nav>
  );
}
