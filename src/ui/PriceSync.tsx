import { useEffect, useMemo } from 'react';
import { useData } from '../db/DataProvider';
import { activeHoldings } from '../domain/investments';
import { syncPrices } from '../quotes';
import { useToday } from './useToday';

/** Tiene aggiornati i prezzi automatici quando l'app si apre o torna in primo piano. */
export function PriceSync() {
  const { accounts, holdings } = useData();
  const today = useToday();
  const active = useMemo(() => activeHoldings(holdings, accounts), [accounts, holdings]);

  useEffect(() => {
    const run = () => {
      if (document.visibilityState === 'visible') void syncPrices(active, today);
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [active, today]);

  return null;
}
