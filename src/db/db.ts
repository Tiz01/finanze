import Dexie, { type Table } from 'dexie';
import { defaultBudgets } from '../domain/budgets';
import { DEFAULT_CATEGORIES } from '../domain/categories';
import type {
  Account,
  Budget,
  Category,
  Holding,
  HoldingSnapshot,
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
  holdingSnapshots!: Table<HoldingSnapshot, string>;
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
    // La prima versione non permetteva di creare buste: chi aggiorna riceve quelle iniziali.
    this.version(2)
      .stores({})
      .upgrade(async (transaction) => {
        const budgets = transaction.table('budgets');
        if ((await budgets.count()) > 0) return;
        const categoryIds = await transaction.table('categories').toCollection().primaryKeys();
        await budgets.bulkAdd(defaultBudgets(new Set(categoryIds as string[])));
      });
    // Gli aggiornamenti di quote e prezzi degli investimenti: finora non si potevano inserire.
    this.version(3).stores({ holdingSnapshots: 'id, holdingId, date' });
    // Prezzi automatici: cambia il contenuto delle righe, non le tabelle.
    this.version(4).stores({});
    this.on('populate', (transaction) => {
      void transaction.table('categories').bulkAdd([...DEFAULT_CATEGORIES]);
      void transaction.table('budgets').bulkAdd(defaultBudgets(new Set(DEFAULT_CATEGORIES.map(({ id }) => id))));
    });
  }
}

export const db = new FinanzeDB();
