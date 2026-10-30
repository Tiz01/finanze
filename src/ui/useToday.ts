import { useEffect, useState } from 'react';
import { todayIso } from '../domain/dates';

/** La data di oggi, aggiornata al ritorno in primo piano: su iPhone l'app può restare sospesa per giorni. */
export function useToday(): string {
  const [today, setToday] = useState(() => todayIso());

  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'visible') setToday(todayIso());
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return today;
}
