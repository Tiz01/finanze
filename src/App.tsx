import { useRoute, type Route } from './router';
import { Home } from './screens/Home';
import { Impostazioni } from './screens/Impostazioni';
import { Movimenti } from './screens/Movimenti';
import { Report } from './screens/Report';
import { TabBar } from './ui/TabBar';
import { UpdateBanner } from './ui/UpdateBanner';

const SCREENS: Record<Route, () => React.JSX.Element> = {
  home: Home,
  movimenti: Movimenti,
  report: Report,
  impostazioni: Impostazioni,
};

export function App() {
  const route = useRoute();
  const Screen = SCREENS[route];

  return (
    <div className="app-shell">
      <Screen />
      <UpdateBanner />
      <TabBar current={route} />
    </div>
  );
}
