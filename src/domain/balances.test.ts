import { describe, expect, it } from 'vitest';
import { computeBalances, liquidityCents, liquiditySeries, axisTicks, thinOut } from './balances';
import type { Account, Transaction } from './types';

function account(id: string, initialBalanceCents = 0, initialBalanceDate = '2026-01-01'): Account {
  return {
    id,
    name: id,
    type: 'corrente',
    currency: 'EUR',
    initialBalanceCents,
    initialBalanceDate,
    archived: false,
    contaComeLiquidita: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

let counter = 0;
function movement(fields: Partial<Transaction> & Pick<Transaction, 'type' | 'amountCents'>): Transaction {
  counter += 1;
  return {
    id: `t${counter}`,
    date: '2026-02-01',
    accountId: 'a',
    createdAt: '2026-02-01T00:00:00.000Z',
    ...fields,
  };
}

const today = '2026-10-30';

describe('computeBalances', () => {
  it('parte dal saldo iniziale', () => {
    const balances = computeBalances([account('a', 100000)], [], today);
    expect(balances.get('a')).toBe(100000);
  });

  it('somma entrate e sottrae uscite', () => {
    const balances = computeBalances(
      [account('a', 100000)],
      [
        movement({ type: 'entrata', amountCents: 50000 }),
        movement({ type: 'uscita', amountCents: 1250 }),
      ],
      today,
    );
    expect(balances.get('a')).toBe(148750);
  });

  it('un trasferimento toglie da un conto e aggiunge all’altro, senza cambiare il totale', () => {
    const balances = computeBalances(
      [account('a', 100000), account('b', 20000)],
      [movement({ type: 'trasferimento', amountCents: 50000, toAccountId: 'b' })],
      today,
    );
    expect(balances.get('a')).toBe(50000);
    expect(balances.get('b')).toBe(70000);
    expect((balances.get('a') ?? 0) + (balances.get('b') ?? 0)).toBe(120000);
  });

  it('le rettifiche applicano il loro segno', () => {
    const balances = computeBalances(
      [account('a', 100000)],
      [
        movement({ type: 'rettifica', amountCents: -2500 }),
        movement({ type: 'rettifica', amountCents: 1000 }),
      ],
      today,
    );
    expect(balances.get('a')).toBe(98500);
  });

  it('i movimenti precedenti alla data del saldo iniziale non contano', () => {
    const balances = computeBalances(
      [account('a', 100000, '2026-06-01')],
      [
        movement({ type: 'uscita', amountCents: 5000, date: '2026-05-31' }),
        movement({ type: 'uscita', amountCents: 700, date: '2026-06-01' }),
        movement({ type: 'uscita', amountCents: 300, date: '2026-06-02' }),
      ],
      today,
    );
    expect(balances.get('a')).toBe(99000);
  });

  it('per un trasferimento vale la data di partenza di ciascun conto', () => {
    const balances = computeBalances(
      [account('a', 100000, '2026-01-01'), account('b', 5000, '2026-06-01')],
      [movement({ type: 'trasferimento', amountCents: 10000, toAccountId: 'b', date: '2026-03-01' })],
      today,
    );
    expect(balances.get('a')).toBe(90000);
    expect(balances.get('b')).toBe(5000);
  });

  it('i movimenti futuri non contano ancora', () => {
    const balances = computeBalances(
      [account('a', 100000)],
      [
        movement({ type: 'uscita', amountCents: 100, date: today }),
        movement({ type: 'uscita', amountCents: 5000, date: '2026-10-31' }),
      ],
      today,
    );
    expect(balances.get('a')).toBe(99900);
  });

  it('calcola il saldo a una data passata', () => {
    const transactions = [
      movement({ type: 'uscita', amountCents: 100, date: '2026-03-01' }),
      movement({ type: 'uscita', amountCents: 200, date: '2026-04-01' }),
    ];
    expect(computeBalances([account('a', 1000)], transactions, '2026-03-15').get('a')).toBe(900);
    expect(computeBalances([account('a', 1000)], transactions, '2026-04-01').get('a')).toBe(700);
  });

  it('ignora i movimenti di conti sconosciuti e ammette saldi negativi', () => {
    const balances = computeBalances(
      [account('a', 100)],
      [
        movement({ type: 'uscita', amountCents: 500 }),
        movement({ type: 'uscita', amountCents: 500, accountId: 'altro' }),
      ],
      today,
    );
    expect(balances.get('a')).toBe(-400);
    expect(balances.has('altro')).toBe(false);
  });
});

describe('liquidityCents', () => {
  it('somma solo i conti in uso che contano come liquidità', () => {
    const accounts = [
      account('corrente', 100000),
      account('contanti', 5000),
      { ...account('deposito', 300000), contaComeLiquidita: false },
      { ...account('broker', 900000), type: 'investimento' as const, contaComeLiquidita: false },
      { ...account('chiuso', 7000), archived: true },
    ];
    const balances = computeBalances(accounts, [], today);
    expect(liquidityCents(accounts, balances)).toBe(105000);
  });

  it('un trasferimento verso un conto fuori dalla liquidità la riduce', () => {
    const accounts = [account('a', 100000), { ...account('b', 0), contaComeLiquidita: false }];
    const transactions = [movement({ type: 'trasferimento', amountCents: 40000, toAccountId: 'b' })];
    expect(liquidityCents(accounts, computeBalances(accounts, transactions, today))).toBe(60000);
  });

  it('senza conti vale zero e ammette totali negativi', () => {
    expect(liquidityCents([], new Map())).toBe(0);
    const accounts = [account('a', -500)];
    expect(liquidityCents(accounts, computeBalances(accounts, [], today))).toBe(-500);
  });
});

describe('liquiditySeries', () => {
  const series = (accounts: Account[], transactions: Transaction[], from = '2026-01-01', to = '2026-01-05') =>
    liquiditySeries(accounts, transactions, from, to).map((point) => [point.date, point.cents]);

  it('segue i movimenti giorno per giorno, compreso il primo giorno', () => {
    const accounts = [account('a', 1000, '2026-01-02')];
    const transactions = [
      movement({ type: 'uscita', amountCents: 100, date: '2026-01-02' }),
      movement({ type: 'entrata', amountCents: 500, date: '2026-01-04' }),
    ];
    expect(series(accounts, transactions)).toEqual([
      ['2026-01-02', 900],
      ['2026-01-03', 900],
      ['2026-01-04', 1400],
      ['2026-01-05', 1400],
    ]);
  });

  it('parte dal periodo scelto tenendo conto di ciò che è successo prima', () => {
    const accounts = [account('a', 1000, '2026-01-01')];
    const transactions = [movement({ type: 'uscita', amountCents: 100, date: '2026-01-02' })];
    expect(series(accounts, transactions, '2026-01-04', '2026-01-05')).toEqual([
      ['2026-01-04', 900],
      ['2026-01-05', 900],
    ]);
  });

  it('considera solo i conti in uso che contano come liquidità', () => {
    const accounts = [
      account('a', 1000, '2026-01-05'),
      { ...account('deposito', 9000, '2026-01-05'), contaComeLiquidita: false },
      { ...account('chiuso', 7000, '2026-01-05'), archived: true },
    ];
    expect(series(accounts, [])).toEqual([['2026-01-05', 1000]]);
  });

  it('un trasferimento verso un conto fuori dalla liquidità la abbassa, tra due conti liquidi no', () => {
    const accounts = [account('a', 1000, '2026-01-05'), account('b', 0, '2026-01-05'), { ...account('deposito', 0, '2026-01-05'), contaComeLiquidita: false }];
    const transactions = [
      movement({ type: 'trasferimento', amountCents: 100, toAccountId: 'b', date: '2026-01-05' }),
      movement({ type: 'trasferimento', amountCents: 300, toAccountId: 'deposito', date: '2026-01-05' }),
    ];
    expect(series(accounts, transactions)).toEqual([['2026-01-05', 700]]);
  });

  it('un conto entra nella serie alla data del suo saldo iniziale', () => {
    const accounts = [account('a', 1000, '2026-01-02'), account('b', 500, '2026-01-04')];
    expect(series(accounts, [])).toEqual([
      ['2026-01-02', 1000],
      ['2026-01-03', 1000],
      ['2026-01-04', 1500],
      ['2026-01-05', 1500],
    ]);
  });

  it('ignora i movimenti precedenti al saldo iniziale e quelli dopo la fine', () => {
    const accounts = [account('a', 1000, '2026-01-03')];
    const transactions = [
      movement({ type: 'uscita', amountCents: 400, date: '2026-01-01' }),
      movement({ type: 'uscita', amountCents: 400, date: '2026-01-09' }),
    ];
    expect(series(accounts, transactions).at(-1)).toEqual(['2026-01-05', 1000]);
  });

  it('l’ultimo punto coincide con la liquidità calcolata dai saldi', () => {
    const accounts = [account('a', 100000, '2026-01-01'), account('b', 5000, '2026-02-01')];
    const transactions = [
      movement({ type: 'entrata', amountCents: 150000, date: '2026-01-20' }),
      movement({ type: 'uscita', amountCents: 1234, date: '2026-02-10', accountId: 'b' }),
      movement({ type: 'trasferimento', amountCents: 5000, toAccountId: 'b', date: '2026-02-15' }),
      movement({ type: 'rettifica', amountCents: -77, date: '2026-03-01' }),
    ];
    const points = liquiditySeries(accounts, transactions, '2026-01-01', '2026-03-31');
    const last = points.at(-1);
    expect(last?.cents).toBe(liquidityCents(accounts, computeBalances(accounts, transactions, '2026-03-31')));
  });

  it('è vuota senza conti liquidi o se il periodo finisce prima del primo saldo', () => {
    expect(series([], [])).toEqual([]);
    expect(series([account('a', 1000, '2026-06-01')], [])).toEqual([]);
  });

  it('per periodi molto lunghi tiene un numero limitato di punti, con il primo e l’ultimo', () => {
    const points = liquiditySeries([account('a', 1000, '2020-01-01')], [], '2020-01-01', '2026-12-31');
    expect(points.length).toBeLessThanOrEqual(400);
    expect(points[0]?.date).toBe('2020-01-01');
    expect(points.at(-1)?.date).toBe('2026-12-31');
  });
});

describe('thinOut', () => {
  it('non tocca le serie corte', () => {
    expect(thinOut([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('tiene il primo, l’ultimo e punti regolari', () => {
    const numbers = Array.from({ length: 101 }, (_, index) => index);
    expect(thinOut(numbers, 5)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe('axisTicks', () => {
  it('usa passi tondi che comprendono tutti i valori', () => {
    expect(axisTicks(115000, 415000)).toEqual([100000, 200000, 300000, 400000, 500000]);
    expect(axisTicks(275853, 415000)).toEqual([250000, 300000, 350000, 400000, 450000]);
  });

  it('non scende sotto l’euro quando il saldo cambia poco', () => {
    const ticks = axisTicks(330754, 330760);
    expect(ticks).toEqual([330700, 330800]);
  });

  it('ha sempre almeno due tacche, anche se il saldo non cambia', () => {
    expect(axisTicks(330000, 330000)).toEqual([330000, 330100]);
    expect(axisTicks(0, 0)).toEqual([0, 100]);
  });

  it('funziona con i saldi negativi', () => {
    expect(axisTicks(-120000, 80000)).toEqual([-200000, -100000, 0, 100000]);
  });
});
