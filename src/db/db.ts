import Dexie, { type Table } from 'dexie';
import { DEFAULT_CATEGORIES } from '../domain/categories';
import type {
  Account,
  Budget,
  Category,
  Holding,
  ImportProfile,
  ImportRule,
  Recurring,
  Reconciliation,
  Setting,
  Transaction,
} from '../domain/types';

class FinanzeDB extends Dexie {
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  categories!: Table<Category, string>;
  budgets!: Table<Budget, string>;
  recurring!: Table<Recurring, string>;
  reconciliations!: Table<Reconciliation, string>;
  importProfiles!: Table<ImportProfile, string>;
  importRules!: Table<ImportRule, string>;
  holdings!: Table<Holding, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super('finanze');
    // Ogni cambio di schema aggiunge una nuova version() con la sua migrazione, senza toccare
    // quelle precedenti, e aumenta SCHEMA_VERSION in domain/backup.ts.
    this.version(1).stores({
      accounts: 'id',
      transactions: 'id, date, type, accountId, toAccountId, categoryId, recurringId, importId, reimbursesId, *tags',
      categories: 'id, kind',
      budgets: 'id',
      recurring: 'id, nextDue',
      reconciliations: 'id, accountId, date',
      importProfiles: 'id',
      importRules: 'id',
      holdings: 'id, accountId, isin',
      settings: 'key',
    });
    this.on('populate', (transaction) => {
      void transaction.table('categories').bulkAdd([...DEFAULT_CATEGORIES]);
    });
  }
}

export const db = new FinanzeDB();
