import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, serializeBackup } from '../domain/backup';
import { computeBalances, liquidityCents } from '../domain/balances';
import { portfolioTotals, summarizeHoldings } from '../domain/investments';
import { summarizePeriod } from '../domain/reports';
import { createAccount, deleteAccount, updateAccount, type AccountDraft } from './accounts';
import { clearAllData, loadDemoData, readAllData, replaceAllData } from './data';
import { db } from './db';
import { createHolding, deleteHolding, deleteSnapshot, recordPrices, updateHolding, type PositionDraft } from './investments';
import { addTransaction } from './transactions';

const today = '2026-10-30';

const brokerDraft: AccountDraft = {
  name: 'Broker',
  type: 'investimento',
  currency: 'EUR',
  initialBalanceCents: 0,
  initialBalanceDate: '2026-01-01',
  archived: false,
  contaComeLiquidita: false,
};

function position(fields: Partial<PositionDraft> = {}): PositionDraft {
  return { date: '2026-10-01', quantityMicros: 30_000_000, avgPriceMicros: 151_500_000, priceMicros: 160_000_000, ...fields };
}

let brokerId = '';

beforeEach(async () => {
  await db.delete();
  await db.open();
  brokerId = await createAccount(brokerDraft);
});

async function etfA(fields: Partial<PositionDraft> = {}): Promise<string> {
  return createHolding({ accountId: brokerId, instrument: ' ETF-A ', isin: ' xx0000000001 ' }, position(fields), today);
}

describe('strumenti', () => {
  it('ne crea uno con la sua prima situazione, togliendo gli spazi', async () => {
    const id = await etfA();
    expect(await db.holdings.get(id)).toMatchObject({ instrument: 'ETF-A', isin: 'XX0000000001', accountId: brokerId });
    expect(await db.holdingSnapshots.where('holdingId').equals(id).toArray()).toEqual([
      { ...position(), id: `${id}|2026-10-01`, holdingId: id },
    ]);
  });

  it('richiede nome, conto e quote', async () => {
    await expect(createHolding({ accountId: brokerId, instrument: ' ', isin: '' }, position(), today)).rejects.toThrow(/nome/);
    await expect(createHolding({ accountId: '', instrument: 'A', isin: '' }, position(), today)).rejects.toThrow(/conto/);
    await expect(etfA({ quantityMicros: 0 })).rejects.toThrow(/quote/);
    expect(await db.holdings.count()).toBe(0);
  });

  it('accetta solo conti di tipo Investimento', async () => {
    const correnteId = await createAccount({ ...brokerDraft, name: 'Corrente', type: 'corrente' });
    await expect(createHolding({ accountId: correnteId, instrument: 'A', isin: '' }, position(), today)).rejects.toThrow(/Investimento/);
    await expect(createHolding({ accountId: 'boh', instrument: 'A', isin: '' }, position(), today)).rejects.toThrow(/Investimento/);
  });

  it('rifiuta date future, prezzi a zero e numeri non interi', async () => {
    await expect(etfA({ date: '2026-10-31' })).rejects.toThrow(/futura/);
    await expect(etfA({ date: 'ieri' })).rejects.toThrow(/Data/);
    await expect(etfA({ priceMicros: 0 })).rejects.toThrow(/attuale/);
    await expect(etfA({ avgPriceMicros: 1.5 })).rejects.toThrow(/medio/);
    await expect(etfA({ quantityMicros: -1 })).rejects.toThrow(/Quote/);
  });

  it('cambiando nome e conto non aggiunge aggiornamenti', async () => {
    const id = await etfA();
    const secondId = await createAccount({ ...brokerDraft, name: 'Altro broker' });
    await updateHolding(id, { accountId: secondId, instrument: 'ETF-A2', isin: '' }, null, today);
    expect(await db.holdings.get(id)).toMatchObject({ instrument: 'ETF-A2', accountId: secondId });
    expect(await db.holdingSnapshots.count()).toBe(1);
  });

  it('nuovi numeri sono un nuovo aggiornamento, e nello stesso giorno sostituiscono il precedente', async () => {
    const id = await etfA();
    const draft = { accountId: brokerId, instrument: 'ETF-A', isin: '' };
    await updateHolding(id, draft, position({ date: '2026-10-20', quantityMicros: 31_000_000 }), today);
    expect(await db.holdingSnapshots.count()).toBe(2);
    await updateHolding(id, draft, position({ date: '2026-10-20', quantityMicros: 32_000_000 }), today);
    expect(await db.holdingSnapshots.count()).toBe(2);
    expect((await db.holdingSnapshots.get(`${id}|2026-10-20`))?.quantityMicros).toBe(32_000_000);
  });

  it('un’eliminazione toglie anche la storia, e si può annullare', async () => {
    const id = await etfA();
    await recordPrices('2026-10-20', [{ holdingId: id, priceMicros: 170_000_000 }], today);
    const before = await readAllData();
    const undo = await deleteHolding(id);
    expect(await db.holdings.count()).toBe(0);
    expect(await db.holdingSnapshots.count()).toBe(0);
    await undo();
    const after = await readAllData();
    expect(after.holdings).toEqual(before.holdings);
    expect(after.holdingSnapshots).toEqual(before.holdingSnapshots);
  });
});

describe('prezzi', () => {
  it('cambia il prezzo e lascia quote e prezzo medio', async () => {
    const id = await etfA();
    await recordPrices('2026-10-20', [{ holdingId: id, priceMicros: 168_390_000 }], today);
    const data = await readAllData();
    const [summary] = summarizeHoldings(data.holdings, data.holdingSnapshots, today);
    expect(summary).toMatchObject({ quantityMicros: 30_000_000, avgPriceMicros: 151_500_000, priceMicros: 168_390_000, priceDate: '2026-10-20', valueCents: 505_170 });
  });

  it('un prezzo passato arricchisce la storia ma non tocca la situazione di oggi', async () => {
    const id = await etfA();
    await recordPrices('2026-09-01', [{ holdingId: id, priceMicros: 140_000_000 }], today);
    const data = await readAllData();
    expect(data.holdingSnapshots).toHaveLength(2);
    expect(summarizeHoldings(data.holdings, data.holdingSnapshots, today)[0]).toMatchObject({ priceMicros: 160_000_000, priceDate: '2026-10-01' });
    expect((await db.holdingSnapshots.get(`${id}|2026-09-01`))?.quantityMicros).toBe(30_000_000);
  });

  it('usa quote e prezzo medio di quella data', async () => {
    const id = await etfA();
    await updateHolding(id, { accountId: brokerId, instrument: 'ETF-A', isin: '' }, position({ date: '2026-10-20', quantityMicros: 40_000_000 }), today);
    await recordPrices('2026-10-10', [{ holdingId: id, priceMicros: 165_000_000 }], today);
    expect((await db.holdingSnapshots.get(`${id}|2026-10-10`))?.quantityMicros).toBe(30_000_000);
  });

  it('annullando rimette il prezzo di prima, anche se aveva sostituito quello dello stesso giorno', async () => {
    const id = await etfA();
    const undo = await recordPrices('2026-10-01', [{ holdingId: id, priceMicros: 999_000_000 }], today);
    expect((await db.holdingSnapshots.get(`${id}|2026-10-01`))?.priceMicros).toBe(999_000_000);
    await undo();
    expect((await db.holdingSnapshots.get(`${id}|2026-10-01`))?.priceMicros).toBe(160_000_000);

    const undoNew = await recordPrices('2026-10-20', [{ holdingId: id, priceMicros: 170_000_000 }], today);
    await undoNew();
    expect(await db.holdingSnapshots.count()).toBe(1);
  });

  it('aggiorna più strumenti insieme, tutto o niente', async () => {
    const a = await etfA();
    const b = await createHolding({ accountId: brokerId, instrument: 'ETF-B', isin: '' }, position({ quantityMicros: 100_000_000 }), today);
    await recordPrices(today, [{ holdingId: a, priceMicros: 170_000_000 }, { holdingId: b, priceMicros: 10_356_000 }], today);
    expect(await db.holdingSnapshots.count()).toBe(4);

    await expect(recordPrices('2026-10-29', [{ holdingId: a, priceMicros: 170_000_000 }, { holdingId: 'boh', priceMicros: 1 }], today)).rejects.toThrow(/non esiste/);
    expect(await db.holdingSnapshots.count()).toBe(4);
  });

  it('rifiuta date future e prezzi a zero', async () => {
    const id = await etfA();
    await expect(recordPrices('2026-10-31', [{ holdingId: id, priceMicros: 1 }], today)).rejects.toThrow(/futura/);
    await expect(recordPrices(today, [{ holdingId: id, priceMicros: 0 }], today)).rejects.toThrow(/Prezzo/);
  });
});

describe('storico', () => {
  it('toglie un aggiornamento sbagliato, e si può annullare', async () => {
    const id = await etfA();
    await recordPrices('2026-10-20', [{ holdingId: id, priceMicros: 1_600_000_000 }], today);
    const undo = await deleteSnapshot(`${id}|2026-10-20`);
    const data = await readAllData();
    expect(summarizeHoldings(data.holdings, data.holdingSnapshots, today)[0]?.priceMicros).toBe(160_000_000);
    await undo();
    expect(await db.holdingSnapshots.count()).toBe(2);
  });

  it('l’ultimo aggiornamento rimasto non si toglie', async () => {
    const id = await etfA();
    await expect(deleteSnapshot(`${id}|2026-10-01`)).rejects.toThrow(/unico/);
    expect(await db.holdingSnapshots.count()).toBe(1);
  });
});

describe('conti con strumenti', () => {
  it('non si possono eliminare', async () => {
    const id = await etfA();
    await expect(deleteAccount(brokerId)).rejects.toThrow(/strumenti/);
    await deleteHolding(id);
    await deleteAccount(brokerId);
    expect(await db.accounts.get(brokerId)).toBeUndefined();
  });

  it('non possono cambiare tipo, ma si possono rinominare', async () => {
    const id = await etfA();
    await expect(updateAccount(brokerId, { ...brokerDraft, type: 'corrente' })).rejects.toThrow(/strumenti/);
    await updateAccount(brokerId, { ...brokerDraft, name: 'Il mio broker' });
    expect((await db.accounts.get(brokerId))?.name).toBe('Il mio broker');
    await deleteHolding(id);
    await updateAccount(brokerId, { ...brokerDraft, type: 'corrente' });
    expect((await db.accounts.get(brokerId))?.type).toBe('corrente');
  });
});

describe('con il resto dell’app', () => {
  it('strumenti e prezzi non toccano liquidità, risparmio e movimenti', async () => {
    const correnteId = await createAccount({ ...brokerDraft, name: 'Corrente', type: 'corrente', initialBalanceCents: 100_000, contaComeLiquidita: true });
    await addTransaction({ date: '2026-10-07', amountCents: 10_000, type: 'trasferimento', accountId: correnteId, toAccountId: brokerId });

    const before = await readAllData();
    const id = await etfA();
    await recordPrices(today, [{ holdingId: id, priceMicros: 999_000_000 }], today);
    const after = await readAllData();

    const liquidity = (data: typeof after) => liquidityCents(data.accounts, computeBalances(data.accounts, data.transactions, today));
    expect(liquidity(after)).toBe(liquidity(before));
    expect(liquidity(after)).toBe(90_000);
    const summary = summarizePeriod(after, '2026-10-01', today);
    expect(summary.investedCents).toBe(10_000);
    expect(summary.expenseCents).toBe(0);
    expect(summary.savingsCents).toBe(0);
    expect(after.transactions).toEqual(before.transactions);
  });
});

describe('backup', () => {
  it('strumenti e storia tornano uguali', async () => {
    const id = await etfA();
    await recordPrices(today, [{ holdingId: id, priceMicros: 170_000_000 }], today);
    const data = await readAllData();
    const result = parseBackup(serializeBackup(buildBackup(data)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.data.holdings).toEqual(data.holdings);
    expect(result.backup.data.holdingSnapshots).toEqual(data.holdingSnapshots);

    await clearAllData();
    expect(await db.holdings.count()).toBe(0);
    expect(await db.holdingSnapshots.count()).toBe(0);
    await replaceAllData(result.backup.data);
    expect(await db.holdingSnapshots.count()).toBe(2);
  });

  it('rifiuta strumenti e aggiornamenti rovinati', async () => {
    const id = await etfA();
    const data = await readAllData();
    const errorOf = (fields: object) => {
      const result = parseBackup(serializeBackup(buildBackup({ ...data, ...fields })));
      return result.ok ? '' : result.error;
    };
    const holding = data.holdings[0];
    const snapshot = data.holdingSnapshots[0];
    expect(errorOf({ holdings: [{ ...holding, instrument: '' }] })).toMatch(/nome/);
    expect(errorOf({ holdings: [{ ...holding, accountId: 'boh' }] })).toMatch(/conto/);
    expect(errorOf({ holdings: [{ ...holding, isin: 3 }] })).toMatch(/ISIN/);
    expect(errorOf({ holdingSnapshots: [{ ...snapshot, holdingId: 'boh' }] })).toMatch(/strumento/);
    expect(errorOf({ holdingSnapshots: [{ ...snapshot, date: 'ieri' }] })).toMatch(/data/);
    expect(errorOf({ holdingSnapshots: [{ ...snapshot, priceMicros: 1.5 }] })).toMatch(/quote o prezzi/);
    expect(errorOf({ holdingSnapshots: [{ ...snapshot, id: '' }] })).toMatch(/identificatore/);
    expect(id).toBeTruthy();
  });

  it('un backup della versione precedente si legge, senza strumenti', async () => {
    const file = JSON.parse(serializeBackup(buildBackup(await readAllData()))) as { schemaVersion: number; data: { holdingSnapshots?: unknown } };
    file.schemaVersion = 2;
    delete file.data.holdingSnapshots;
    const result = parseBackup(JSON.stringify(file));
    expect(result.ok && result.backup.data.holdingSnapshots).toEqual([]);
  });
});

describe('dati demo', () => {
  it('comprendono strumenti inventati, marcati come demo', async () => {
    await clearAllData();
    await loadDemoData(today);
    const data = await readAllData();
    expect(data.holdings.length).toBeGreaterThan(0);
    expect(data.holdings.every(({ instrument }) => instrument.includes('(demo)'))).toBe(true);
    const totals = portfolioTotals(summarizeHoldings(data.holdings, data.holdingSnapshots, today));
    expect(totals.valueCents).toBeGreaterThan(0);
    const result = parseBackup(serializeBackup(buildBackup(data)));
    expect(result.ok).toBe(true);
  });
});

describe('aggiornamento dalla versione precedente', () => {
  it('aggiunge la tabella senza toccare i dati', async () => {
    await db.delete();
    db.close();
    const stores = {
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
    const old = new Dexie('finanze');
    old.version(2).stores(stores);
    await old.open();
    await old.table('accounts').add({ ...brokerDraft, id: 'vecchio', createdAt: '2026-01-01T00:00:00.000Z' });
    await old.table('budgets').add({ id: 'mia', name: 'Mia', kind: 'tetto', amountCents: 100, categoryIds: [], order: 1 });
    old.close();

    await db.open();
    expect((await db.accounts.get('vecchio'))?.name).toBe('Broker');
    expect((await db.budgets.toArray()).map(({ id }) => id)).toEqual(['mia']);
    expect(await db.holdingSnapshots.count()).toBe(0);
    await createHolding({ accountId: 'vecchio', instrument: 'ETF-A', isin: '' }, position(), today);
    expect(await db.holdingSnapshots.count()).toBe(1);
  });
});
