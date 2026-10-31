import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccount } from './db/accounts';
import { db } from './db/db';
import { createHolding, type HoldingDraft } from './db/investments';
import { summarizeHoldings } from './domain/investments';
import { currentPriceSyncState, findInstrument, fetchQuote, resetPriceSync, syncPrices } from './quotes';

const today = '2026-10-30';
const QUANTITY = 12_345_000;

let accountId = '';
let urls: string[] = [];
let failing = false;
let price = 168.93;

function respond(url: string): Response {
  if (url.includes('/instruments/query')) {
    const code = new URL(url).searchParams.get('searchValue');
    const list = code === 'ETFA' ? [{ type: 'Instrument', entityType: 'FUND', entityValue: '123', name: 'ETF Prova', isin: 'XX0000000001', symbol: 'ETFA' }] : [];
    return Response.json({ list });
  }
  return Response.json({
    list: [{ market: { codeMarket: '_MIL', name: 'Euronext Milan' }, last: price, isoCurrency: 'EUR', datetimeLast: new Date(2026, 9, 30, 15).toISOString() }],
  });
}

beforeEach(async () => {
  urls = [];
  failing = false;
  price = 168.93;
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

async function summary() {
  const [first] = summarizeHoldings(await db.holdings.toArray(), await db.holdingSnapshots.toArray(), today);
  return first;
}

describe('ricerca', () => {
  it('trova uno strumento e il suo prezzo', async () => {
    const match = await findInstrument('ETFA');
    expect(match).toEqual({ source: 'FUND/123', isin: 'XX0000000001', name: 'ETF Prova' });
    expect(await fetchQuote('FUND/123')).toEqual({ priceMicros: 168_930_000, date: '2026-10-30', market: 'Euronext Milan' });
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
    await syncPrices(holdings, today);

    expect(await db.holdings.toArray()).toMatchObject([{ quoteSource: 'FUND/123', isin: 'XX0000000001' }]);
    expect(await summary()).toMatchObject({ priceMicros: 168_930_000, priceDate: today, quantityMicros: QUANTITY, avgPriceMicros: 150_000_000 });
    expect(currentPriceSyncState()).toBe('ok');
  });

  it('non manda mai quote o importi, solo il codice', async () => {
    const holdings = await holdingNamed('ETFA');
    await syncPrices(holdings, today);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(new URL(url).origin).toBe('https://api.onvista.de');
      expect(url).not.toContain(String(QUANTITY));
      expect(url).not.toContain('150');
    }
  });

  it('un nome scritto a parole non genera connessioni', async () => {
    const holdings = await holdingNamed('ETF Mondo (demo)');
    await syncPrices(holdings, today);
    expect(urls).toEqual([]);
    expect(currentPriceSyncState()).toBe('idle');
  });

  it('senza strumenti non si collega a niente', async () => {
    await syncPrices([], today);
    expect(urls).toEqual([]);
  });

  it('un codice che non esiste resta a mano, e non lo cerca di nuovo a ogni apertura della pagina', async () => {
    const holdings = await holdingNamed('NONC');
    await syncPrices(holdings, today);
    expect(await summary()).toMatchObject({ priceMicros: 160_000_000 });
    const searches = urls.length;
    vi.setSystemTime(new Date('2026-10-30T19:00:00.000Z'));
    await syncPrices(holdings, today);
    expect(urls.length).toBe(searches);
  });

  it('non rifà la lettura se l’ha appena fatta, ma la rifà dopo dieci minuti', async () => {
    const holdings = await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    await syncPrices(holdings, today);
    expect(urls).toHaveLength(1);

    price = 170;
    vi.setSystemTime(new Date('2026-10-30T18:05:00.000Z'));
    await syncPrices(holdings, today);
    expect(urls).toHaveLength(1);

    vi.setSystemTime(new Date('2026-10-30T18:11:00.000Z'));
    await syncPrices(holdings, today);
    expect(urls).toHaveLength(2);
    expect(await summary()).toMatchObject({ priceMicros: 170_000_000 });
    expect(await db.holdingSnapshots.count()).toBe(2);
  });

  it('senza rete tiene l’ultimo prezzo, lo dice e riprova dopo un minuto', async () => {
    const holdings = await holdingNamed('ETFA', { quoteSource: 'FUND/123' });
    failing = true;
    await syncPrices(holdings, today);
    expect(currentPriceSyncState()).toBe('failed');
    expect(await summary()).toMatchObject({ priceMicros: 160_000_000 });

    failing = false;
    await syncPrices(holdings, today);
    expect(currentPriceSyncState()).toBe('failed');

    vi.setSystemTime(new Date('2026-10-30T18:02:00.000Z'));
    await syncPrices(holdings, today);
    expect(currentPriceSyncState()).toBe('ok');
    expect(await summary()).toMatchObject({ priceMicros: 168_930_000 });
  });

  it('se la ricerca non riesce riprova alla volta dopo', async () => {
    const holdings = await holdingNamed('ETFA');
    failing = true;
    await syncPrices(holdings, today);
    expect(currentPriceSyncState()).toBe('failed');
    expect((await db.holdings.toArray())[0]?.quoteSource).toBeUndefined();

    failing = false;
    vi.setSystemTime(new Date('2026-10-30T18:02:00.000Z'));
    await syncPrices(holdings, today);
    expect((await db.holdings.toArray())[0]?.quoteSource).toBe('FUND/123');
  });
});
