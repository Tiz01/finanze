import { DataProvider } from './db/DataProvider';
import { tabOf, useRoute, type Route } from './router';
import { Home } from './screens/Home';
import { Impostazioni } from './screens/Impostazioni';
import { Movimenti } from './screens/Movimenti';
import { Report } from './screens/Report';
import { Categorie } from './screens/settings/Categorie';
import { Conti } from './screens/settings/Conti';
import { Dati } from './screens/settings/Dati';
import { Ricorrenze } from './screens/settings/Ricorrenze';
import { EntrySheet } from './ui/EntrySheet';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { ReconcileSheet } from './ui/ReconcileSheet';
import { TabBar } from './ui/TabBar';
import { ToastHost } from './ui/ToastHost';
import { UpdateBanner } from './ui/UpdateBanner';

const SCREENS: Record<Route, () => React.JSX.Element> = {
  home: Home,
  movimenti: Movimenti,
  report: Report,
  impostazioni: Impostazioni,
  'impostazioni/conti': Conti,
  'impostazioni/categorie': Categorie,
  'impostazioni/ricorrenze': Ricorrenze,
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
          <Screen />
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
