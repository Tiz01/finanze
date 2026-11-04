import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from './categories';
import {
  interestFormValues,
  interestOverviews,
  interestStatus,
  interestTermsLabel,
  interestTermsProblem,
  parseInterestForm,
  previewInterest,
} from './interest';
import type { Account, InterestTerms, Transaction } from './types';

function terms(fields: Partial<InterestTerms> = {}): InterestTerms {
  return {
    ratePercentMicros: 4_000_000,
    rateKind: 'lordo',
    taxPercentMicros: 26_000_000,
    intervalMonths: 1,
    startDate: '2027-01-01',
    termMonths: 12,
    ...fields,
  };
}

function account(cents: number, fields: Partial<InterestTerms> = {}, accountFields: Partial<Account> = {}): Account {
  return {
    id: 'conto',
    name: 'Conto',
    type: 'remunerato',
    currency: 'EUR',
    initialBalanceCents: cents,
    initialBalanceDate: '2027-01-01',
    archived: false,
    contaComeLiquidita: false,
    createdAt: '2027-01-01T00:00:00.000Z',
    interest: terms(fields),
    ...accountFields,
  };
}

function move(date: string, cents: number): Transaction {
  const base = { id: `${date}-${cents}`, date, createdAt: `${date}T10:00:00.000Z` };
  return cents > 0
    ? { ...base, type: 'trasferimento', amountCents: cents, accountId: 'altro', toAccountId: 'conto' }
    : { ...base, type: 'trasferimento', amountCents: -cents, accountId: 'conto', toAccountId: 'altro' };
}

function status(item: Account, transactions: Transaction[], today: string) {
  const result = interestStatus(item, transactions, today);
  if (!result) throw new Error('nessuna condizione');
  return result;
}

describe('un accredito', () => {
  it('su un anno intero fa esattamente tasso per somma, meno la ritenuta', () => {
    const { next } = status(account(500_000, { intervalMonths: 12 }), [], '2027-01-01');
    expect(next).toMatchObject({ date: '2028-01-01', grossCents: 20_000, taxCents: 5_200, netCents: 14_800 });
  });

  it('conta i giorni veri del periodo, su 365', () => {
    const { pending } = status(account(500_000), [], '2027-02-01');
    // 5.000 € × 31 giorni × 4% / 365 = 16,99 €; il 26% fa 4,42 €.
    expect(pending).toEqual([{ date: '2027-02-01', periodStart: '2027-01-01', grossCents: 1_699, taxCents: 442, netCents: 1_257 }]);
  });

  it('con un tasso netto non toglie niente', () => {
    const { next } = status(account(500_000, { intervalMonths: 12, rateKind: 'netto' }), [], '2027-01-01');
    expect(next).toMatchObject({ grossCents: 20_000, taxCents: 0, netCents: 20_000 });
  });

  it('accetta decimali nel tasso', () => {
    const { next } = status(account(1_000_000, { intervalMonths: 12, ratePercentMicros: 2_250_000 }), [], '2027-01-01');
    expect(next?.grossCents).toBe(22_500);
  });

  it('resta esatto con somme grandi', () => {
    const { next } = status(account(9_000_000_000, { intervalMonths: 12 }), [], '2027-01-01');
    expect(next?.grossCents).toBe(360_000_000);
  });
});

describe('versamenti e prelievi', () => {
  it('un versamento rende dal suo giorno', () => {
    const { next } = status(account(100_000, { intervalMonths: 12 }), [move('2027-07-02', 100_000)], '2027-01-01');
    // 182 giorni con 1.000 € e 183 con 2.000 €.
    expect(next?.grossCents).toBe(6_005);
  });

  it('un prelievo smette di rendere dal suo giorno', () => {
    const { next } = status(account(200_000, { intervalMonths: 12 }), [move('2027-07-02', -100_000)], '2027-01-01');
    // 182 giorni con 2.000 € e 183 con 1.000 €.
    expect(next?.grossCents).toBe(5_995);
  });

  it('un movimento nel primo giorno conta da subito', () => {
    const { next } = status(account(100_000, { intervalMonths: 12 }), [move('2027-01-01', 100_000)], '2027-01-01');
    expect(next?.grossCents).toBe(8_000);
  });

  it('un saldo a zero o negativo non rende', () => {
    const emptied = status(account(100_000, { intervalMonths: 12 }), [move('2027-01-01', -150_000)], '2027-01-01');
    expect(emptied.next?.grossCents).toBe(0);
  });

  it('i movimenti prima del saldo iniziale sono già compresi', () => {
    const item = account(100_000, { intervalMonths: 12 }, { initialBalanceDate: '2027-01-01' });
    const { next } = status(item, [move('2026-06-01', 900_000)], '2027-01-01');
    expect(next?.grossCents).toBe(4_000);
  });

  it('prima del saldo iniziale non si conosce il saldo: si conta da lì', () => {
    const item = account(100_000, { intervalMonths: 12 }, { initialBalanceDate: '2027-07-02' });
    const { next } = status(item, [], '2027-07-02');
    // Solo i 183 giorni dal saldo iniziale.
    expect(next?.grossCents).toBe(2_005);
  });
});

describe('accrediti che si sommano', () => {
  it('quelli non ancora confermati contano per il periodo dopo', () => {
    const { pending } = status(account(500_000), [], '2027-03-15');
    expect(pending.map(({ date, netCents }) => [date, netCents])).toEqual([
      ['2027-02-01', 1_257],
      ['2027-03-01', 1_138],
    ]);
  });

  it('dice quanto è maturato finora e cosa arriva dopo', () => {
    const { accruedNetCents, next } = status(account(500_000), [], '2027-03-15');
    expect(accruedNetCents).toBe(571);
    expect(next).toMatchObject({ date: '2027-04-01', grossCents: 1_707, taxCents: 444, netCents: 1_263 });
  });

  it('confermare non cambia i calcoli successivi', () => {
    const before = status(account(500_000), [], '2027-03-15');
    const credited: Transaction = {
      id: 'i',
      date: '2027-02-01',
      type: 'entrata',
      amountCents: 1_257,
      accountId: 'conto',
      categoryId: CATEGORY_IDS.interessi,
      createdAt: '2027-02-01T10:00:00.000Z',
    };
    const after = status(account(500_000, { creditedThrough: '2027-02-01' }), [credited], '2027-03-15');
    expect(after.pending).toEqual(before.pending.slice(1));
    expect(after.next).toEqual(before.next);
    expect(after.projection?.balanceCents).toBe(before.projection?.balanceCents);
    expect(after.projection?.interestNetCents).toBe((before.projection?.interestNetCents ?? 0) - 1_257);
  });

  it('saltato un accredito, il periodo dopo non lo conta', () => {
    const { pending } = status(account(500_000, { creditedThrough: '2027-02-01' }), [], '2027-03-01');
    // 5.000 € × 28 giorni × 4% / 365 = 15,34 €.
    expect(pending[0]?.grossCents).toBe(1_534);
  });

  it('un accredito a zero non chiede conferma', () => {
    const { pending } = status(account(0), [], '2027-03-15');
    expect(pending).toEqual([]);
  });
});

describe('date', () => {
  it('senza data di fine il calendario va avanti, senza scivolare', () => {
    const dates = status(account(500_000, { startDate: '2027-01-31', termMonths: null }, { initialBalanceDate: '2027-01-31' }), [], '2027-05-01').pending.map(({ date }) => date);
    expect(dates).toEqual(['2027-02-28', '2027-03-31', '2027-04-30']);
  });

  it('ogni tre mesi, con l’ultimo accredito alla scadenza', () => {
    const dates = status(account(500_000, { intervalMonths: 3, termMonths: 7 }), [], '2028-01-01').pending.map(({ date }) => date);
    expect(dates).toEqual(['2027-04-01', '2027-07-01', '2027-08-01']);
  });

  it('a scadenza finita gli interessi si fermano', () => {
    const result = status(account(500_000, { intervalMonths: 12, termMonths: 12 }), [], '2029-06-01');
    expect(result).toMatchObject({ finished: true, next: null, projection: null, accruedNetCents: 0, endDate: '2028-01-01' });
    expect(result.pending).toHaveLength(1);
  });

  it('una partenza futura non ha ancora maturato niente', () => {
    const result = status(account(500_000, { startDate: '2027-06-01' }, { initialBalanceDate: '2027-06-01' }), [], '2027-01-01');
    expect(result).toMatchObject({ pending: [], accruedNetCents: 0, finished: false });
    expect(result.next?.date).toBe('2027-07-01');
  });

  it('cambiando frequenza dopo un accredito si riparte da lì', () => {
    const { next } = status(account(500_000, { intervalMonths: 3, creditedThrough: '2027-02-01' }), [], '2027-02-01');
    expect(next).toMatchObject({ periodStart: '2027-02-01', date: '2027-04-01' });
  });
});

describe('stima', () => {
  it('a fine periodo somma saldo e interessi futuri', () => {
    const { projection } = status(account(500_000, { intervalMonths: 12 }), [], '2027-06-01');
    expect(projection).toEqual({ date: '2028-01-01', interestNetCents: 14_800, balanceCents: 514_800 });
  });

  it('comprende versamenti con data futura', () => {
    const { projection } = status(account(100_000, { intervalMonths: 12 }), [move('2027-07-02', 100_000)], '2027-01-01');
    expect(projection?.balanceCents).toBe(200_000 + projection!.interestNetCents);
  });

  it('senza scadenza guarda ai prossimi dodici mesi', () => {
    const { endDate, projection } = status(account(500_000, { termMonths: null, intervalMonths: 12 }), [], '2027-01-01');
    expect(endDate).toBeNull();
    expect(projection).toMatchObject({ date: '2028-01-01', interestNetCents: 14_800 });
  });

  it('il conto senza condizioni non ha uno stato', () => {
    const { interest: _none, ...plain } = account(100);
    expect(interestStatus(plain, [], '2027-01-01')).toBeNull();
  });
});

describe('anteprima', () => {
  it('dice cosa rende la somma', () => {
    expect(previewInterest(terms({ intervalMonths: 12 }), 500_000)).toEqual({
      months: 12,
      grossCents: 20_000,
      taxCents: 5_200,
      netCents: 14_800,
      finalCents: 514_800,
    });
  });

  it('con accrediti mensili i netti rendono a loro volta', () => {
    const preview = previewInterest(terms(), 500_000);
    expect(preview.netCents).toBeGreaterThan(14_800);
    expect(preview.finalCents).toBe(500_000 + preview.netCents);
  });

  it('senza durata guarda a dodici mesi e ignora gli accrediti passati', () => {
    const preview = previewInterest(terms({ termMonths: null, intervalMonths: 12, creditedThrough: '2027-06-01' }), 500_000);
    expect(preview).toMatchObject({ months: 12, netCents: 14_800 });
  });
});

describe('modulo', () => {
  const values = interestFormValues(undefined, '2027-01-01');

  it('parte con ritenuta al 26% e accredito mensile', () => {
    expect(values).toEqual({ rateText: '', rateKind: 'lordo', taxText: '26', intervalMonths: 1, startDate: '2027-01-01', termText: '' });
  });

  it('legge i numeri scritti in italiano', () => {
    const { terms: parsed } = parseInterestForm({ ...values, rateText: '4,25', taxText: '26', termText: ' 6 ', intervalMonths: 3 });
    expect(parsed).toEqual({
      ratePercentMicros: 4_250_000,
      rateKind: 'lordo',
      taxPercentMicros: 26_000_000,
      intervalMonths: 3,
      startDate: '2027-01-01',
      termMonths: 6,
    });
  });

  it('accetta il simbolo di percentuale e la durata vuota', () => {
    const { terms: parsed } = parseInterestForm({ ...values, rateText: '4%' });
    expect(parsed).toMatchObject({ ratePercentMicros: 4_000_000, termMonths: null });
  });

  it('se il tasso è netto la ritenuta non blocca', () => {
    expect(parseInterestForm({ ...values, rateText: '3', rateKind: 'netto', taxText: 'boh' }).error).toBeUndefined();
  });

  it.each([
    [{ rateText: '' }, /tasso/],
    [{ rateText: 'boh' }, /tasso/],
    [{ rateText: '0' }, /tasso/],
    [{ rateText: '101' }, /tasso/],
    [{ rateText: '4', taxText: 'boh' }, /ritenuta/],
    [{ rateText: '4', taxText: '100' }, /ritenuta/],
    [{ rateText: '4', termText: '6,5' }, /durata/],
    [{ rateText: '4', termText: '0' }, /durata/],
    [{ rateText: '4', termText: '601' }, /durata/],
    [{ rateText: '4', startDate: 'ieri' }, /inizio/],
  ])('rifiuta %j', (fields, message) => {
    expect(parseInterestForm({ ...values, ...fields }).error).toMatch(message);
  });

  it('rilegge le condizioni salvate', () => {
    const saved = terms({ ratePercentMicros: 4_250_000, termMonths: 6, intervalMonths: 3 });
    expect(parseInterestForm(interestFormValues(saved, '2000-01-01')).terms).toEqual(saved);
  });

  it('rifiuta condizioni rovinate', () => {
    expect(interestTermsProblem(terms({ intervalMonths: 0 }))).toMatch(/mesi/);
    expect(interestTermsProblem(terms({ intervalMonths: 13 }))).toMatch(/mesi/);
    expect(interestTermsProblem(terms({ rateKind: 'boh' as InterestTerms['rateKind'] }))).toMatch(/lordo/);
    expect(interestTermsProblem(terms({ creditedThrough: 'ieri' }))).toMatch(/accredito/);
    expect(interestTermsProblem(terms())).toBeNull();
  });
});

describe('etichetta', () => {
  it('riassume le condizioni', () => {
    expect(interestTermsLabel(terms())).toBe('4% lordo · ogni mese · fino al 1 gen 2028');
    expect(interestTermsLabel(terms({ rateKind: 'netto', intervalMonths: 3, termMonths: null, ratePercentMicros: 2_250_000 }))).toBe('2,25% netto · ogni 3 mesi');
  });
});

describe('riepilogo', () => {
  it('divide il saldo tra versato e interessi ricevuti', () => {
    const received: Transaction = {
      id: 'i',
      date: '2027-02-01',
      type: 'entrata',
      amountCents: 1_257,
      accountId: 'conto',
      categoryId: CATEGORY_IDS.interessi,
      createdAt: '2027-02-01T10:00:00.000Z',
    };
    const other: Transaction = { ...received, id: 'j', categoryId: 'cat-borse', amountCents: 5_000 };
    const [overview] = interestOverviews([account(500_000)], [received, other], new Map([['conto', 506_257]]), '2027-02-15');
    expect(overview).toMatchObject({ balanceCents: 506_257, receivedCents: 1_257, capitalCents: 505_000 });
  });

  it('lascia fuori conti archiviati e di altro tipo', () => {
    const list = [account(1, {}, { archived: true }), account(1, {}, { type: 'deposito' })];
    expect(interestOverviews(list, [], new Map(), '2027-02-15')).toEqual([]);
  });
});
