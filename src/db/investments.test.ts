import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, serializeBackup } from '../domain/backup';
import { computeBalances, liquidityCents } from '../domain/balances';
import { accountOverviews, investmentSeries, portfolioTotals, summarizeHoldings } from '../domain/investments';
import { summarizePeriod } from '../domain/reports';
import { createAccount, deleteAccount, setAccountBalance, updateAccount, type AccountDraft } from './accounts';
import { clearAllData, loadDemoData, readAllData, replaceAllData } from './data';
import { db } from './db';
import {
  createHolding,
  deleteHolding,
  deleteSnapshot,
  linkHolding,
  recordHistory,
  recordPrices,
  recordQuotes,
  updateHolding,
  type PositionDraft,
} from './investments';
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
    await expect(etfA({ avgPriceMicros: 1.5 })).rejects.toThrow(/acquisto/);
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
    expect(await db.holdingSnapshots.get(`${id}|2026-09-01`)).toEqual({ id: `${id}|2026-09-01`, holdingId: id, date: '2026-09-01', priceMicros: 140_000_000 });
  });

  it('usa quote e prezzo medio di quella data', async () => {
    const id = await etfA();
    await updateHolding(id, { accountId: brokerId, instrument: 'ETF-A', isin: '' }, position({ date: '2026-10-20', quantityMicros: 40_000_000 }), today);
    await recordPrices('2026-10-10', [{ holdingId: id, priceMicros: 165_000_000 }], today);
    const data = await readAllData();
    const points = investmentSeries(data.holdings, data.holdingSnapshots, today);
    expect(points.find(({ date }) => date === '2026-10-10')).toMatchObject({ cents: 495_000, baselineCents: 454_500 });
    expect(points.find(({ date }) => date === '2026-10-20')).toMatchObject({ cents: 640_000, baselineCents: 606_000 });
  });

  it('nello stesso giorno di un cambio di quote cambia solo il prezzo', async () => {
    const id = await etfA();
    await recordPrices('2026-10-01', [{ holdingId: id, priceMicros: 170_000_000 }], today);
    expect(await db.holdingSnapshots.get(`${id}|2026-10-01`)).toMatchObject({ quantityMicros: 30_000_000, avgPriceMicros: 151_500_000, priceMicros: 170_000_000 });
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

describe('prezzi automatici', () => {
  const row = (id: string, date: string) => db.holdingSnapshots.get(`${id}|${date}`);

  it('un prezzo nuovo aggiunge una riga con il solo prezzo', async () => {
    const id = await etfA();
    expect(await recordQuotes([{ holdingId: id, date: '2026-10-29', priceMicros: 168_930_000 }], today)).toBe(1);
    expect(await row(id, '2026-10-29')).toEqual({ id: `${id}|2026-10-29`, holdingId: id, date: '2026-10-29', priceMicros: 168_930_000 });
  });

  it('lo stesso prezzo non scrive niente', async () => {
    const id = await etfA();
    await recordQuotes([{ holdingId: id, date: '2026-10-29', priceMicros: 168_930_000 }], today);
    expect(await recordQuotes([{ holdingId: id, date: '2026-10-29', priceMicros: 168_930_000 }], today)).toBe(0);
    expect(await db.holdingSnapshots.count()).toBe(2);
  });

  it('nello stesso giorno aggiorna il prezzo e lascia quote e prezzo medio', async () => {
    const id = await etfA();
    await recordQuotes([{ holdingId: id, date: '2026-10-01', priceMicros: 170_000_000 }], today);
    expect(await row(id, '2026-10-01')).toMatchObject({ quantityMicros: 30_000_000, avgPriceMicros: 151_500_000, priceMicros: 170_000_000 });
    expect(await db.holdingSnapshots.count()).toBe(1);
  });

  it('un prezzo più vecchio dell’ultimo noto non aggiunge righe', async () => {
    const id = await etfA();
    expect(await recordQuotes([{ holdingId: id, date: '2026-09-15', priceMicros: 170_000_000 }], today)).toBe(0);
    expect(await db.holdingSnapshots.count()).toBe(1);
  });

  it('una data di domani, per chi è in un altro fuso, diventa oggi', async () => {
    const id = await etfA();
    await recordQuotes([{ holdingId: id, date: '2026-10-31', priceMicros: 170_000_000 }], today);
    expect(await row(id, today)).toMatchObject({ priceMicros: 170_000_000 });
  });

  it('ignora strumenti eliminati e prezzi sbagliati', async () => {
    const id = await etfA();
    const quotes = [
      { holdingId: 'boh', date: today, priceMicros: 1 },
      { holdingId: id, date: today, priceMicros: 0 },
      { holdingId: id, date: today, priceMicros: 1.5 },
    ];
    expect(await recordQuotes(quotes, today)).toBe(0);
    expect(await recordQuotes([], today)).toBe(0);
  });

  it('togliendo quote sbagliate si corregge anche la storia dei prezzi', async () => {
    const id = await etfA();
    const draft = { accountId: brokerId, instrument: 'ETF-A', isin: '' };
    await updateHolding(id, draft, position({ date: '2026-10-10', quantityMicros: 300_000_000 }), today);
    await recordQuotes([{ holdingId: id, date: '2026-10-20', priceMicros: 170_000_000 }], today);

    await deleteSnapshot(`${id}|2026-10-10`);
    const data = await readAllData();
    expect(summarizeHoldings(data.holdings, data.holdingSnapshots, today)[0]).toMatchObject({ quantityMicros: 30_000_000, priceMicros: 170_000_000 });
    expect(investmentSeries(data.holdings, data.holdingSnapshots, today).at(-1)).toMatchObject({ cents: 510_000 });
  });

  it('collega lo strumento e completa l’ISIN se manca', async () => {
    const id = await createHolding({ accountId: brokerId, instrument: 'ETF-A', isin: '' }, position(), today);
    await linkHolding(id, { source: 'FUND/1', isin: 'XX0000000001', name: 'Nome lungo' });
    expect(await db.holdings.get(id)).toMatchObject({ instrument: 'ETF-A', isin: 'XX0000000001', quoteSource: 'FUND/1' });
    await linkHolding(id, { source: 'FUND/2', isin: 'XX0000000002', name: 'Altro' });
    expect(await db.holdings.get(id)).toMatchObject({ isin: 'XX0000000001', quoteSource: 'FUND/2' });
    await expect(linkHolding('boh', { source: 'FUND/1', isin: '', name: '' })).resolves.toBeUndefined();
  });

  it('togliendo la fonte il prezzo torna a mano', async () => {
    const id = await createHolding({ accountId: brokerId, instrument: 'ETF-A', isin: '', quoteSource: 'FUND/1' }, position(), today);
    expect((await db.holdings.get(id))?.quoteSource).toBe('FUND/1');
    await updateHolding(id, { accountId: brokerId, instrument: 'ETF-A', isin: '' }, null, today);
    expect(await db.holdings.get(id)).not.toHaveProperty('quoteSource');
  });
});

describe('liquidità dei conti', () => {
  const overviewOf = async () => {
    const data = await readAllData();
    const balances = computeBalances(data.accounts, data.transactions, today);
    return accountOverviews(data.accounts, summarizeHoldings(data.holdings, data.holdingSnapshots, today), balances).find(({ account }) => account.id === brokerId);
  };
  const balance = async () => computeBalances(await db.accounts.toArray(), await db.transactions.toArray(), today).get(brokerId);

  it('legge il saldo messo in Conti, anche con degli strumenti', async () => {
    await updateAccount(brokerId, { ...brokerDraft, initialBalanceCents: 27_714, initialBalanceDate: '2026-10-01' });
    await etfA();
    expect(await overviewOf()).toMatchObject({ cashCents: 27_714, investedCents: 480_000, totalCents: 507_714 });
  });

  it('cambiata in Investimenti si vede uguale in Conti, e si può annullare', async () => {
    await updateAccount(brokerId, { ...brokerDraft, initialBalanceCents: 27_714, initialBalanceDate: '2026-10-01' });
    const undo = await setAccountBalance(brokerId, 15_050, today);
    expect(await db.accounts.get(brokerId)).toMatchObject({ initialBalanceCents: 15_050, initialBalanceDate: today });
    expect(await balance()).toBe(15_050);
    expect(await overviewOf()).toMatchObject({ cashCents: 15_050 });
    await undo();
    expect(await db.accounts.get(brokerId)).toMatchObject({ initialBalanceCents: 27_714, initialBalanceDate: '2026-10-01' });
  });

  it('cambiata in Conti si vede uguale in Investimenti', async () => {
    await setAccountBalance(brokerId, 15_050, today);
    await updateAccount(brokerId, { ...brokerDraft, initialBalanceCents: 9_900, initialBalanceDate: today });
    expect(await overviewOf()).toMatchObject({ cashCents: 9_900 });
  });

  it('i movimenti vecchi sono compresi, quelli nuovi si sommano', async () => {
    const correnteId = await createAccount({ ...brokerDraft, name: 'Corrente', type: 'corrente', initialBalanceCents: 100_000, contaComeLiquidita: true });
    await addTransaction({ date: '2026-10-07', amountCents: 10_000, type: 'trasferimento', accountId: correnteId, toAccountId: brokerId });
    expect(await balance()).toBe(10_000);
    await setAccountBalance(brokerId, 2_500, '2026-10-20');
    expect(await balance()).toBe(2_500);
    await addTransaction({ date: '2026-10-25', amountCents: 10_000, type: 'trasferimento', accountId: correnteId, toAccountId: brokerId });
    expect(await balance()).toBe(12_500);
    expect(await overviewOf()).toMatchObject({ cashCents: 12_500 });
  });

  it('un movimento dello stesso giorno non si conta due volte', async () => {
    const correnteId = await createAccount({ ...brokerDraft, name: 'Corrente', type: 'corrente', initialBalanceCents: 100_000, contaComeLiquidita: true });
    await addTransaction({ date: today, amountCents: 10_000, type: 'trasferimento', accountId: correnteId, toAccountId: brokerId });
    await setAccountBalance(brokerId, 15_050, today);
    expect(await balance()).toBe(15_050);
    expect((await db.accounts.get(brokerId))?.initialBalanceCents).toBe(5_050);
  });

  it('non tocca liquidità disponibile, risparmio, investito e movimenti', async () => {
    const correnteId = await createAccount({ ...brokerDraft, name: 'Corrente', type: 'corrente', initialBalanceCents: 100_000, contaComeLiquidita: true });
    await addTransaction({ date: '2026-10-07', amountCents: 10_000, type: 'trasferimento', accountId: correnteId, toAccountId: brokerId });
    const before = await readAllData();
    await setAccountBalance(brokerId, 27_714, today);
    const after = await readAllData();
    const liquidity = (data: typeof after) => liquidityCents(data.accounts, computeBalances(data.accounts, data.transactions, today));
    expect(liquidity(after)).toBe(liquidity(before));
    expect(after.transactions).toEqual(before.transactions);
    expect(summarizePeriod(after, '2026-10-01', today)).toEqual(summarizePeriod(before, '2026-10-01', today));
  });

  it('rifiuta importi non validi e conti che non esistono', async () => {
    await expect(setAccountBalance(brokerId, 1.5, today)).rejects.toThrow(/non valido/);
    await expect(setAccountBalance('boh', 1, today)).rejects.toThrow(/non esiste/);
  });

  it('un backup della versione con la liquidità a parte la porta nel saldo', async () => {
    const data = await readAllData();
    const file = JSON.parse(serializeBackup(buildBackup(data))) as { schemaVersion: number; data: { accounts: Record<string, unknown>[] } };
    file.schemaVersion = 4;
    file.data.accounts = file.data.accounts.map((account) => ({ ...account, cashCents: 27_714, cashDate: '2026-10-20' }));
    const result = parseBackup(JSON.stringify(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [account] = result.backup.data.accounts;
    expect(account).toMatchObject({ initialBalanceCents: 27_714, initialBalanceDate: '2026-10-20' });
    expect(account).not.toHaveProperty('cashCents');
    expect(account).not.toHaveProperty('cashDate');
  });
});

describe('chiusure passate', () => {
  const linked = () => createHolding({ accountId: brokerId, instrument: 'ETF-A', isin: '', quoteSource: 'FUND/1' }, position(), today);
  const closes = [
    { date: '2026-09-30', priceMicros: 100_000_000 },
    { date: '2026-10-01', priceMicros: 101_000_000 },
    { date: '2026-10-02', priceMicros: 102_000_000 },
    { date: '2026-10-31', priceMicros: 103_000_000 },
  ];

  it('scrive solo i giorni richiesti, senza toccare quote e prezzo di acquisto', async () => {
    const id = await linked();
    await recordHistory(id, closes, '2026-10-01', today);
    const rows = await db.holdingSnapshots.where('holdingId').equals(id).sortBy('date');
    expect(rows.map(({ date }) => date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(rows[0]).toMatchObject({ quantityMicros: 30_000_000, avgPriceMicros: 151_500_000, priceMicros: 101_000_000 });
    expect(rows[1]).toEqual({ id: `${id}|2026-10-02`, holdingId: id, date: '2026-10-02', priceMicros: 102_000_000 });
    expect((await db.holdings.get(id))?.historyFrom).toBe('2026-10-01');
  });

  it('riempie il grafico con il valore di ogni giorno', async () => {
    const id = await linked();
    await recordHistory(id, closes, '2026-10-01', today);
    const data = await readAllData();
    const points = investmentSeries(data.holdings, data.holdingSnapshots, today);
    expect(points[0]).toEqual({ date: '2026-10-01', cents: 303_000, baselineCents: 454_500 });
    expect(points[1]).toEqual({ date: '2026-10-02', cents: 306_000, baselineCents: 454_500 });
    expect(points.at(-1)).toEqual({ date: today, cents: 306_000, baselineCents: 454_500 });
    expect(id).toBeTruthy();
  });

  it('dei giorni in cui l’app è rimasta chiusa non sposta la data già letta', async () => {
    const id = await linked();
    await recordHistory(id, closes, '2026-10-01', today);
    await recordHistory(id, [{ date: '2026-10-20', priceMicros: 110_000_000 }], '2026-10-20', today);
    expect((await db.holdings.get(id))?.historyFrom).toBe('2026-10-01');
    expect((await db.holdingSnapshots.get(`${id}|2026-10-20`))?.priceMicros).toBe(110_000_000);
  });

  it('segna come letto anche senza chiusure, per non riprovare all’infinito', async () => {
    const id = await linked();
    await recordHistory(id, [], '2026-10-01', today);
    expect((await db.holdings.get(id))?.historyFrom).toBe('2026-10-01');
  });

  it('ignora prezzi sbagliati e strumenti eliminati', async () => {
    const id = await linked();
    await recordHistory(id, [{ date: '2026-10-02', priceMicros: 0 }, { date: '2026-10-03', priceMicros: 1.5 }], '2026-10-01', today);
    expect(await db.holdingSnapshots.count()).toBe(1);
    await expect(recordHistory('boh', closes, '2026-10-01', today)).resolves.toBeUndefined();
    expect(await db.holdingSnapshots.count()).toBe(1);
  });

  it('cambiando strumento lo storico va riletto, cambiando il nome no', async () => {
    const id = await linked();
    await recordHistory(id, closes, '2026-10-01', today);
    await updateHolding(id, { accountId: brokerId, instrument: 'Altro nome', isin: '', quoteSource: 'FUND/1' }, null, today);
    expect((await db.holdings.get(id))?.historyFrom).toBe('2026-10-01');
    await updateHolding(id, { accountId: brokerId, instrument: 'Altro nome', isin: '', quoteSource: 'FUND/2' }, null, today);
    expect(await db.holdings.get(id)).not.toHaveProperty('historyFrom');
  });

  it('tornando a mano smette di contare come letto', async () => {
    const id = await linked();
    await recordHistory(id, closes, '2026-10-01', today);
    await updateHolding(id, { accountId: brokerId, instrument: 'ETF-A', isin: '' }, null, today);
    const holding = await db.holdings.get(id);
    expect(holding).not.toHaveProperty('historyFrom');
    expect(holding).not.toHaveProperty('quoteSource');
  });

  it('nel backup torna uguale, e una data sbagliata si rifiuta', async () => {
    const id = await linked();
    await recordHistory(id, closes, '2026-10-01', today);
    const data = await readAllData();
    const result = parseBackup(serializeBackup(buildBackup(data)));
    expect(result.ok && result.backup.data.holdings).toEqual(data.holdings);
    expect(result.ok && result.backup.data.holdingSnapshots).toEqual(data.holdingSnapshots);

    const broken = parseBackup(serializeBackup(buildBackup({ ...data, holdings: [{ ...data.holdings[0]!, historyFrom: 'ieri' }] })));
    expect(broken.ok ? '' : broken.error).toMatch(/storico/);
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

  it('anche con altri prezzi, l’ultimo con le quote resta', async () => {
    const id = await etfA();
    await recordPrices('2026-10-20', [{ holdingId: id, priceMicros: 170_000_000 }], today);
    await expect(deleteSnapshot(`${id}|2026-10-01`)).rejects.toThrow(/unico/);
    await deleteSnapshot(`${id}|2026-10-20`);
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
    expect(errorOf({ holdings: [{ ...holding, quoteSource: '../altro' }] })).toMatch(/fonte/);
    expect(errorOf({ holdingSnapshots: [{ ...snapshot, avgPriceMicros: undefined }] })).toMatch(/quote o prezzi/);
    expect(errorOf({ holdingSnapshots: [{ ...snapshot, quantityMicros: -1 }] })).toMatch(/quote o prezzi/);
    expect(id).toBeTruthy();
  });

  it('righe del solo prezzo e fonte dei prezzi tornano uguali', async () => {
    const id = await createHolding({ accountId: brokerId, instrument: 'ETF-A', isin: '', quoteSource: 'FUND/1' }, position(), today);
    await recordQuotes([{ holdingId: id, date: today, priceMicros: 170_000_000 }], today);
    const data = await readAllData();
    const result = parseBackup(serializeBackup(buildBackup(data)));
    expect(result.ok && result.backup.data.holdings).toEqual(data.holdings);
    expect(result.ok && result.backup.data.holdingSnapshots).toEqual(data.holdingSnapshots);
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

describe('aggiornamento dalla versione con la liquidità a parte', () => {
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
    holdingSnapshots: 'id, holdingId, date',
    settings: 'key',
  };

  it('la porta nel saldo, senza contare due volte i movimenti di quel giorno', async () => {
    await db.delete();
    db.close();
    const old = new Dexie('finanze');
    old.version(4).stores(stores);
    await old.open();
    const account = { ...brokerDraft, createdAt: '2026-01-01T00:00:00.000Z' };
    await old.table('accounts').bulkAdd([
      { ...account, id: 'scritta', initialBalanceCents: 500, cashCents: 27_714, cashDate: '2026-10-20' },
      { ...account, id: 'senza', initialBalanceCents: 900 },
    ]);
    await old.table('transactions').add({ id: 't', date: '2026-10-20', amountCents: 1_000, type: 'trasferimento', accountId: 'senza', toAccountId: 'scritta', createdAt: '2026-10-20T10:00:00.000Z' });
    old.close();

    await db.open();
    const written = await db.accounts.get('scritta');
    expect(written).toMatchObject({ initialBalanceCents: 26_714, initialBalanceDate: '2026-10-20' });
    expect(written).not.toHaveProperty('cashCents');
    expect(written).not.toHaveProperty('cashDate');
    expect(await db.accounts.get('senza')).toMatchObject({ initialBalanceCents: 900, initialBalanceDate: '2026-01-01' });
    const balances = computeBalances(await db.accounts.toArray(), await db.transactions.toArray(), today);
    expect(balances.get('scritta')).toBe(27_714);
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
