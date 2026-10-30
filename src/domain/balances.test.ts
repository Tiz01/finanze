import { describe, expect, it } from 'vitest';
import { computeBalances, liquidityCents } from './balances';
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
