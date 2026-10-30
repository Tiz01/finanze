import { buildDemoData } from '../demo/demoData';
import { BACKUP_TABLES, type BackupData } from '../domain/backup';
import { defaultBudgets } from '../domain/budgets';
import { DEFAULT_CATEGORIES } from '../domain/categories';
import type { IsoDate } from '../domain/types';
import { db } from './db';

export const SETTING_LAST_BACKUP = 'lastBackupAt';
export const SETTING_DEMO = 'demoLoaded';

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export async function readAllData(): Promise<BackupData> {
  return db.transaction('r', db.tables, async () => {
    const [
      accounts,
      transactions,
      categories,
      budgets,
      recurring,
      reconciliations,
      importProfiles,
      importRules,
      holdings,
      settings,
    ] = await Promise.all([
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.categories.toArray(),
      db.budgets.toArray(),
      db.recurring.toArray(),
      db.reconciliations.toArray(),
      db.importProfiles.toArray(),
      db.importRules.toArray(),
      db.holdings.toArray(),
      db.settings.toArray(),
    ]);
    return {
      accounts,
      transactions,
      categories,
      budgets,
      recurring,
      reconciliations,
      importProfiles,
      importRules,
      holdings,
      settings,
    };
  });
}

/** Sostituisce tutti i dati in un'unica transazione: se qualcosa va storto non cambia nulla. */
export async function replaceAllData(data: BackupData): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    for (const name of BACKUP_TABLES) {
      await db.table(name).bulkAdd(data[name]);
    }
    const present = new Set(data.categories.map((category) => category.id));
    const missing = DEFAULT_CATEGORIES.filter((category) => category.system && !present.has(category.id));
    if (missing.length > 0) await db.categories.bulkAdd(missing);
  });
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
    await db.categories.bulkAdd([...DEFAULT_CATEGORIES]);
    await db.budgets.bulkAdd(defaultBudgets(new Set(DEFAULT_CATEGORIES.map(({ id }) => id))));
  });
}

export async function loadDemoData(today: IsoDate): Promise<void> {
  const demo = buildDemoData(today);
  await db.transaction('rw', db.accounts, db.transactions, db.recurring, db.reconciliations, db.settings, async () => {
    const existing = (await db.accounts.count()) + (await db.transactions.count());
    if (existing > 0) throw new Error('I dati demo si possono caricare solo su un’app vuota');
    await db.accounts.bulkAdd(demo.accounts);
    await db.transactions.bulkAdd(demo.transactions);
    await db.recurring.bulkAdd(demo.recurring);
    await db.reconciliations.bulkAdd(demo.reconciliations);
    await db.settings.put({ key: SETTING_DEMO, value: true });
  });
}
