import { describe, expect, it } from 'vitest';
import {
  accountOverviews,
  activeHoldings,
  formatMicros,
  hasPosition,
  historyNeeded,
  investmentSeries,
  isHistoryMissing,
  overviewTotals,
  parseMicros,
  portfolioTotals,
  positionAt,
  positionValueCents,
  priceAgeLabel,
  snapshotAt,
  snapshotsByHolding,
  summarizeHoldings,
} from './investments';
import type { Account, Holding, HoldingSnapshot } from './types';

const today = '2026-10-30';

function holding(id: string, accountId = 'broker'): Holding {
  return { id, accountId, instrument: id.toUpperCase(), isin: '', createdAt: '2026-01-01T00:00:00.000Z' };
}

function snapshot(holdingId: string, date: string, quantity: number, avg: number, price: number): HoldingSnapshot {
  return {
    id: `${holdingId}|${date}`,
    holdingId,
    date,
    quantityMicros: Math.round(quantity * 1_000_000),
    avgPriceMicros: Math.round(avg * 1_000_000),
    priceMicros: Math.round(price * 1_000_000),
  };
}

function account(id: string, fields: Partial<Account> = {}): Account {
  return {
    id,
    name: id,
    type: 'investimento',
    currency: 'EUR',
    initialBalanceCents: 0,
    initialBalanceDate: '2026-01-01',
    archived: false,
    contaComeLiquidita: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...fields,
  };
}

describe('parseMicros', () => {
  it.each([
    ['12,5', 12_500_000],
    ['30', 30_000_000],
    ['10,356', 10_356_000],
    ['168,39', 168_390_000],
    ['168.39', 168_390_000],
    ['1.234,56', 1_234_560_000],
    ['1,234.56', 1_234_560_000],
    ['1.234', 1_234_000_000],
    ['1.234.567', 1_234_567_000_000],
    ['1,234,567', 1_234_567_000_000],
    ['0,123456', 123_456],
    [',5', 500_000],
    ['  12,5 € ', 12_500_000],
    ['0', 0],
  ])('legge %s', (text, expected) => {
    expect(parseMicros(text)).toBe(expected);
  });

  it.each(['', ' ', 'abc', '-5', '12,5,6', '1.23.45', '12a', ',', '.', '0,1234567', '2.000.000.000'])('rifiuta «%s»', (text) => {
    expect(parseMicros(text)).toBeNull();
  });
});

describe('formatMicros', () => {
  it('toglie gli zeri inutili', () => {
    expect(formatMicros(12_500_000)).toBe('12,5');
    expect(formatMicros(30_000_000)).toBe('30');
    expect(formatMicros(10_356_000)).toBe('10,356');
    expect(formatMicros(123_456)).toBe('0,123456');
  });

  it('tiene i centesimi quando servono', () => {
    expect(formatMicros(170_000_000, 2)).toBe('170,00');
    expect(formatMicros(168_390_000, 2)).toBe('168,39');
    expect(formatMicros(10_356_000, 2)).toBe('10,356');
  });

  it('separa le migliaia', () => {
    expect(formatMicros(1_234_560_000, 2)).toBe('1.234,56');
  });

  it('quello che scrive si rilegge uguale', () => {
    for (const value of [12_500_000, 30_000_000, 10_356_000, 1_234_560_000, 123_456, 1_000_000_000_000]) {
      expect(parseMicros(formatMicros(value))).toBe(value);
      expect(parseMicros(formatMicros(value, 2))).toBe(value);
    }
  });
});

describe('positionValueCents', () => {
  it('moltiplica quote e prezzo', () => {
    expect(positionValueCents(30_000_000, 168_390_000)).toBe(505_170);
    expect(positionValueCents(100_000_000, 10_356_000)).toBe(103_560);
  });

  it('funziona con le quote frazionarie', () => {
    expect(positionValueCents(1_500_000, 100_000_000)).toBe(15_000);
    expect(positionValueCents(123_456, 100_000_000)).toBe(1_235);
  });

  it('arrotonda al centesimo più vicino', () => {
    expect(positionValueCents(1_000_000, 10_354_000)).toBe(1_035);
    expect(positionValueCents(1_000_000, 10_355_000)).toBe(1_036);
  });

  it('resta esatto anche con numeri che i float sbaglierebbero', () => {
    expect(positionValueCents(1_000_000_000_000, 987_654_321)).toBe(98_765_432_100);
    expect(positionValueCents(3_000_000, 100_100_000)).toBe(30_030);
  });

  it('zero quote valgono zero', () => {
    expect(positionValueCents(0, 168_390_000)).toBe(0);
  });
});

describe('snapshotAt', () => {
  const list = [snapshot('a', '2026-08-01', 1, 1, 1), snapshot('a', '2026-09-01', 2, 1, 1), snapshot('a', '2026-10-01', 3, 1, 1)];

  it('prende l’ultimo fino a quella data', () => {
    expect(snapshotAt(list, '2026-09-15')?.date).toBe('2026-09-01');
    expect(snapshotAt(list, '2026-09-01')?.date).toBe('2026-09-01');
    expect(snapshotAt(list, '2026-12-01')?.date).toBe('2026-10-01');
  });

  it('prima del primo non c’è niente', () => {
    expect(snapshotAt(list, '2026-07-31')).toBeUndefined();
  });

  it('ordina gli aggiornamenti anche se arrivano in disordine', () => {
    const grouped = snapshotsByHolding([snapshot('a', '2026-10-01', 3, 1, 1), snapshot('b', '2026-01-01', 1, 1, 1), snapshot('a', '2026-08-01', 1, 1, 1)]);
    expect(grouped.get('a')?.map(({ date }) => date)).toEqual(['2026-08-01', '2026-10-01']);
    expect(grouped.get('b')).toHaveLength(1);
  });
});

describe('summarizeHoldings', () => {
  it('calcola valore, costo e guadagno dall’ultimo aggiornamento', () => {
    const [summary] = summarizeHoldings(
      [holding('a')],
      [snapshot('a', '2026-09-01', 25, 150, 160), snapshot('a', '2026-10-20', 30, 151.5, 168.39)],
      today,
    );
    expect(summary).toMatchObject({
      quantityMicros: 30_000_000,
      priceDate: '2026-10-20',
      valueCents: 505_170,
      costCents: 454_500,
      gainCents: 50_670,
    });
    expect(summary?.gainRate).toBeCloseTo(0.11148, 4);
  });

  it('segna le perdite con il segno meno', () => {
    const [summary] = summarizeHoldings([holding('a')], [snapshot('a', '2026-10-01', 10, 100, 90)], today);
    expect(summary?.gainCents).toBe(-10_000);
    expect(summary?.gainRate).toBeCloseTo(-0.1);
  });

  it('senza costo non c’è percentuale', () => {
    const [summary] = summarizeHoldings([holding('a')], [snapshot('a', '2026-10-01', 10, 0, 90)], today);
    expect(summary?.gainCents).toBe(90_000);
    expect(summary?.gainRate).toBeNull();
  });

  it('ignora gli aggiornamenti futuri e gli strumenti senza aggiornamenti', () => {
    const summaries = summarizeHoldings(
      [holding('a'), holding('b')],
      [snapshot('a', '2026-10-01', 1, 1, 1), snapshot('a', '2026-11-01', 9, 9, 9)],
      today,
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.quantityMicros).toBe(1_000_000);
  });
});

describe('portfolioTotals', () => {
  it('somma i valori così come compaiono nelle righe', () => {
    const summaries = summarizeHoldings(
      [holding('a'), holding('b')],
      [snapshot('a', '2026-10-20', 30, 151.5, 168.39), snapshot('b', '2026-10-05', 100, 10.1, 10.356)],
      today,
    );
    const totals = portfolioTotals(summaries);
    expect(totals.valueCents).toBe(505_170 + 103_560);
    expect(totals.costCents).toBe(454_500 + 101_000);
    expect(totals.gainCents).toBe(50_670 + 2_560);
    expect(totals.gainRate).toBeCloseTo(53_230 / 555_500);
  });

  it('dice qual è il prezzo più vecchio', () => {
    const summaries = summarizeHoldings(
      [holding('a'), holding('b')],
      [snapshot('a', '2026-10-20', 1, 1, 1), snapshot('b', '2026-10-05', 1, 1, 1)],
      today,
    );
    expect(portfolioTotals(summaries).oldestPriceDate).toBe('2026-10-05');
  });

  it('senza strumenti è tutto a zero', () => {
    expect(portfolioTotals([])).toEqual({ valueCents: 0, costCents: 0, gainCents: 0, gainRate: null, oldestPriceDate: null });
  });
});

describe('activeHoldings', () => {
  it('lascia fuori i conti archiviati e quelli di altro tipo', () => {
    const accounts = [account('broker'), account('vecchio', { archived: true }), account('corrente', { type: 'corrente' })];
    const result = activeHoldings([holding('a', 'broker'), holding('b', 'vecchio'), holding('c', 'corrente')], accounts);
    expect(result.map(({ id }) => id)).toEqual(['a']);
  });
});

describe('investmentSeries', () => {
  it('riporta l’ultimo valore noto nei giorni senza aggiornamenti', () => {
    const points = investmentSeries(
      [holding('a')],
      [snapshot('a', '2026-10-28', 10, 100, 110), snapshot('a', '2026-10-30', 10, 100, 120)],
      today,
    );
    expect(points).toEqual([
      { date: '2026-10-28', cents: 110_000, baselineCents: 100_000 },
      { date: '2026-10-29', cents: 110_000, baselineCents: 100_000 },
      { date: '2026-10-30', cents: 120_000, baselineCents: 100_000 },
    ]);
  });

  it('uno strumento entra nel totale dal suo primo aggiornamento', () => {
    const points = investmentSeries(
      [holding('a'), holding('b')],
      [snapshot('a', '2026-10-28', 1, 100, 100), snapshot('b', '2026-10-29', 1, 50, 50)],
      '2026-10-29',
    );
    expect(points.map(({ cents }) => cents)).toEqual([10_000, 15_000]);
  });

  it('le quote comprate dopo alzano sia il valore sia il costo', () => {
    const points = investmentSeries(
      [holding('a')],
      [snapshot('a', '2026-10-29', 1, 100, 100), snapshot('a', '2026-10-30', 2, 100, 100)],
      today,
    );
    expect(points.at(-1)).toMatchObject({ cents: 20_000, baselineCents: 20_000 });
  });

  it('considera solo gli strumenti chiesti', () => {
    const points = investmentSeries([holding('a')], [snapshot('a', '2026-10-30', 1, 1, 1), snapshot('b', '2026-10-30', 9, 9, 9)], today);
    expect(points).toEqual([{ date: today, cents: 100, baselineCents: 100 }]);
  });

  it('ignora gli aggiornamenti futuri e non restituisce punti se non ce ne sono', () => {
    expect(investmentSeries([holding('a')], [snapshot('a', '2026-11-01', 1, 1, 1)], today)).toEqual([]);
    expect(investmentSeries([], [], today)).toEqual([]);
  });

  it('su anni di storia resta leggera, compresi primo e ultimo giorno', () => {
    const points = investmentSeries([holding('a')], [snapshot('a', '2020-01-01', 1, 1, 1)], today);
    expect(points.length).toBeLessThanOrEqual(400);
    expect(points[0]?.date).toBe('2020-01-01');
    expect(points.at(-1)?.date).toBe(today);
  });
});

describe('priceAgeLabel', () => {
  it('dice quanto sono vecchi i prezzi', () => {
    expect(priceAgeLabel(today, today)).toBe('prezzi di oggi');
    expect(priceAgeLabel('2026-10-29', today)).toBe('prezzi di ieri');
    expect(priceAgeLabel('2026-10-20', today)).toBe('prezzi di 10 giorni fa');
  });
});

describe('righe del solo prezzo', () => {
  function price(holdingId: string, date: string, value: number): HoldingSnapshot {
    return { id: `${holdingId}|${date}`, holdingId, date, priceMicros: Math.round(value * 1_000_000) };
  }

  it('prendono quote e prezzo medio dall’ultima riga che li ha', () => {
    const [summary] = summarizeHoldings(
      [holding('a')],
      [snapshot('a', '2026-10-01', 10, 100, 100), price('a', '2026-10-20', 120)],
      today,
    );
    expect(summary).toMatchObject({ quantityMicros: 10_000_000, avgPriceMicros: 100_000_000, priceMicros: 120_000_000, priceDate: '2026-10-20', valueCents: 120_000, gainCents: 20_000 });
  });

  it('un nuovo acquisto vale dalla sua data in poi', () => {
    const points = investmentSeries(
      [holding('a')],
      [snapshot('a', '2026-10-28', 10, 100, 100), price('a', '2026-10-29', 110), snapshot('a', '2026-10-30', 20, 105, 120)],
      today,
    );
    expect(points.map(({ cents, baselineCents }) => [cents, baselineCents])).toEqual([
      [100_000, 100_000],
      [110_000, 100_000],
      [240_000, 210_000],
    ]);
  });

  it('senza una riga con le quote lo strumento non ha valore', () => {
    expect(summarizeHoldings([holding('a')], [price('a', '2026-10-20', 120)], today)).toEqual([]);
    expect(investmentSeries([holding('a')], [price('a', '2026-10-20', 120)], today)).toEqual([]);
  });

  it('la linea parte dalla prima riga con le quote, non dal primo prezzo', () => {
    const points = investmentSeries(
      [holding('a')],
      [price('a', '2026-10-20', 120), snapshot('a', '2026-10-29', 10, 100, 110), price('a', '2026-10-30', 130)],
      today,
    );
    expect(points.map(({ date }) => date)).toEqual(['2026-10-29', '2026-10-30']);
    expect(points.at(-1)).toMatchObject({ cents: 130_000, baselineCents: 100_000 });
  });

  it('riconosce le righe con le quote', () => {
    expect(hasPosition(snapshot('a', '2026-10-01', 1, 1, 1))).toBe(true);
    expect(hasPosition(price('a', '2026-10-01', 1))).toBe(false);
    expect(positionAt([snapshot('a', '2026-10-01', 1, 1, 1), price('a', '2026-10-02', 2)], '2026-10-30')?.date).toBe('2026-10-01');
    expect(positionAt([snapshot('a', '2026-10-01', 1, 1, 1)], '2026-09-30')).toBeUndefined();
  });
});

describe('storico dei prezzi', () => {
  const linked = (fields: Partial<Holding> = {}): Holding => ({ ...holding('a'), quoteSource: 'FUND/1', ...fields });
  const rows = [snapshot('a', '2026-10-01', 1, 1, 1), snapshot('a', '2026-10-29', 1, 1, 1)];

  it('manca se non è mai stato letto', () => {
    expect(isHistoryMissing(linked(), rows, today)).toBe(true);
    expect(historyNeeded(linked(), rows, today, today)).toEqual({ from: '2026-10-01', whole: true });
  });

  it('manca se il primo acquisto è prima di quello che è stato letto', () => {
    expect(isHistoryMissing(linked({ historyFrom: '2026-10-15' }), rows, today)).toBe(true);
    expect(isHistoryMissing(linked({ historyFrom: '2026-10-01' }), rows, today)).toBe(false);
    expect(isHistoryMissing(linked({ historyFrom: '2026-09-01' }), rows, today)).toBe(false);
  });

  it('non serve a mano, senza quote o per chi ha comprato oggi', () => {
    expect(isHistoryMissing(holding('a'), rows, today)).toBe(false);
    expect(historyNeeded(holding('a'), rows, today, today)).toBeNull();
    expect(isHistoryMissing(linked(), [], today)).toBe(false);
    expect(historyNeeded(linked(), [], today, today)).toBeNull();
    expect(isHistoryMissing(linked(), [snapshot('a', today, 1, 1, 1)], today)).toBe(false);
  });

  it('un giorno di distanza è normale, di più sono giorni da riempire', () => {
    const read = linked({ historyFrom: '2026-10-01' });
    expect(historyNeeded(read, rows, '2026-10-29', today)).toBeNull();
    expect(historyNeeded(read, rows, '2026-10-30', today)).toBeNull();
    expect(historyNeeded(read, rows, '2026-11-02', '2026-11-02')).toEqual({ from: '2026-10-29', whole: false });
  });

  it('il grafico regge anni di chiusure con più cambi di quote', () => {
    const price = (date: string, value: number): HoldingSnapshot => ({ id: `a|${date}`, holdingId: 'a', date, priceMicros: value * 1_000_000 });
    const list: HoldingSnapshot[] = [snapshot('a', '2021-01-01', 1, 10, 10)];
    for (let year = 2021; year <= 2026; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const date = `${year}-${String(month).padStart(2, '0')}-15`;
        if (date < today) list.push(price(date, month));
      }
    }
    list.push(snapshot('a', '2026-01-20', 2, 10, 20));
    const points = investmentSeries([holding('a')], [...list].reverse(), today);
    expect(points.length).toBeLessThanOrEqual(400);
    expect(points[0]).toEqual({ date: '2021-01-01', cents: 1_000, baselineCents: 1_000 });
    expect(points.at(-1)).toMatchObject({ date: today, cents: 2_000, baselineCents: 2_000 });
  });
});

describe('investito e liquidità', () => {
  const rows = [snapshot('a', '2026-10-01', 10, 100, 120), snapshot('b', '2026-10-01', 5, 10, 10)];
  const summaries = summarizeHoldings([holding('a', 'uno'), holding('b', 'due')], rows, today);
  const balances = new Map([['uno', 50_000], ['due', 7_000], ['tre', 9_000]]);

  it('divide ogni conto tra investito e liquidità scritta', () => {
    const [uno] = accountOverviews([account('uno', { cashCents: 27_714, cashDate: today })], summaries, balances);
    expect(uno).toMatchObject({ investedCents: 120_000, cashCents: 27_714, totalCents: 147_714 });
    expect(uno?.holdings.map(({ holding: { id } }) => id)).toEqual(['a']);
  });

  it('la liquidità non è il saldo dei movimenti: con strumenti e senza indicazione, manca', () => {
    const [uno] = accountOverviews([account('uno')], summaries, balances);
    expect(uno).toMatchObject({ investedCents: 120_000, cashCents: null, totalCents: 120_000 });
  });

  it('senza strumenti i soldi registrati nel conto sono tutti liquidità', () => {
    const [tre] = accountOverviews([account('tre')], summaries, balances);
    expect(tre).toMatchObject({ investedCents: 0, cashCents: 9_000, totalCents: 9_000 });
  });

  it('una liquidità scritta vince sui movimenti, anche se è zero', () => {
    const [tre] = accountOverviews([account('tre', { cashCents: 0, cashDate: today })], summaries, balances);
    expect(tre).toMatchObject({ cashCents: 0, totalCents: 0 });
  });

  it('lascia fuori i conti archiviati e quelli di altro tipo', () => {
    const accounts = [account('uno'), account('vecchio', { archived: true }), account('corrente', { type: 'corrente' })];
    expect(accountOverviews(accounts, summaries, balances).map(({ account: { id } }) => id)).toEqual(['uno']);
  });

  it('somma tutti i conti e dice quanti non hanno ancora la liquidità', () => {
    const overviews = accountOverviews(
      [account('uno', { cashCents: 27_714, cashDate: today }), account('due'), account('tre', { cashCents: 1_000, cashDate: today })],
      summaries,
      balances,
    );
    const totals = overviewTotals(overviews);
    expect(totals).toMatchObject({ investedCents: 125_000, cashCents: 28_714, totalCents: 153_714, missingCash: 1 });
    expect(totals.investedShare).toBeCloseTo(125_000 / 153_714);
  });

  it('senza niente da dividere non c’è una percentuale', () => {
    expect(overviewTotals([])).toEqual({ investedCents: 0, cashCents: 0, totalCents: 0, missingCash: 0, investedShare: null });
  });

  it('una liquidità negativa dai movimenti non falsa la percentuale', () => {
    const overviews = accountOverviews([account('uno', { cashCents: 0, cashDate: today }), account('tre')], summaries, new Map([['tre', -5_000]]));
    const totals = overviewTotals(overviews);
    expect(totals).toMatchObject({ investedCents: 120_000, cashCents: -5_000, totalCents: 115_000 });
    expect(totals.investedShare).toBe(1);
  });
});
