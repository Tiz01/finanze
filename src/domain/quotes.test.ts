import { describe, expect, it } from 'vitest';
import { findMatch, isIsin, isQuoteSource, isSearchable, normalizeCode, parseHistory, pickQuote } from './quotes';

function item(fields: object) {
  return { type: 'Instrument', entityType: 'FUND', entityValue: '123', name: 'ETF Prova', isin: 'XX0000000001', symbol: 'ETFA', ...fields };
}

function quote(codeMarket: string, last: unknown, datetimeLast: string, isoCurrency = 'EUR') {
  return { market: { codeMarket, name: `Borsa ${codeMarket}`, idNotation: 7 }, last, datetimeLast, isoCurrency };
}

describe('codici', () => {
  it('riconosce un ISIN', () => {
    expect(isIsin('XX0000000001')).toBe(true);
    expect(isIsin('XX000000000A')).toBe(false);
    expect(isIsin('ETFA')).toBe(false);
  });

  it('cerca solo codici e ISIN: un nome scritto a parole resta sul telefono', () => {
    expect(isSearchable(normalizeCode(' etfa '))).toBe(true);
    expect(isSearchable('XX0000000001')).toBe(true);
    expect(isSearchable('A.B-2')).toBe(true);
    expect(isSearchable('')).toBe(false);
    expect(isSearchable('A')).toBe(false);
    expect(isSearchable('ETF MONDO')).toBe(false);
    expect(isSearchable('ETF MONDO (DEMO)')).toBe(false);
    expect(isSearchable('CODICE-TROPPO-LUNGO')).toBe(false);
  });

  it('accetta solo fonti nella forma giusta', () => {
    expect(isQuoteSource('FUND/123')).toBe(true);
    expect(isQuoteSource('FUND/ISIN:XX0000000001')).toBe(true);
    expect(isQuoteSource('FUND')).toBe(false);
    expect(isQuoteSource('../altro')).toBe(false);
    expect(isQuoteSource('FUND/1?a=b')).toBe(false);
    expect(isQuoteSource(3)).toBe(false);
  });
});

describe('findMatch', () => {
  it('trova per ISIN e per codice', () => {
    const response = { list: [item({})] };
    const expected = { source: 'FUND/123', isin: 'XX0000000001', name: 'ETF Prova' };
    expect(findMatch(response, 'XX0000000001')).toEqual(expected);
    expect(findMatch(response, 'ETFA')).toEqual(expected);
  });

  it('non accetta uno strumento solo simile', () => {
    expect(findMatch({ list: [item({ symbol: 'ETFAB', isin: 'XX0000000002' })] }, 'ETFA')).toBeNull();
    expect(findMatch({ list: [] }, 'ETFA')).toBeNull();
  });

  it('prende il primo che corrisponde', () => {
    const response = { list: [item({ symbol: 'ALTRO', entityValue: '1' }), item({ entityValue: '2' })] };
    expect(findMatch(response, 'ETFA')?.source).toBe('FUND/2');
  });

  it('funziona anche per azioni e obbligazioni', () => {
    expect(findMatch({ list: [item({ entityType: 'BOND', symbol: null })] }, 'XX0000000001')?.source).toBe('FUND/123'.replace('FUND', 'BOND'));
  });

  it('ignora risposte rovinate', () => {
    expect(findMatch(null, 'ETFA')).toBeNull();
    expect(findMatch('errore', 'ETFA')).toBeNull();
    expect(findMatch({ list: 'no' }, 'ETFA')).toBeNull();
    expect(findMatch({ list: [3, null, item({ type: 'News' }), item({ name: 3 }), item({ entityType: '../x' })] }, 'ETFA')).toBeNull();
  });
});

describe('pickQuote', () => {
  // In ora locale: la data del prezzo è quella del posto in cui si è.
  const now = new Date(2026, 9, 30, 15).toISOString();

  it('preferisce Milano', () => {
    const response = { list: [quote('_GER', 169, now), quote('_MIL', 168.93, new Date(2026, 9, 30, 14).toISOString()), quote('_TRO', 170, now)] };
    expect(pickQuote(response)).toEqual({ priceMicros: 168_930_000, date: '2026-10-30', market: 'Borsa _MIL', notation: 7 });
  });

  it('senza Milano prende Xetra, poi il più recente', () => {
    expect(pickQuote({ list: [quote('_TRO', 170, now), quote('_GER', 169, '2026-10-29T14:00:00.000+00:00')] })?.priceMicros).toBe(169_000_000);
    expect(pickQuote({ list: [quote('_STU', 170, '2026-10-29T14:00:00.000+00:00'), quote('_TRO', 171, now)] })?.priceMicros).toBe(171_000_000);
  });

  it('lascia una borsa preferita ferma da più di una settimana', () => {
    const response = { list: [quote('_MIL', 100, '2026-10-01T14:00:00.000+00:00'), quote('_TRO', 171, now)] };
    expect(pickQuote(response)?.priceMicros).toBe(171_000_000);
  });

  it('guarda solo gli euro', () => {
    expect(pickQuote({ list: [quote('_MIL', 188, now, 'USD'), quote('_TRO', 171, now)] })?.priceMicros).toBe(171_000_000);
    expect(pickQuote({ list: [quote('_LSE', 188, now, 'USD')] })).toBeNull();
  });

  it('tiene i decimali delle quotazioni', () => {
    expect(pickQuote({ list: [quote('_MIL', 10.302, now)] })?.priceMicros).toBe(10_302_000);
    expect(pickQuote({ list: [quote('_MIL', 0.1 + 0.2, now)] })?.priceMicros).toBe(300_000);
  });

  it('dà la data del posto in cui si è', () => {
    const late = new Date(2026, 9, 30, 23, 30);
    expect(pickQuote({ list: [quote('_MIL', 10, late.toISOString())] })?.date).toBe('2026-10-30');
  });

  it('ignora prezzi e risposte rovinati', () => {
    expect(pickQuote(null)).toBeNull();
    expect(pickQuote({ list: 'no' })).toBeNull();
    expect(pickQuote({ list: [] })).toBeNull();
    expect(pickQuote({ list: [quote('_MIL', 0, now), quote('_MIL', -1, now), quote('_MIL', '10', now), quote('_MIL', 10, 'ieri'), 3, { isoCurrency: 'EUR' }] })).toBeNull();
    expect(pickQuote({ list: [quote('_MIL', 1e300, now)] })).toBeNull();
  });
});

describe('parseHistory', () => {
  const noon = (date: string) => Date.parse(`${date}T12:00:00.000Z`) / 1000;

  it('legge giorno e prezzo di chiusura', () => {
    const response = { isoCurrency: 'EUR', datetimeLast: [noon('2026-10-29'), noon('2026-10-30')], last: [168.5, 10.304] };
    expect(parseHistory(response)).toEqual([
      { date: '2026-10-29', priceMicros: 168_500_000 },
      { date: '2026-10-30', priceMicros: 10_304_000 },
    ]);
  });

  it('il giorno è quello del server, in qualsiasi fuso orario ci si trovi', () => {
    const [point] = parseHistory({ isoCurrency: 'EUR', datetimeLast: [noon('2026-01-01')], last: [1] });
    expect(point?.date).toBe('2026-01-01');
  });

  it('salta le righe rovinate e tiene le altre', () => {
    const response = {
      isoCurrency: 'EUR',
      datetimeLast: [noon('2026-10-26'), 'ieri', noon('2026-10-27'), noon('2026-10-28'), 1e20, noon('2026-10-30')],
      last: [10, 11, 0, 'dodici', 13, 14],
    };
    expect(parseHistory(response).map(({ date }) => date)).toEqual(['2026-10-26', '2026-10-30']);
  });

  it('niente di utile in altre valute o in risposte rovinate', () => {
    expect(parseHistory({ isoCurrency: 'USD', datetimeLast: [noon('2026-10-30')], last: [10] })).toEqual([]);
    expect(parseHistory({ isoCurrency: 'EUR', datetimeLast: 'no', last: [10] })).toEqual([]);
    expect(parseHistory({ isoCurrency: 'EUR' })).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
  });
});
