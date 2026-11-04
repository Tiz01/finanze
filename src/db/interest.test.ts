import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, serializeBackup } from '../domain/backup';
import { computeBalances, liquidityCents } from '../domain/balances';
import { budgetProgress } from '../domain/budgets';
import { CATEGORY_IDS } from '../domain/categories';
import { interestStatus } from '../domain/interest';
import { overviewTotals } from '../domain/investments';
import { summarizePeriod } from '../domain/reports';
import type { Budget, InterestTerms } from '../domain/types';
import { createAccount, deleteAccount, updateAccount, type AccountDraft } from './accounts';
import { loadDemoData, readAllData, replaceAllData } from './data';
import { db } from './db';
import { confirmAllInterest, confirmInterest, setAccountInterest, skipInterest } from './interest';
import { createHolding } from './investments';
import { addTransaction, deleteTransaction } from './transactions';

const terms: InterestTerms = {
  ratePercentMicros: 4_000_000,
  rateKind: 'lordo',
  taxPercentMicros: 26_000_000,
  intervalMonths: 1,
  startDate: '2027-01-01',
  termMonths: 12,
};

const draft: AccountDraft = {
  name: 'Remunerato',
  type: 'remunerato',
  currency: 'EUR',
  initialBalanceCents: 500_000,
  initialBalanceDate: '2027-01-01',
  archived: false,
  contaComeLiquidita: false,
  interest: terms,
};

const plain: AccountDraft = { ...draft, name: 'Corrente', type: 'corrente', contaComeLiquidita: true, interest: undefined };

let id = '';

beforeEach(async () => {
  await db.delete();
  await db.open();
  id = await createAccount(draft);
});

async function balance(accountId = id, date = '2027-12-31') {
  return computeBalances(await db.accounts.toArray(), await db.transactions.toArray(), date).get(accountId);
}

async function status(today: string) {
  const account = await db.accounts.get(id);
  return account && interestStatus(account, await db.transactions.toArray(), today);
}

describe('conferma', () => {
  it('registra un’entrata con gli interessi netti e li aggiunge al saldo', async () => {
    await confirmInterest(id, '2027-02-15');
    const [movement] = await db.transactions.toArray();
    expect(movement).toMatchObject({ type: 'entrata', date: '2027-02-01', amountCents: 1_257, accountId: id, categoryId: CATEGORY_IDS.interessi });
    expect(await balance()).toBe(501_257);
    expect((await db.accounts.get(id))?.interest?.creditedThrough).toBe('2027-02-01');
    expect((await status('2027-02-15'))?.pending).toEqual([]);
  });

  it('si può annullare', async () => {
    const undo = await confirmInterest(id, '2027-02-15');
    await undo();
    expect(await db.transactions.count()).toBe(0);
    expect((await db.accounts.get(id))?.interest).toEqual(terms);
    expect((await status('2027-02-15'))?.pending).toHaveLength(1);
  });

  it('accetta l’importo e la data veri della banca', async () => {
    await confirmInterest(id, '2027-02-15', { date: '2027-01-31', amountCents: 1_300 });
    expect(await db.transactions.toArray()).toMatchObject([{ date: '2027-01-31', amountCents: 1_300 }]);
    expect((await db.accounts.get(id))?.interest?.creditedThrough).toBe('2027-02-01');
  });

  it('rifiuta un importo a zero', async () => {
    await expect(confirmInterest(id, '2027-02-15', { date: '2027-02-01', amountCents: 0 })).rejects.toThrow(/maggiore di zero/);
    expect((await db.accounts.get(id))?.interest?.creditedThrough).toBeUndefined();
  });

  it('senza niente da confermare lo dice', async () => {
    await expect(confirmInterest(id, '2027-01-15')).rejects.toThrow(/Non ci sono/);
  });

  it('un movimento di interessi cancellato non torna', async () => {
    await confirmInterest(id, '2027-02-15');
    const [movement] = await db.transactions.toArray();
    await deleteTransaction(movement?.id ?? '');
    expect((await status('2027-02-15'))?.pending).toEqual([]);
  });
});

describe('conferma di tutti', () => {
  it('registra ogni accredito alla sua data, una sola annullata', async () => {
    const undo = await confirmAllInterest(id, '2027-04-15');
    const movements = await db.transactions.orderBy('date').toArray();
    expect(movements.map(({ date }) => date)).toEqual(['2027-02-01', '2027-03-01', '2027-04-01']);
    expect((await db.accounts.get(id))?.interest?.creditedThrough).toBe('2027-04-01');
    await undo();
    expect(await db.transactions.count()).toBe(0);
    expect(await balance()).toBe(500_000);
  });

  it('dà lo stesso risultato di confermarli uno a uno', async () => {
    await confirmAllInterest(id, '2027-04-15');
    const together = (await db.transactions.orderBy('date').toArray()).map(({ amountCents }) => amountCents);
    await db.transactions.clear();
    await db.accounts.put({ ...(await db.accounts.get(id))!, interest: terms });
    for (let step = 0; step < 3; step += 1) await confirmInterest(id, '2027-04-15');
    const single = (await db.transactions.orderBy('date').toArray()).map(({ amountCents }) => amountCents);
    expect(single).toEqual(together);
  });
});

describe('salta', () => {
  it('passa oltre senza registrare, e si può annullare', async () => {
    const undo = await skipInterest(id, '2027-02-15');
    expect(await db.transactions.count()).toBe(0);
    expect((await status('2027-02-15'))?.pending).toEqual([]);
    await undo();
    expect((await status('2027-02-15'))?.pending).toHaveLength(1);
  });
});

describe('versamenti e prelievi veri', () => {
  it('un trasferimento cambia i conti che seguono', async () => {
    const correnteId = await createAccount(plain);
    const before = (await status('2027-01-15'))?.next?.netCents ?? 0;
    await addTransaction({ date: '2027-01-02', amountCents: 500_000, type: 'trasferimento', accountId: correnteId, toAccountId: id });
    const after = (await status('2027-01-15'))?.next?.netCents ?? 0;
    expect(after).toBeGreaterThan(before * 1.9);
    expect(await balance()).toBe(1_000_000);
    await addTransaction({ date: '2027-01-02', amountCents: 1_000_000, type: 'trasferimento', accountId: id, toAccountId: correnteId });
    expect((await status('2027-01-15'))?.next?.netCents).toBeLessThan(before / 10);
  });
});

describe('condizioni', () => {
  it('un conto esistente diventa remunerato tenendo saldo e movimenti', async () => {
    const correnteId = await createAccount(plain);
    await addTransaction({ date: '2027-01-02', amountCents: 500, type: 'uscita', accountId: correnteId, categoryId: 'cat-altro' });
    await setAccountInterest(correnteId, terms, { contaComeLiquidita: false });
    expect(await db.accounts.get(correnteId)).toMatchObject({ type: 'remunerato', interest: terms, contaComeLiquidita: false, initialBalanceCents: 500_000 });
    expect(await balance(correnteId)).toBe(499_500);
  });

  it('cambiarle non perde gli accrediti già registrati', async () => {
    await confirmInterest(id, '2027-02-15');
    await setAccountInterest(id, { ...terms, ratePercentMicros: 2_000_000 }, { contaComeLiquidita: false });
    expect((await db.accounts.get(id))?.interest).toMatchObject({ ratePercentMicros: 2_000_000, creditedThrough: '2027-02-01' });
    expect(await balance()).toBe(501_257);
    await updateAccount(id, { ...draft, name: 'Nuovo nome', interest: { ...terms, ratePercentMicros: 3_000_000 } });
    expect((await db.accounts.get(id))?.interest).toMatchObject({ ratePercentMicros: 3_000_000, creditedThrough: '2027-02-01' });
  });

  it('un conto con strumenti non può diventare remunerato', async () => {
    const brokerId = await createAccount({ ...plain, type: 'investimento', contaComeLiquidita: false });
    await createHolding(
      { accountId: brokerId, instrument: 'ETF-A', isin: '' },
      { date: '2027-01-01', quantityMicros: 1, avgPriceMicros: 1, priceMicros: 1 },
      '2027-01-01',
    );
    await expect(setAccountInterest(brokerId, terms, { contaComeLiquidita: false })).rejects.toThrow(/strumenti/);
  });

  it('rifiuta condizioni sbagliate', async () => {
    await expect(setAccountInterest(id, { ...terms, ratePercentMicros: 0 }, { contaComeLiquidita: false })).rejects.toThrow(/tasso/);
    await expect(setAccountInterest('boh', terms, { contaComeLiquidita: false })).rejects.toThrow(/non esiste/);
    await expect(createAccount({ ...draft, interest: undefined })).rejects.toThrow(/condizioni/);
  });

  it('cambiando tipo le condizioni se ne vanno', async () => {
    await updateAccount(id, { ...draft, type: 'deposito' });
    expect(await db.accounts.get(id)).not.toHaveProperty('interest');
  });

  it('un conto senza movimenti si può eliminare', async () => {
    await deleteAccount(id);
    expect(await db.accounts.count()).toBe(0);
  });
});

describe('con il resto dell’app', () => {
  it('gli interessi sono un’entrata, il saldo non è investito né liquidità', async () => {
    const correnteId = await createAccount(plain);
    await addTransaction({ date: '2027-01-05', amountCents: 100_000, type: 'trasferimento', accountId: correnteId, toAccountId: id });
    await confirmInterest(id, '2027-02-15');
    const data = await readAllData();
    const balances = computeBalances(data.accounts, data.transactions, '2027-02-15');

    expect(liquidityCents(data.accounts, balances)).toBe(400_000);
    const month = summarizePeriod(data, '2027-01-01', '2027-02-15');
    const interest = (await db.transactions.where('type').equals('entrata').first())?.amountCents ?? 0;
    expect(interest).toBeGreaterThan(0);
    expect(month.sources.otherCents).toBe(interest);
    expect(month.savingsCents).toBe(interest);
    expect(month.investedCents).toBe(0);
    expect(month.marketCents).toBe(0);
  });

  it('una busta obiettivo sul conto conta i versamenti, non gli interessi', async () => {
    const correnteId = await createAccount(plain);
    await addTransaction({ date: '2027-02-05', amountCents: 20_000, type: 'trasferimento', accountId: correnteId, toAccountId: id });
    await confirmInterest(id, '2027-02-15');
    const budget: Budget = { id: 'b', name: 'Da parte', kind: 'obiettivo', amountCents: 20_000, categoryIds: [], accountId: id, order: 1 };
    const [progress] = budgetProgress([budget], await readAllData(), '2027-02-01', '2027-02-28');
    expect(progress).toMatchObject({ usedCents: 20_000 });
  });

  it('nel totale degli investimenti entra il saldo, e la parte investita lo comprende', () => {
    const totals = overviewTotals([{ account: {} as never, holdings: [], investedCents: 100, cashCents: 100, totalCents: 200 }], [{ balanceCents: 200 }]);
    expect(totals).toEqual({ investedCents: 100, savingsCents: 200, cashCents: 100, totalCents: 400, investedShare: 0.75 });
  });
});

describe('backup', () => {
  it('condizioni e accrediti tornano uguali', async () => {
    await confirmInterest(id, '2027-02-15');
    const data = await readAllData();
    const result = parseBackup(serializeBackup(buildBackup(data)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await replaceAllData(result.backup.data);
    expect((await db.accounts.get(id))?.interest).toEqual({ ...terms, creditedThrough: '2027-02-01' });
    expect(await balance()).toBe(501_257);
  });

  it('rifiuta condizioni mancanti o rovinate', async () => {
    const data = await readAllData();
    const [account] = data.accounts;
    const errorOf = (fields: object) => {
      const parsed = parseBackup(serializeBackup(buildBackup({ ...data, accounts: [{ ...account!, ...fields }] })));
      return parsed.ok ? '' : parsed.error;
    };
    expect(errorOf({ interest: undefined })).toMatch(/condizioni/);
    expect(errorOf({ interest: 3 })).toMatch(/condizioni/);
    expect(errorOf({ interest: { ...terms, intervalMonths: 0 } })).toMatch(/condizioni/);
    expect(errorOf({ interest: { ...terms, ratePercentMicros: 'quattro' } })).toMatch(/tasso/);
  });

  it('un backup vecchio si legge e ritrova la categoria', async () => {
    const data = await readAllData();
    const file = JSON.parse(serializeBackup(buildBackup(data))) as { schemaVersion: number; data: typeof data };
    file.schemaVersion = 5;
    file.data.accounts = [];
    file.data.categories = file.data.categories.filter(({ id: category }) => category !== CATEGORY_IDS.interessi);
    const result = parseBackup(JSON.stringify(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await replaceAllData(result.backup.data);
    expect(await db.categories.get(CATEGORY_IDS.interessi)).toBeDefined();
  });
});

describe('dati demo', () => {
  it('comprendono un conto remunerato inventato, valido', async () => {
    await db.accounts.clear();
    await db.transactions.clear();
    await loadDemoData('2027-06-15');
    const data = await readAllData();
    const demo = data.accounts.find(({ type }) => type === 'remunerato');
    expect(demo?.name).toContain('Demo');
    expect(parseBackup(serializeBackup(buildBackup(data))).ok).toBe(true);
    expect(demo && interestStatus(demo, data.transactions, '2027-06-15')?.pending.length).toBeGreaterThan(0);
  });
});

describe('aggiornamento dalla versione precedente', () => {
  it('aggiunge la categoria senza toccare i dati', async () => {
    await db.delete();
    db.close();
    const old = new Dexie('finanze');
    old.version(5).stores({
      accounts: 'id',
      transactions: 'id, date, type, accountId, toAccountId, categoryId, recurringId, importId, reimbursesId, *tags',
      categories: 'id, kind',
      budgets: 'id',
      recurring: 'id, nextDue',
      reconciliations: 'id, accountId, date',
      importProfiles: 'id',
      importRules: 'id',
      holdings: 'id, accountId, isin',
      holdingSnapshots: 'id, holdingId, date',
      settings: 'key',
    });
    await old.open();
    await old.table('accounts').add({ ...plain, id: 'vecchio', createdAt: '2027-01-01T00:00:00.000Z' });
    await old.table('categories').add({ id: 'mia', name: 'Mia', kind: 'entrata', group: 'Entrate', emoji: '🙂', color: '#000000', fissa: false, archived: false, system: false, order: 1 });
    old.close();

    await db.open();
    expect(await db.accounts.get('vecchio')).toMatchObject({ name: 'Corrente' });
    expect(await db.categories.get('mia')).toBeDefined();
    expect(await db.categories.get(CATEGORY_IDS.interessi)).toMatchObject({ name: 'Interessi', kind: 'entrata', system: true });
  });
});
