import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, serializeBackup } from '../domain/backup';
import { budgetProgress } from '../domain/budgets';
import { DEFAULT_CATEGORIES } from '../domain/categories';
import { createAccount, type AccountDraft } from './accounts';
import { createBudget, deleteBudget, updateBudget, type BudgetDraft } from './budgets';
import { createCategory, deleteCategory } from './categories';
import { clearAllData, readAllData, replaceAllData } from './data';
import { db } from './db';
import { addTransaction } from './transactions';

const today = '2026-10-30';

const draft: BudgetDraft = { name: ' Casa ', kind: 'tetto', amountCents: 50000, categoryIds: ['cat-casa', 'cat-casa'] };

const accountDraft: AccountDraft = {
  name: 'Corrente',
  type: 'corrente',
  currency: 'EUR',
  initialBalanceCents: 100000,
  initialBalanceDate: '2026-10-01',
  archived: false,
  contaComeLiquidita: true,
};

// Lo schema della prima versione, com'è oggi sui telefoni che devono aggiornarsi.
const VERSION_1_STORES = {
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
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('buste iniziali', () => {
  it('ci sono alla prima apertura, nell’ordine previsto', async () => {
    const budgets = await db.budgets.orderBy('id').toArray();
    expect(budgets).toHaveLength(4);
    const sorted = [...budgets].sort((a, b) => a.order - b.order);
    expect(sorted.map((budget) => budget.name)).toEqual(['Svago + spese', 'Viaggi', 'Spese previste', 'PAC ETF']);
  });

  it('usano solo categorie esistenti', async () => {
    const categoryIds = new Set((await db.categories.toArray()).map((category) => category.id));
    for (const budget of await db.budgets.toArray()) {
      expect(budget.categoryIds.every((id) => categoryIds.has(id))).toBe(true);
    }
  });
});

describe('aggiornamento dalla prima versione', () => {
  async function createVersionOne(prepare: (old: Dexie) => Promise<void>) {
    db.close();
    await Dexie.delete('finanze');
    const old = new Dexie('finanze');
    old.version(1).stores(VERSION_1_STORES);
    await old.open();
    await prepare(old);
    old.close();
    await db.open();
  }

  it('aggiunge le buste iniziali senza toccare i dati', async () => {
    await createVersionOne(async (old) => {
      await old.table('categories').bulkAdd([...DEFAULT_CATEGORIES]);
      await old.table('accounts').add({
        ...accountDraft,
        id: 'a',
        createdAt: '2026-10-01T10:00:00.000Z',
      });
      await old.table('transactions').add({
        id: 't',
        date: today,
        amountCents: 1234,
        type: 'uscita',
        accountId: 'a',
        categoryId: 'cat-ristoranti',
        createdAt: '2026-10-30T10:00:00.000Z',
      });
    });

    expect(await db.accounts.count()).toBe(1);
    expect((await db.transactions.toArray())[0]?.amountCents).toBe(1234);
    expect(await db.categories.count()).toBe(DEFAULT_CATEGORIES.length);
    expect(await db.budgets.count()).toBe(4);

    const [svago] = budgetProgress(
      (await db.budgets.toArray()).filter((budget) => budget.id === 'busta-svago'),
      await readAllData(),
      '2026-10-01',
      today,
    );
    expect(svago?.usedCents).toBe(1234);
  });

  it('toglie le categorie che l’utente aveva eliminato', async () => {
    await createVersionOne(async (old) => {
      await old.table('categories').bulkAdd(DEFAULT_CATEGORIES.filter((category) => category.id !== 'cat-viaggi'));
    });
    expect((await db.budgets.get('busta-viaggi'))?.categoryIds).toEqual([]);
  });

  it('non tocca eventuali buste già presenti', async () => {
    await createVersionOne(async (old) => {
      await old.table('budgets').add({ id: 'mia', name: 'Mia', kind: 'tetto', amountCents: 100, categoryIds: [], order: 1 });
    });
    expect((await db.budgets.toArray()).map((budget) => budget.id)).toEqual(['mia']);
  });
});

describe('gestione delle buste', () => {
  it('crea una busta in fondo, togliendo spazi e doppioni', async () => {
    const id = await createBudget(draft);
    const saved = await db.budgets.get(id);
    expect(saved).toMatchObject({ name: 'Casa', kind: 'tetto', amountCents: 50000, categoryIds: ['cat-casa'], order: 5 });
  });

  it('un obiettivo non ha categorie', async () => {
    const id = await createBudget({ ...draft, kind: 'obiettivo' });
    expect((await db.budgets.get(id))?.categoryIds).toEqual([]);
  });

  it('modifica senza cambiare posizione', async () => {
    await updateBudget('busta-viaggi', { name: 'Vacanze', kind: 'tetto', amountCents: 25000, categoryIds: ['cat-viaggi', 'cat-trasporti'] });
    const saved = await db.budgets.get('busta-viaggi');
    expect(saved).toEqual({
      id: 'busta-viaggi',
      name: 'Vacanze',
      kind: 'tetto',
      amountCents: 25000,
      categoryIds: ['cat-viaggi', 'cat-trasporti'],
      order: 2,
    });
  });

  it('rifiuta nomi vuoti e importi non validi', async () => {
    await expect(createBudget({ ...draft, name: '  ' })).rejects.toThrow(/nome/);
    await expect(createBudget({ ...draft, amountCents: 0 })).rejects.toThrow(/importo/i);
    await expect(createBudget({ ...draft, amountCents: 1.5 })).rejects.toThrow(/importo/i);
    await expect(updateBudget('sparita', draft)).rejects.toThrow(/non esiste/);
  });

  it('elimina una busta', async () => {
    await deleteBudget('busta-pac');
    expect(await db.budgets.get('busta-pac')).toBeUndefined();
  });

  it('eliminare una categoria la toglie dalle buste', async () => {
    const categoryId = await createCategory({
      name: 'Mia',
      kind: 'uscita',
      group: 'Altro',
      emoji: '🎈',
      color: '#0f766e',
      fissa: false,
      archived: false,
    });
    await updateBudget('busta-viaggi', { name: 'Viaggi', kind: 'tetto', amountCents: 20000, categoryIds: ['cat-viaggi', categoryId] });
    await deleteCategory(categoryId);
    expect((await db.budgets.get('busta-viaggi'))?.categoryIds).toEqual(['cat-viaggi']);
  });
});

describe('buste e backup', () => {
  it('esporta e reimporta le buste modificate', async () => {
    await updateBudget('busta-viaggi', { name: 'Vacanze', kind: 'tetto', amountCents: 25000, categoryIds: ['cat-viaggi'] });
    await deleteBudget('busta-pac');
    const text = serializeBackup(buildBackup(await readAllData()));

    await clearAllData();
    expect((await db.budgets.get('busta-viaggi'))?.name).toBe('Viaggi');

    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await replaceAllData(parsed.backup.data);
    expect((await db.budgets.get('busta-viaggi'))?.name).toBe('Vacanze');
    expect(await db.budgets.get('busta-pac')).toBeUndefined();
  });

  it('un backup della prima versione riceve le buste iniziali', async () => {
    const accountId = await createAccount(accountDraft);
    await addTransaction({ date: today, amountCents: 100, type: 'uscita', accountId, categoryId: 'cat-spesa' });
    const file = JSON.parse(serializeBackup(buildBackup(await readAllData())));
    file.schemaVersion = 1;
    file.data.budgets = [];

    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await replaceAllData(parsed.backup.data);
    expect(await db.budgets.count()).toBe(4);
    expect(await db.transactions.count()).toBe(1);
  });
});
