import { useSyncExternalStore } from 'react';

// Routing a hash: GitHub Pages non gestisce le rotte di una single-page app.
export const ROUTES = [
  'home',
  'movimenti',
  'report',
  'impostazioni',
  'impostazioni/conti',
  'impostazioni/categorie',
  'impostazioni/buste',
  'impostazioni/ricorrenze',
  'impostazioni/import',
  'impostazioni/regole',
  'impostazioni/dati',
] as const;
export type Route = (typeof ROUTES)[number];

export type Tab = 'home' | 'movimenti' | 'report' | 'impostazioni';

export function tabOf(route: Route): Tab {
  return route.split('/')[0] as Tab;
}

export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, '');
  return ROUTES.find((route) => route === name) ?? 'home';
}

export function routeHref(route: Route): string {
  return route === 'home' ? '#/' : `#/${route}`;
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.hash));
}
