import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, SCHEMA_VERSION, serializeBackup } from '../domain/backup';
import { CATEGORY_IDS, DEFAULT_CATEGORIES } from '../domain/categories';
import { computeBalances } from '../domain/balances';
import type { TransactionDraft } from '../domain/types';
import { createAccount, deleteAccount, updateAccount, type AccountDraft } from './accounts';
import { createCategory, deleteCategory, updateCategory, type CategoryDraft } from './categories';
import { clearAllData, loadDemoData, readAllData, replaceAllData, SETTING_DEMO } from './data';
import { db } from './db';
import { addTransaction, deleteTransaction, duplicateTransaction, editTransaction } from './transactions';

const today = '2026-10-30';

const accountDraft: AccountDraft = {
  name: 'Corrente',
  type: 'corrente',
  currency: 'EUR',
  initialBalanceCents: 100000,
  initialBalanceDate: '2026-01-01',
  archived: false,
  contaComeLiquidita: true,
};

const categoryDraft: CategoryDraft = {
  name: 'Mia categoria',
  kind: 'uscita',
  group: 'Altro',
  emoji: '🎈',
  color: '#0f766e',
  fissa: false,
  archived: false,
};

function expense(accountId: string, fields: Partial<TransactionDraft> = {}): TransactionDraft {
  return { date: today, amountCents: 8000, type: 'uscita', accountId, categoryId: 'cat-ristoranti', ...fields };
}

async function onlyTransaction() {
  const all = await db.transactions.toArray();
  expect(all).toHaveLength(1);
  return all[0]!;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('schema', () => {
  it('ha la stessa versione del formato di backup', () => {
    expect(db.verno).toBe(SCHEMA_VERSION);
  });

  it('prevede la tabella holdings, vuota', async () => {
    expect(await db.holdings.count()).toBe(0);
  });

  it('alla prima apertura crea le categorie iniziali', async () => {
    const categories = await db.categories.toArray();
    expect(categories).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(categories.map((category) => category.id)).toContain(CATEGORY_IDS.nonTracciato);
  });
});

describe('movimenti', () => {
  it('salva un movimento e l’annullamento lo toglie', async () => {
    const accountId = await createAccount(accountDraft);
    const undo = await addTransaction(expense(accountId, { note: '  Cena  ', tags: ['amici'] }));
    const saved = await onlyTransaction();
    expect(saved.note).toBe('Cena');
    expect(saved.tags).toEqual(['amici']);
    expect(saved.createdAt).toBeTruthy();
    await undo();
    expect(await db.transactions.count()).toBe(0);
  });

  it('non salva movimenti non validi', async () => {
    const accountId = await createAccount(accountDraft);
    await expect(addTransaction(expense(accountId, { amountCents: 0 }))).rejects.toThrow();
    await expect(addTransaction(expense(accountId, { amountCents: 12.5 }))).rejects.toThrow();
    await expect(addTransaction(expense(accountId, { categoryId: undefined }))).rejects.toThrow();
    expect(await db.transactions.count()).toBe(0);
  });

  it('un trasferimento sposta i soldi senza cambiare il totale', async () => {
    const from = await createAccount(accountDraft);
    const to = await createAccount({ ...accountDraft, name: 'Deposito', initialBalanceCents: 0 });
    await addTransaction({ date: today, amountCents: 50000, type: 'trasferimento', accountId: from, toAccountId: to });
    const balances = computeBalances(await db.accounts.toArray(), await db.transactions.toArray(), today);
    expect(balances.get(from)).toBe(50000);
    expect(balances.get(to)).toBe(50000);
  });

  it('la modifica conserva l’ordine di inserimento e si può annullare', async () => {
    const accountId = await createAccount(accountDraft);
    await addTransaction(expense(accountId, { note: 'Prima' }));
    const before = await onlyTransaction();
    const undo = await editTransaction(before.id, expense(accountId, { note: 'Dopo', amountCents: 100 }));
    const after = await onlyTransaction();
    expect(after.note).toBe('Dopo');
    expect(after.amountCents).toBe(100);
    expect(after.createdAt).toBe(before.createdAt);
    await undo();
    expect(await onlyTransaction()).toEqual(before);
  });

  it('la modifica toglie la nota svuotata', async () => {
    const accountId = await createAccount(accountDraft);
    await addTransaction(expense(accountId, { note: 'Prima' }));
    const before = await onlyTransaction();
    await editTransaction(before.id, expense(accountId, { note: '' }));
    expect((await onlyTransaction()).note).toBeUndefined();
  });

  it('la modifica conserva i collegamenti a ricorrenza e import', async () => {
    const accountId = await createAccount(accountDraft);
    await addTransaction(expense(accountId, { recurringId: 'r', importId: 'i' }));
    const before = await onlyTransaction();
    await editTransaction(before.id, expense(accountId));
    const after = await onlyTransaction();
    expect(after.recurringId).toBe('r');
    expect(after.importId).toBe('i');
  });

  it('l’eliminazione si può annullare', async () => {
    const accountId = await createAccount(accountDraft);
    await addTransaction(expense(accountId));
    const before = await onlyTransaction();
    const undo = await deleteTransaction(before.id);
    expect(await db.transactions.count()).toBe(0);
    await undo();
    expect(await onlyTransaction()).toEqual(before);
  });

  it('la duplicazione crea una copia con la nuova data, senza ricorrenza né import', async () => {
    const accountId = await createAccount(accountDraft);
    await addTransaction(expense(accountId, { note: 'Pizza', recurringId: 'r', importId: 'i', date: '2026-10-01' }));
    const original = await onlyTransaction();
    const undo = await duplicateTransaction(original.id, today);
    const copy = (await db.transactions.toArray()).find((item) => item.id !== original.id)!;
    expect(copy.date).toBe(today);
    expect(copy.note).toBe('Pizza');
    expect(copy.amountCents).toBe(original.amountCents);
    expect(copy.recurringId).toBeUndefined();
    expect(copy.importId).toBeUndefined();
    await undo();
    expect(await onlyTransaction()).toEqual(original);
  });
});

describe('rimborsi', () => {
  async function dinnerWithRefund() {
    const accountId = await createAccount(accountDraft);
    await addTransaction(expense(accountId, { note: 'Cena' }));
    const dinner = await onlyTransaction();
    await addTransaction({
      date: today,
      amountCents: 4000,
      type: 'entrata',
      accountId,
      categoryId: CATEGORY_IDS.rimborsi,
      reimbursesId: dinner.id,
    });
    const refund = (await db.transactions.toArray()).find((item) => item.id !== dinner.id)!;
    return { accountId, dinner, refund };
  }

  it('collega il rimborso alla spesa', async () => {
    const { dinner, refund } = await dinnerWithRefund();
    expect(refund.reimbursesId).toBe(dinner.id);
  });

  it('rifiuta il collegamento a qualcosa che non è una spesa', async () => {
    const { accountId, refund } = await dinnerWithRefund();
    const draft: TransactionDraft = {
      date: today,
      amountCents: 100,
      type: 'entrata',
      accountId,
      categoryId: CATEGORY_IDS.rimborsi,
    };
    await expect(addTransaction({ ...draft, reimbursesId: refund.id })).rejects.toThrow();
    await expect(addTransaction({ ...draft, reimbursesId: 'inesistente' })).rejects.toThrow();
  });

  it('eliminando la spesa il rimborso resta e perde il collegamento; annullando torna tutto', async () => {
    const { dinner, refund } = await dinnerWithRefund();
    const undo = await deleteTransaction(dinner.id);
    expect((await db.transactions.get(refund.id))?.reimbursesId).toBeUndefined();
    await undo();
    expect((await db.transactions.get(refund.id))?.reimbursesId).toBe(dinner.id);
    expect(await db.transactions.get(dinner.id)).toEqual(dinner);
  });

  it('una spesa che cambia tipo perde i rimborsi; annullando tornano', async () => {
    const { accountId, dinner, refund } = await dinnerWithRefund();
    const undo = await editTransaction(dinner.id, {
      date: today,
      amountCents: 8000,
      type: 'entrata',
      accountId,
      categoryId: CATEGORY_IDS.stipendio,
    });
    expect((await db.transactions.get(refund.id))?.reimbursesId).toBeUndefined();
    await undo();
    expect((await db.transactions.get(refund.id))?.reimbursesId).toBe(dinner.id);
    expect((await db.transactions.get(dinner.id))?.type).toBe('uscita');
  });
});

describe('conti', () => {
  it('crea e modifica un conto, senza toccare la data di creazione', async () => {
    const id = await createAccount({ ...accountDraft, name: '  Corrente  ' });
    const created = await db.accounts.get(id);
    expect(created?.name).toBe('Corrente');
    await updateAccount(id, { ...accountDraft, name: 'Nuovo', archived: true });
    const updated = await db.accounts.get(id);
    expect(updated?.name).toBe('Nuovo');
    expect(updated?.archived).toBe(true);
    expect(updated?.createdAt).toBe(created?.createdAt);
  });

  it('rifiuta dati non validi', async () => {
    await expect(createAccount({ ...accountDraft, name: '   ' })).rejects.toThrow();
    await expect(createAccount({ ...accountDraft, initialBalanceCents: 1.5 })).rejects.toThrow();
    await expect(createAccount({ ...accountDraft, initialBalanceDate: '2026-02-30' })).rejects.toThrow();
  });

  it('elimina solo i conti senza movimenti', async () => {
    const used = await createAccount(accountDraft);
    const unused = await createAccount({ ...accountDraft, name: 'Vuoto' });
    const target = await createAccount({ ...accountDraft, name: 'Destinazione' });
    await addTransaction(expense(used));
    await addTransaction({ date: today, amountCents: 100, type: 'trasferimento', accountId: used, toAccountId: target });
    await expect(deleteAccount(used)).rejects.toThrow(/archiviarlo/);
    await expect(deleteAccount(target)).rejects.toThrow(/archiviarlo/);
    await deleteAccount(unused);
    expect(await db.accounts.get(unused)).toBeUndefined();
    expect(await db.accounts.get(used)).toBeDefined();
  });
});

describe('categorie', () => {
  it('aggiunge una categoria in fondo all’ordine', async () => {
    const id = await createCategory(categoryDraft);
    const created = await db.categories.get(id);
    const maxDefault = Math.max(...DEFAULT_CATEGORIES.map((category) => category.order));
    expect(created?.order).toBe(maxDefault + 1);
    expect(created?.system).toBe(false);
  });

  it('modifica senza perdere ordine e sistema', async () => {
    await updateCategory(CATEGORY_IDS.stipendio, { ...categoryDraft, name: 'Paga', kind: 'entrata' });
    const updated = await db.categories.get(CATEGORY_IDS.stipendio);
    expect(updated?.name).toBe('Paga');
    expect(updated?.system).toBe(true);
    expect(updated?.order).toBe(1);
  });

  it('non elimina le categorie di sistema né quelle usate', async () => {
    const accountId = await createAccount(accountDraft);
    await addTransaction(expense(accountId));
    await expect(deleteCategory(CATEGORY_IDS.rimborsi)).rejects.toThrow(/rinominarla/);
    await expect(deleteCategory('cat-ristoranti')).rejects.toThrow(/archiviarla/);
    await deleteCategory('cat-tecnologia');
    expect(await db.categories.get('cat-tecnologia')).toBeUndefined();
  });

  it('rifiuta nomi vuoti', async () => {
    await expect(createCategory({ ...categoryDraft, name: ' ' })).rejects.toThrow();
    await expect(createCategory({ ...categoryDraft, emoji: '' })).rejects.toThrow();
  });
});

describe('backup', () => {
  async function fill() {
    const accountId = await createAccount(accountDraft);
    await addTransaction(expense(accountId, { note: 'Cena', tags: ['amici'] }));
    await createCategory(categoryDraft);
    await db.settings.put({ key: 'lastBackupAt', value: '2026-10-01T10:00:00.000Z' });
  }

  it('esporta e reimporta senza perdere nulla', async () => {
    await fill();
    const before = await readAllData();
    const text = serializeBackup(buildBackup(before));

    await clearAllData();
    expect(await db.accounts.count()).toBe(0);

    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await replaceAllData(parsed.backup.data);

    const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    const after = await readAllData();
    expect(byId(after.accounts)).toEqual(byId(before.accounts));
    expect(byId(after.transactions)).toEqual(byId(before.transactions));
    expect(byId(after.categories)).toEqual(byId(before.categories));
    expect(after.settings).toEqual(before.settings);
  });

  it('l’import sostituisce i dati esistenti', async () => {
    await fill();
    const backup = await readAllData();
    const other = await createAccount({ ...accountDraft, name: 'Da togliere' });
    await replaceAllData(backup);
    expect(await db.accounts.get(other)).toBeUndefined();
    expect(await db.accounts.count()).toBe(1);
  });

  it('se l’import fallisce i dati restano com’erano', async () => {
    await fill();
    const before = await readAllData();
    const broken = { ...before, accounts: [before.accounts[0]!, before.accounts[0]!] };
    await expect(replaceAllData(broken)).rejects.toThrow();
    const after = await readAllData();
    expect(after.accounts).toEqual(before.accounts);
    expect(after.transactions).toEqual(before.transactions);
  });

  it('l’import ripristina le categorie di sistema mancanti', async () => {
    await fill();
    const data = await readAllData();
    const categories = data.categories.filter((category) => !category.system);
    await replaceAllData({ ...data, categories });
    expect(await db.categories.get(CATEGORY_IDS.nonTracciato)).toBeDefined();
    expect(await db.categories.get(CATEGORY_IDS.stipendio)).toBeDefined();
  });

  it('cancellare tutto lascia solo le categorie iniziali', async () => {
    await fill();
    await clearAllData();
    const data = await readAllData();
    expect(data.accounts).toEqual([]);
    expect(data.transactions).toEqual([]);
    expect(data.settings).toEqual([]);
    expect(data.categories).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(data.budgets.map((budget) => budget.id).sort()).toEqual(['busta-pac', 'busta-previste', 'busta-svago', 'busta-viaggi']);
  });
});

describe('dati demo', () => {
  it('sono validi, non vanno oltre oggi e sono segnalati', async () => {
    await loadDemoData(today);
    const data = await readAllData();
    expect(data.accounts.length).toBeGreaterThan(0);
    expect(data.transactions.length).toBeGreaterThan(20);
    expect(data.transactions.every((item) => item.date <= today)).toBe(true);
    expect(data.accounts.every((account) => account.name.includes('Demo'))).toBe(true);
    expect(data.settings).toContainEqual({ key: SETTING_DEMO, value: true });
    expect(parseBackup(serializeBackup(buildBackup(data))).ok).toBe(true);
  });

  it('contengono un rimborso collegato e trasferimenti', async () => {
    await loadDemoData(today);
    const { transactions } = await readAllData();
    expect(transactions.some((item) => item.reimbursesId)).toBe(true);
    expect(transactions.some((item) => item.type === 'trasferimento')).toBe(true);
  });

  it('restano validi anche all’inizio di un mese', async () => {
    await loadDemoData('2026-11-01');
    const data = await readAllData();
    expect(data.transactions.every((item) => item.date <= '2026-11-01')).toBe(true);
    expect(parseBackup(serializeBackup(buildBackup(data))).ok).toBe(true);
  });

  it('si caricano solo su un’app vuota', async () => {
    await createAccount(accountDraft);
    await expect(loadDemoData(today)).rejects.toThrow(/vuota/);
    expect(await db.transactions.count()).toBe(0);
  });
});
