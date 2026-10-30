import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Account, Category, Transaction } from '../domain/types';
import { SETTING_DEMO, SETTING_LAST_BACKUP } from './data';
import { db } from './db';

export interface AppData {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  settings: {
    demoLoaded: boolean;
    lastBackupAt?: string;
  };
}

const DataContext = createContext<AppData | null>(null);

// I dati stanno in memoria per tutta la sessione: il foglio "+" deve aprirsi senza attese.
export function DataProvider({ children }: { children: ReactNode }) {
  const accounts = useLiveQuery(() => db.accounts.toArray());
  const categories = useLiveQuery(() => db.categories.toArray());
  const transactions = useLiveQuery(() => db.transactions.toArray());
  const settings = useLiveQuery(() => db.settings.toArray());

  const value = useMemo<AppData | null>(() => {
    if (!accounts || !categories || !transactions || !settings) return null;
    const read = (key: string) => settings.find((row) => row.key === key)?.value;
    const lastBackupAt = read(SETTING_LAST_BACKUP);
    return {
      accounts: [...accounts].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      categories: [...categories].sort((a, b) => a.order - b.order),
      transactions,
      settings: {
        demoLoaded: read(SETTING_DEMO) === true,
        lastBackupAt: typeof lastBackupAt === 'string' ? lastBackupAt : undefined,
      },
    };
  }, [accounts, categories, transactions, settings]);

  if (!value) return <main className="min-h-0 flex-1 bg-bg" />;
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): AppData {
  const data = useContext(DataContext);
  if (!data) throw new Error('useData va usato dentro DataProvider');
  return data;
}
