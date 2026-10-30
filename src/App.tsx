import { lazy, Suspense, type ComponentType } from 'react';
import { DataProvider } from './db/DataProvider';
import { tabOf, useRoute, type Route } from './router';
import { Home } from './screens/Home';
import { Impostazioni } from './screens/Impostazioni';
import { Movimenti } from './screens/Movimenti';
import { Buste } from './screens/settings/Buste';
import { Categorie } from './screens/settings/Categorie';
import { Conti } from './screens/settings/Conti';
import { Dati } from './screens/settings/Dati';
import { Regole } from './screens/settings/Regole';
import { Ricorrenze } from './screens/settings/Ricorrenze';
import { EntrySheet } from './ui/EntrySheet';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { ReconcileSheet } from './ui/ReconcileSheet';
import { TabBar } from './ui/TabBar';
import { ToastHost } from './ui/ToastHost';
import { UpdateBanner } from './ui/UpdateBanner';

// A parte, così la libreria dei grafici si carica solo quando serve.
const Report = lazy(() => import('./screens/Report').then((module) => ({ default: module.Report })));
const Investimenti = lazy(() => import('./screens/Investimenti').then((module) => ({ default: module.Investimenti })));
// Anche la lettura dei file delle banche: serve di rado.
const Importa = lazy(() => import('./screens/settings/Importa').then((module) => ({ default: module.Importa })));

const SCREENS: Record<Route, ComponentType> = {
  home: Home,
  'home/investimenti': Investimenti,
  movimenti: Movimenti,
  report: Report,
  impostazioni: Impostazioni,
  'impostazioni/conti': Conti,
  'impostazioni/categorie': Categorie,
  'impostazioni/buste': Buste,
  'impostazioni/ricorrenze': Ricorrenze,
  'impostazioni/import': Importa,
  'impostazioni/regole': Regole,
  'impostazioni/dati': Dati,
};

export function App() {
  const route = useRoute();
  const Screen = SCREENS[route];

  return (
    <div className="app-shell">
      {/* Barra in basso e aggiornamenti restano fuori: un errore non deve impedire di ricevere una correzione. */}
      <ErrorBoundary key={route}>
        <DataProvider>
          <Suspense fallback={<main className="min-h-0 flex-1" />}>
            <Screen />
          </Suspense>
          <EntrySheet />
          <ReconcileSheet />
        </DataProvider>
      </ErrorBoundary>
      <UpdateBanner />
      <TabBar current={tabOf(route)} />
      <ToastHost />
    </div>
  );
}
