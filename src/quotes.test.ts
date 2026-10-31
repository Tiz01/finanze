import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from './db/accounts';
import { db } from './db/db';
import { createHolding, type HoldingDraft } from './db/investments';
import { summarizeHoldings } from './domain/investments';
import { currentPriceSyncState, fetchHistory, findInstrument, fetchQuote, resetPriceSync, syncPrices } from './quotes';

const today = '2026-10-30';
const QUANTITY = 12_345_000;

let accountId = '';
let urls: string[] = [];
let failing = false;
let price = 168.93;
let closes: [string, number][] = [];
let historyFails = false;

function noonUtc(date: string): number {
  return Date.parse(`${date}T12:00:00.000Z`) / 1000;
}

function respond(url: string): Response {
  if (url.includes('/eod_history')) {
    if (historyFails) return new Response('no', { status: 500 });
    return Response.json({
      isoCurrency: 'EUR',
      datetimeLast: closes.map(([date]) => noonUtc(date)),
      last: closes.map(([, close]) => close),
    });
  }
  if (url.includes('/instruments/query')) {
    const code = new URL(url).searchParams.get('searchValue');
    const list = code === 'ETFA' ? [{ type: 'Instrument', entityType: 'FUND', entityValue: '123', name: 'ETF Prova', isin: 'XX0000000001', symbol: 'ETFA' }] : [];
    return Response.json({ list });
  }
  return Response.json({
    list: [{ market: { codeMarket: '_MIL', name: 'Euronext Milan', idNotation: 555 }, last: price, isoCurrency: 'EUR', datetimeLast: new Date(2026, 9, 30, 15).toISOString() }],
  });
}

beforeEach(async () => {
  urls = [];
  failing = false;
  price = 168.93;
  closes = [];
  historyFails = false;
  resetPriceSync();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-30T18:00:00.000Z') });
  vi.stubGlobal('fetch', async (input: string) => {
    urls.push(input);
    if (failing) throw new TypeError('Failed to fetch');
    return respond(input);
  });
  await db.delete();
  await db.open();
  accountId = await createAccount({
    name: 'Broker',
    type: 'investimento',
    currency: 'EUR',
    initialBalanceCents: 0,
    initialBalanceDate: '2026-01-01',
    archived: false,
    contaComeLiquidita: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function holdingNamed(instrument: string, fields: Partial<HoldingDraft> = {}) {
  await createHolding(
    { accountId, instrument, isin: '', ...fields },
    { date: '2026-10-01', quantityMicros: QUANTITY, avgPriceMicros: 150_000_000, priceMicros: 160_000_000 },
    today,
  );
  return db.holdings.toArray();
}

function quoteCalls() {
  return urls.filter((url) => url.endsWith('/quotes')).length;
}

function historyCalls() {
  return urls.filter((url) => url.includes('/eod_history'));
}

async function summary() {
  const [first] = summarizeHoldings(await db.holdings.toArray(), await db.holdingSnapshots.toArray(), today);
  return first;
}

describe('ricerca', () => {
  it('trova uno strumento e il suo prezzo', async () => {
    const match = await findInstrument('ETFA');
    expect(match).toEqual({ source: 'FUND/123', isin: 'XX0000000001', name: 'ETF Prova' });
    expect(await fetchQuote('FUND/123')).toEqual({ priceMicros: 168_930_000, date: '2026-10-30', market: 'Euronext Milan', notation: 555 });
  });

  it('chiede sempre al server, senza cookie e senza dire da dove viene', async () => {
    const options: RequestInit[] = [];
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      options.push(init);
      return respond(input);
    });
    await findInstrument('ETFA');
    expect(options[0]).toMatchObject({ cache: 'no-cache', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('una risposta di errore è un errore', async () => {
    vi.stubGlobal('fetch', async () => new Response('no', { status: 500 }));
    await expect(findInstrument('ETFA')).rejects.toThrow(/500/);
  });
});

describe('aggiornamento automatico', () => {
  it('collega lo strumento dal codice e scrive il prezzo, lasciando quote e prezzo medio', async () => {
    const holdings = await holdingNamed('etfa');
    await syncPrices(holdings, await db.holdingSnapshots.toArray(), today);

    expect(await db.holdings.toArray()).toMatchObject([{ quoteSource: 'FUND/123', isin: 'XX0000000001' }]);
    expect(await summary()).toMatchObject({ priceMicros: 168_930_000, priceDate: today, quantityMicros: QUANTITY, avgPriceMicros: 150_000_000 });
    expect(currentPriceSyncState()).toBe('ok');
  });

  it('non manda mai quote o importi, solo il codice', async () => {
    const holdings = await holdingNamed('ETFA');
    await syncPrices(holdings, await db.holdingSnapshots.toArray(), today);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(new URL(url).origin).toBe('https://api.onvista.de');
      expect(url).not.toContain(String(QUANTITY));
      expect(url).not.toContain('150');
    }
  });

  it('un nome scritto a parole non genera connessioni', async () => {
    const holdings = await holdingNamed('ETF Mondo (demo)');
    await syncPrices(holdings, await db.holdingSnapshots.toArray(), today);
    expect(urls).toEqual([]);
    expect(currentPriceSyncState()).toBe('idle');
  });

  it('senza strumenti non si collega a niente', async () => {
    await syncPrices([], [], today);
    expect(urls).toEqual([]);
  });

  it('un codice che non esiste resta a mano, e non lo cerca di nuovo a ogni apertura della pagina', async () => {
    const holdings = await holdingNamed('NONC');
    await syncPrices(holdings, await db.holdingSnapshots.toArray(), today);
    expect(await summary()).toMatchObject({ priceMicros: 160_000_000 });
    const searches = urls.length;
    vi.setSystemTime(new Date('2026-10-30T19:00:00.000Z'));
    await syncPrices(holdings, await db.holdingSnapshots.toArray(), today);
    expect(urls.length).toBe(searches);
  });

  it('non rifà la lettura se l’ha appena fatta, ma la rifà dopo dieci minuti', async () => {
    await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    await syncPrices(await db.holdings.toArray(), await db.holdingSnapshots.toArray(), today);
    expect(quoteCalls()).toBe(1);

    price = 170;
    vi.setSystemTime(new Date('2026-10-30T18:05:00.000Z'));
    await syncPrices(await db.holdings.toArray(), await db.holdingSnapshots.toArray(), today);
    expect(quoteCalls()).toBe(1);

    vi.setSystemTime(new Date('2026-10-30T18:11:00.000Z'));
    await syncPrices(await db.holdings.toArray(), await db.holdingSnapshots.toArray(), today);
    expect(quoteCalls()).toBe(2);
    expect(await summary()).toMatchObject({ priceMicros: 170_000_000 });
    expect(await db.holdingSnapshots.count()).toBe(2);
  });

  it('senza rete tiene l’ultimo prezzo, lo dice e riprova dopo un minuto', async () => {
    await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    failing = true;
    await syncPrices(await db.holdings.toArray(), await db.holdingSnapshots.toArray(), today);
    expect(currentPriceSyncState()).toBe('failed');
    expect(await summary()).toMatchObject({ priceMicros: 160_000_000 });

    failing = false;
    await syncPrices(await db.holdings.toArray(), await db.holdingSnapshots.toArray(), today);
    expect(currentPriceSyncState()).toBe('failed');

    vi.setSystemTime(new Date('2026-10-30T18:02:00.000Z'));
    await syncPrices(await db.holdings.toArray(), await db.holdingSnapshots.toArray(), today);
    expect(currentPriceSyncState()).toBe('ok');
    expect(await summary()).toMatchObject({ priceMicros: 168_930_000 });
  });

  it('se la ricerca non riesce riprova alla volta dopo', async () => {
    const holdings = await holdingNamed('ETFA');
    failing = true;
    await syncPrices(holdings, await db.holdingSnapshots.toArray(), today);
    expect(currentPriceSyncState()).toBe('failed');
    expect((await db.holdings.toArray())[0]?.quoteSource).toBeUndefined();

    failing = false;
    vi.setSystemTime(new Date('2026-10-30T18:02:00.000Z'));
    await syncPrices(holdings, await db.holdingSnapshots.toArray(), today);
    expect((await db.holdings.toArray())[0]?.quoteSource).toBe('FUND/123');
  });
});

describe('prezzi passati', () => {
  const sync = async () => syncPrices(await db.holdings.toArray(), await db.holdingSnapshots.toArray(), today);

  it('riempie dalla data di acquisto in poi, senza toccare quote e prezzo di acquisto', async () => {
    await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    closes = [['2026-09-30', 100], ['2026-10-01', 101], ['2026-10-02', 102.5], ['2026-10-29', 110]];
    await sync();

    const data = { holdings: await db.holdings.toArray(), rows: await db.holdingSnapshots.toArray() };
    expect(data.holdings[0]?.historyFrom).toBe('2026-10-01');
    const dates = data.rows.map(({ date }) => date).sort();
    expect(dates).toEqual(['2026-10-01', '2026-10-02', '2026-10-29', '2026-10-30']);
    expect(data.rows.find(({ date }) => date === '2026-10-01')).toMatchObject({ priceMicros: 101_000_000, quantityMicros: QUANTITY, avgPriceMicros: 150_000_000 });
    expect(data.rows.find(({ date }) => date === '2026-10-02')).not.toHaveProperty('quantityMicros');
    expect(await summary()).toMatchObject({ priceMicros: 168_930_000, quantityMicros: QUANTITY });
  });

  it('chiede tutta la storia, così la data di acquisto non esce dal telefono', async () => {
    await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    await sync();
    expect(historyCalls()).toHaveLength(1);
    const url = new URL(historyCalls()[0] ?? '');
    expect(url.pathname).toContain('/instruments/FUND/123/eod_history');
    expect(Object.fromEntries(url.searchParams)).toEqual({ idNotation: '555', range: 'MAX', startDate: '2000-01-01' });
    expect(url.href).not.toContain('2026-10-01');
  });

  it('non la rilegge se c’è già', async () => {
    await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    await sync();
    vi.setSystemTime(new Date('2026-10-30T19:00:00.000Z'));
    await sync();
    expect(quoteCalls()).toBe(2);
    expect(historyCalls()).toHaveLength(1);
  });

  it('una data più vecchia indicata dopo non aspetta il giro successivo', async () => {
    await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    await sync();
    const [holding] = await db.holdings.toArray();
    await db.holdingSnapshots.add({ id: `${holding?.id}|2026-09-01`, holdingId: holding?.id ?? '', date: '2026-09-01', quantityMicros: QUANTITY, avgPriceMicros: 150_000_000, priceMicros: 150_000_000 });
    closes = [['2026-09-01', 90], ['2026-09-02', 91]];
    await sync();
    expect(historyCalls()).toHaveLength(2);
    expect((await db.holdings.toArray())[0]?.historyFrom).toBe('2026-09-01');
    expect(await db.holdingSnapshots.get(`${holding?.id}|2026-09-02`)).toMatchObject({ priceMicros: 91_000_000 });
  });

  it('riempie i giorni in cui l’app è rimasta chiusa, chiedendo solo quelli', async () => {
    await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    await sync();
    const [holding] = await db.holdings.toArray();
    await db.holdingSnapshots.delete(`${holding?.id}|2026-10-30`);
    await db.holdingSnapshots.put({ id: `${holding?.id}|2026-10-20`, holdingId: holding?.id ?? '', date: '2026-10-20', priceMicros: 100_000_000 });
    closes = [['2026-10-20', 100], ['2026-10-21', 101], ['2026-10-29', 109]];
    vi.setSystemTime(new Date('2026-10-30T19:00:00.000Z'));
    await sync();

    const url = new URL(historyCalls().at(-1) ?? '');
    expect(Object.fromEntries(url.searchParams)).toEqual({ idNotation: '555', range: 'Y1', startDate: '2026-10-20' });
    expect(await db.holdingSnapshots.get(`${holding?.id}|2026-10-21`)).toMatchObject({ priceMicros: 101_000_000 });
    expect((await db.holdings.toArray())[0]?.historyFrom).toBe('2026-10-01');
  });

  it('uno strumento comprato oggi non ha storia da leggere', async () => {
    await createHolding(
      { accountId, instrument: 'ETFA', isin: '', quoteSource: 'FUND/123' },
      { date: today, quantityMicros: QUANTITY, avgPriceMicros: 150_000_000, priceMicros: 160_000_000 },
      today,
    );
    await sync();
    expect(historyCalls()).toEqual([]);
    expect(await summary()).toMatchObject({ priceMicros: 168_930_000 });
  });

  it('se lo storico non arriva lo dice, tiene il prezzo e riprova dopo un minuto', async () => {
    await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    historyFails = true;
    await sync();
    expect(currentPriceSyncState()).toBe('failed');
    expect((await db.holdings.toArray())[0]?.historyFrom).toBeUndefined();

    await sync();
    expect(historyCalls()).toHaveLength(1);

    historyFails = false;
    closes = [['2026-10-02', 102]];
    vi.setSystemTime(new Date('2026-10-30T18:02:00.000Z'));
    await sync();
    expect(currentPriceSyncState()).toBe('ok');
    expect((await db.holdings.toArray())[0]?.historyFrom).toBe('2026-10-01');
  });

  it('senza un prezzo in euro non continua a chiedere', async () => {
    await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    vi.stubGlobal('fetch', async (input: string) => {
      urls.push(input);
      return Response.json({ list: [] });
    });
    await sync();
    expect(currentPriceSyncState()).toBe('ok');
    expect((await db.holdings.toArray())[0]?.historyFrom).toBe('2026-10-01');
    const calls = urls.length;
    await sync();
    expect(urls.length).toBe(calls);
  });

  it('legge le chiusure della borsa indicata', async () => {
    closes = [['2026-10-29', 10.302]];
    expect(await fetchHistory('FUND/123', 555, { from: '2026-10-01', whole: false })).toEqual([{ date: '2026-10-29', priceMicros: 10_302_000 }]);
  });
});
