import { describe, expect, it } from 'vitest';
import { computeBalances } from './balances';
import { CATEGORY_IDS, DEFAULT_CATEGORIES } from './categories';
import {
  autonomyMonths,
  averageMonthlyExpense,
  baselineMonths,
  expensesByCategory,
  monthlyBreakdown,
  summarizePeriod,
  type ReportData,
} from './reports';
import type { Account, Transaction } from './types';

const from = '2026-10-01';
const to = '2026-10-31';

let counter = 0;
function tx(fields: Partial<Transaction> & Pick<Transaction, 'type' | 'amountCents'>): Transaction {
  counter += 1;
  return {
    id: `t${counter}`,
    date: '2026-10-15',
    accountId: 'a',
    createdAt: `2026-10-15T10:00:${String(counter % 60).padStart(2, '0')}.000Z`,
    ...fields,
  };
}

function account(id: string, fields: Partial<Account> = {}): Account {
  return {
    id,
    name: id,
    type: 'corrente',
    currency: 'EUR',
    initialBalanceCents: 100000,
    initialBalanceDate: '2026-01-01',
    archived: false,
    contaComeLiquidita: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...fields,
  };
}

const broker = account('broker', { type: 'investimento', contaComeLiquidita: false });

function data(transactions: Transaction[], accounts: Account[] = [account('a'), broker]): ReportData {
  return { accounts, categories: [...DEFAULT_CATEGORIES], transactions };
}

const summary = (transactions: Transaction[], accounts?: Account[]) => summarizePeriod(data(transactions, accounts), from, to);

describe('summarizePeriod: entrate e uscite', () => {
  it('somma entrate e uscite del periodo, estremi compresi', () => {
    const result = summary([
      tx({ type: 'entrata', amountCents: 100000, date: '2026-10-01' }),
      tx({ type: 'uscita', amountCents: 30000, date: '2026-10-31' }),
      tx({ type: 'uscita', amountCents: 999, date: '2026-09-30' }),
      tx({ type: 'entrata', amountCents: 999, date: '2026-11-01' }),
    ]);
    expect(result.incomeCents).toBe(100000);
    expect(result.expenseCents).toBe(30000);
    expect(result.savingsCents).toBe(70000);
    expect(result.savingsRate).toBeCloseTo(0.7);
  });

  it('senza entrate il tasso non è definito, ma il risparmio sì', () => {
    const result = summary([tx({ type: 'uscita', amountCents: 100 })]);
    expect(result.savingsRate).toBeNull();
    expect(result.salarySavingsRate).toBeNull();
    expect(result.savingsCents).toBe(-100);
  });

  it('il tasso può essere negativo', () => {
    const result = summary([tx({ type: 'entrata', amountCents: 1000 }), tx({ type: 'uscita', amountCents: 1500 })]);
    expect(result.savingsRate).toBeCloseTo(-0.5);
  });
});

describe('summarizePeriod: trasferimenti e investimenti', () => {
  it('un trasferimento non è né entrata né spesa', () => {
    const result = summary([
      tx({ type: 'entrata', amountCents: 100000 }),
      tx({ type: 'trasferimento', amountCents: 50000, toAccountId: 'deposito' }),
    ]);
    expect(result.expenseCents).toBe(0);
    expect(result.incomeCents).toBe(100000);
    expect(result.savingsCents).toBe(100000);
    expect(result.investedCents).toBe(0);
  });

  it('un trasferimento verso un conto investimento è investito, non spesa', () => {
    const result = summary([
      tx({ type: 'entrata', amountCents: 100000 }),
      tx({ type: 'trasferimento', amountCents: 25000, toAccountId: 'broker' }),
    ]);
    expect(result.investedCents).toBe(25000);
    expect(result.expenseCents).toBe(0);
    expect(result.savingsCents).toBe(100000);
  });

  it('un prelievo dal conto investimento riduce l’investito', () => {
    const result = summary([
      tx({ type: 'trasferimento', amountCents: 25000, toAccountId: 'broker' }),
      tx({ type: 'trasferimento', amountCents: 10000, accountId: 'broker', toAccountId: 'a' }),
    ]);
    expect(result.investedCents).toBe(15000);
  });

  it('un trasferimento tra due conti investimento non cambia l’investito', () => {
    const accounts = [account('a'), broker, account('broker2', { type: 'investimento' })];
    const result = summary([tx({ type: 'trasferimento', amountCents: 5000, accountId: 'broker', toAccountId: 'broker2' })], accounts);
    expect(result.investedCents).toBe(0);
  });
});

describe('summarizePeriod: rimborsi', () => {
  it('un rimborso collegato riduce la spesa e non conta tra le entrate', () => {
    const cena = tx({ type: 'uscita', amountCents: 8000 });
    const result = summary([
      tx({ type: 'entrata', amountCents: 100000, categoryId: CATEGORY_IDS.stipendio }),
      cena,
      tx({ type: 'entrata', amountCents: 4000, reimbursesId: cena.id, categoryId: CATEGORY_IDS.rimborsi }),
    ]);
    expect(result.expenseCents).toBe(4000);
    expect(result.incomeCents).toBe(100000);
    expect(result.savingsCents).toBe(96000);
    expect(result.sources.refundsCents).toBe(0);
    expect(result.nettedRefundsCents).toBe(4000);
  });

  it('più rimborsi sulla stessa spesa si sommano', () => {
    const cena = tx({ type: 'uscita', amountCents: 9000 });
    const result = summary([
      cena,
      tx({ type: 'entrata', amountCents: 3000, reimbursesId: cena.id }),
      tx({ type: 'entrata', amountCents: 3000, reimbursesId: cena.id }),
    ]);
    expect(result.expenseCents).toBe(3000);
    expect(result.incomeCents).toBe(0);
  });

  it('un rimborso del mese dopo riduce la spesa nel mese della spesa', () => {
    const cena = tx({ type: 'uscita', amountCents: 8000, date: '2026-09-20' });
    const rimborso = tx({ type: 'entrata', amountCents: 4000, reimbursesId: cena.id, date: '2026-10-05' });
    const settembre = summarizePeriod(data([cena, rimborso]), '2026-09-01', '2026-09-30');
    const ottobre = summarizePeriod(data([cena, rimborso]), from, to);
    expect(settembre.expenseCents).toBe(4000);
    expect(ottobre.expenseCents).toBe(0);
    expect(ottobre.incomeCents).toBe(0);
    expect(ottobre.nettedRefundsCents).toBe(4000);
  });

  it('se i rimborsi superano la spesa l’eccedenza è un’entrata', () => {
    const cena = tx({ type: 'uscita', amountCents: 4000 });
    const result = summary([cena, tx({ type: 'entrata', amountCents: 5000, reimbursesId: cena.id, categoryId: CATEGORY_IDS.rimborsi })]);
    expect(result.expenseCents).toBe(0);
    expect(result.incomeCents).toBe(1000);
    expect(result.sources.refundsCents).toBe(1000);
  });

  it('un rimborso non collegato è un’entrata normale', () => {
    const result = summary([
      tx({ type: 'uscita', amountCents: 8000 }),
      tx({ type: 'entrata', amountCents: 4000, categoryId: CATEGORY_IDS.rimborsi }),
    ]);
    expect(result.expenseCents).toBe(8000);
    expect(result.sources.refundsCents).toBe(4000);
    expect(result.nettedRefundsCents).toBe(0);
  });

  it('un collegamento a una spesa inesistente non fa perdere l’entrata', () => {
    expect(summary([tx({ type: 'entrata', amountCents: 4000, reimbursesId: 'sparita' })]).incomeCents).toBe(4000);
  });
});

describe('summarizePeriod: rettifiche', () => {
  it('sono una voce separata ma entrano nel risparmio', () => {
    const result = summary([
      tx({ type: 'entrata', amountCents: 100000 }),
      tx({ type: 'rettifica', amountCents: -2500 }),
      tx({ type: 'rettifica', amountCents: 500 }),
    ]);
    expect(result.adjustmentCents).toBe(-2000);
    expect(result.expenseCents).toBe(0);
    expect(result.savingsCents).toBe(98000);
    expect(result.savingsRate).toBeCloseTo(0.98);
  });

  it('quelle dei conti investimento sono mercato e non entrano nel risparmio', () => {
    const result = summary([
      tx({ type: 'entrata', amountCents: 100000 }),
      tx({ type: 'rettifica', amountCents: 7000, accountId: 'broker' }),
      tx({ type: 'rettifica', amountCents: -2000, accountId: 'broker' }),
    ]);
    expect(result.marketCents).toBe(5000);
    expect(result.adjustmentCents).toBe(0);
    expect(result.savingsCents).toBe(100000);
  });
});

describe('summarizePeriod: entrate per fonte e due tassi', () => {
  const movimenti = () => [
    tx({ type: 'entrata', amountCents: 100000, categoryId: CATEGORY_IDS.stipendio }),
    tx({ type: 'entrata', amountCents: 50000, categoryId: CATEGORY_IDS.regaliRicevuti }),
    tx({ type: 'entrata', amountCents: 2000, categoryId: CATEGORY_IDS.rimborsi }),
    tx({ type: 'entrata', amountCents: 3000, categoryId: 'cat-borse' }),
    tx({ type: 'entrata', amountCents: 1000, categoryId: 'cat-straordinarie' }),
    tx({ type: 'uscita', amountCents: 120000, categoryId: 'cat-spesa' }),
  ];

  it('divide le entrate tra stipendio, regali, rimborsi e altro', () => {
    expect(summary(movimenti()).sources).toEqual({
      salaryCents: 100000,
      giftsCents: 50000,
      refundsCents: 2000,
      otherCents: 4000,
    });
    expect(summary(movimenti()).incomeCents).toBe(156000);
  });

  it('il tasso sul solo stipendio mostra se si risparmia solo grazie ai regali', () => {
    const result = summary(movimenti());
    expect(result.salarySavingsRate).toBeCloseTo(-0.2);
    expect(result.savingsRate).toBeCloseTo(36000 / 156000);
  });

  it('senza stipendio il primo tasso non è definito', () => {
    const result = summary([tx({ type: 'entrata', amountCents: 50000, categoryId: CATEGORY_IDS.regaliRicevuti })]);
    expect(result.salarySavingsRate).toBeNull();
    expect(result.savingsRate).toBeCloseTo(1);
  });

  it('entrambi i tassi considerano le rettifiche', () => {
    const result = summary([
      tx({ type: 'entrata', amountCents: 100000, categoryId: CATEGORY_IDS.stipendio }),
      tx({ type: 'rettifica', amountCents: -10000 }),
    ]);
    expect(result.salarySavingsRate).toBeCloseTo(0.9);
    expect(result.savingsRate).toBeCloseTo(0.9);
  });
});

describe('summarizePeriod: spese fisse e variabili', () => {
  it('è fissa una spesa in categoria fissa o legata a una ricorrenza', () => {
    const result = summary([
      tx({ type: 'uscita', amountCents: 50000, categoryId: 'cat-casa' }),
      tx({ type: 'uscita', amountCents: 3000, categoryId: 'cat-sport-salute', recurringId: 'r' }),
      tx({ type: 'uscita', amountCents: 2000, categoryId: 'cat-spesa' }),
    ]);
    expect(result.fixedCents).toBe(53000);
    expect(result.variableCents).toBe(2000);
    expect(result.expenseCents).toBe(55000);
  });

  it('usa gli importi al netto dei rimborsi', () => {
    const affitto = tx({ type: 'uscita', amountCents: 50000, categoryId: 'cat-casa' });
    const result = summary([affitto, tx({ type: 'entrata', amountCents: 10000, reimbursesId: affitto.id })]);
    expect(result.fixedCents).toBe(40000);
  });
});

describe('il risparmio torna con i saldi', () => {
  it('coincide con la variazione di tutti i conti, tolto il mercato', () => {
    const accounts = [account('a'), account('b'), broker];
    const cena = tx({ type: 'uscita', amountCents: 8000 });
    const transactions = [
      tx({ type: 'entrata', amountCents: 150000 }),
      cena,
      tx({ type: 'entrata', amountCents: 4000, reimbursesId: cena.id }),
      tx({ type: 'trasferimento', amountCents: 50000, toAccountId: 'b' }),
      tx({ type: 'trasferimento', amountCents: 20000, toAccountId: 'broker' }),
      tx({ type: 'rettifica', amountCents: -1250 }),
      tx({ type: 'rettifica', amountCents: 900, accountId: 'broker' }),
      tx({ type: 'uscita', amountCents: 333, accountId: 'b' }),
    ];
    const total = [...computeBalances(accounts, transactions, to).values()].reduce((sum, value) => sum + value, 0);
    const result = summarizePeriod(data(transactions, accounts), from, to);
    expect(total - 300000).toBe(result.savingsCents + result.marketCents);
  });
});

describe('baselineMonths', () => {
  const spesa = (date: string) => tx({ type: 'uscita', amountCents: 100, date });

  it('prende i tre mesi completi prima del periodo', () => {
    expect(baselineMonths([spesa('2025-01-01')], '2026-10-30')).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect(baselineMonths([spesa('2025-01-01')], '2026-01-15')).toEqual(['2025-10-01', '2025-11-01', '2025-12-01']);
  });

  it('esclude i mesi precedenti alla prima spesa', () => {
    expect(baselineMonths([spesa('2026-09-20')], '2026-10-30')).toEqual(['2026-09-01']);
    expect(baselineMonths([spesa('2026-08-31')], '2026-10-30')).toEqual(['2026-08-01', '2026-09-01']);
  });

  it('è vuota se le spese sono solo nel periodo o non ce ne sono', () => {
    expect(baselineMonths([spesa('2026-10-01')], '2026-10-30')).toEqual([]);
    expect(baselineMonths([], '2026-10-30')).toEqual([]);
    expect(baselineMonths([tx({ type: 'entrata', amountCents: 1, date: '2020-01-01' })], '2026-10-30')).toEqual([]);
  });
});

describe('averageMonthlyExpense', () => {
  it('fa la media dei mesi completi, senza il mese in corso', () => {
    const baseline = averageMonthlyExpense(
      [
        tx({ type: 'uscita', amountCents: 10000, date: '2026-07-10' }),
        tx({ type: 'uscita', amountCents: 20000, date: '2026-08-10' }),
        tx({ type: 'uscita', amountCents: 30000, date: '2026-09-10' }),
        tx({ type: 'uscita', amountCents: 99900, date: '2026-10-10' }),
        tx({ type: 'uscita', amountCents: 99900, date: '2026-06-10' }),
      ],
      '2026-10-30',
    );
    expect(baseline?.averageCents).toBe(20000);
    expect(baseline?.months).toHaveLength(3);
  });

  it('un mese senza spese conta come zero', () => {
    const baseline = averageMonthlyExpense(
      [tx({ type: 'uscita', amountCents: 30000, date: '2026-07-10' }), tx({ type: 'uscita', amountCents: 30000, date: '2026-09-10' })],
      '2026-10-30',
    );
    expect(baseline?.averageCents).toBe(20000);
  });

  it('con meno di tre mesi usa quelli che ci sono', () => {
    const baseline = averageMonthlyExpense([tx({ type: 'uscita', amountCents: 30000, date: '2026-09-10' })], '2026-10-30');
    expect(baseline?.averageCents).toBe(30000);
    expect(baseline?.months).toEqual(['2026-09-01']);
  });

  it('usa gli importi al netto dei rimborsi e ignora trasferimenti e rettifiche', () => {
    const cena = tx({ type: 'uscita', amountCents: 30000, date: '2026-09-10' });
    const baseline = averageMonthlyExpense(
      [
        cena,
        tx({ type: 'entrata', amountCents: 10000, reimbursesId: cena.id, date: '2026-10-05' }),
        tx({ type: 'trasferimento', amountCents: 50000, toAccountId: 'broker', date: '2026-09-11' }),
        tx({ type: 'rettifica', amountCents: -5000, date: '2026-09-12' }),
      ],
      '2026-10-30',
    );
    expect(baseline?.averageCents).toBe(20000);
  });

  it('non c’è media senza mesi completi', () => {
    expect(averageMonthlyExpense([tx({ type: 'uscita', amountCents: 100, date: '2026-10-10' })], '2026-10-30')).toBeNull();
  });
});

describe('expensesByCategory', () => {
  const spesa = (categoryId: string, amountCents: number, date: string) => tx({ type: 'uscita', amountCents, categoryId, date });

  it('ordina dalla più alta e confronta con la media dei tre mesi prima', () => {
    const rows = expensesByCategory(
      [
        spesa('cat-spesa', 30000, '2026-10-10'),
        spesa('cat-viaggi', 50000, '2026-10-11'),
        spesa('cat-spesa', 10000, '2026-07-10'),
        spesa('cat-spesa', 20000, '2026-08-10'),
        spesa('cat-spesa', 30000, '2026-09-10'),
      ],
      from,
      to,
    );
    expect(rows.map((row) => row.categoryId)).toEqual(['cat-viaggi', 'cat-spesa']);
    expect(rows[1]).toEqual({ categoryId: 'cat-spesa', cents: 30000, averageCents: 20000, expectedCents: 20000 });
    expect(rows[0]).toEqual({ categoryId: 'cat-viaggi', cents: 50000, averageCents: 0, expectedCents: 0 });
  });

  it('mostra anche le categorie senza spese nel periodo ma con una media', () => {
    const rows = expensesByCategory([spesa('cat-viaggi', 30000, '2026-09-10'), spesa('cat-spesa', 100, '2026-10-10')], from, to);
    expect(rows.find((row) => row.categoryId === 'cat-viaggi')).toEqual({
      categoryId: 'cat-viaggi',
      cents: 0,
      averageCents: 30000,
      expectedCents: 30000,
    });
  });

  it('senza mesi di confronto non dà una media', () => {
    const rows = expensesByCategory([spesa('cat-spesa', 100, '2026-10-10')], from, to);
    expect(rows).toEqual([{ categoryId: 'cat-spesa', cents: 100, averageCents: null, expectedCents: null }]);
  });

  it('per un trimestre riporta la media alla durata del periodo', () => {
    const rows = expensesByCategory(
      [spesa('cat-spesa', 90000, '2026-11-10'), spesa('cat-spesa', 30000, '2026-09-10')],
      '2026-10-01',
      '2026-12-31',
    );
    expect(rows[0]?.averageCents).toBe(30000);
    expect(rows[0]?.expectedCents).toBe(90000);
  });

  it('usa gli importi al netto dei rimborsi e nasconde le spese rimborsate del tutto', () => {
    const cena = spesa('cat-ristoranti', 8000, '2026-10-10');
    const rows = expensesByCategory(
      [cena, tx({ type: 'entrata', amountCents: 8000, reimbursesId: cena.id }), spesa('cat-spesa', 100, '2026-10-11')],
      from,
      to,
    );
    expect(rows.map((row) => row.categoryId)).toEqual(['cat-spesa']);
  });

  it('non conta trasferimenti e rettifiche', () => {
    const rows = expensesByCategory(
      [
        tx({ type: 'trasferimento', amountCents: 100, toAccountId: 'broker' }),
        tx({ type: 'rettifica', amountCents: -100, categoryId: CATEGORY_IDS.nonTracciato }),
      ],
      from,
      to,
    );
    expect(rows).toEqual([]);
  });
});

describe('monthlyBreakdown', () => {
  it('parte dal primo mese con qualcosa', () => {
    const rows = monthlyBreakdown(data([tx({ type: 'uscita', amountCents: 100, date: '2026-03-05' })]), '2026-01-01', '2026-04-30');
    expect(rows.map((row) => row.month)).toEqual(['2026-03-01', '2026-04-01']);
  });

  it('non restituisce righe se nel periodo non c’è niente', () => {
    expect(monthlyBreakdown(data([]), '2026-01-01', '2026-04-30')).toEqual([]);
  });

  it('riassume ogni mese del periodo, anche quelli vuoti in mezzo', () => {
    const rows = monthlyBreakdown(
      data([
        tx({ type: 'entrata', amountCents: 100000, date: '2026-10-05' }),
        tx({ type: 'uscita', amountCents: 40000, date: '2026-10-06' }),
        tx({ type: 'uscita', amountCents: 5000, date: '2026-12-01' }),
      ]),
      '2026-10-01',
      '2026-12-31',
    );
    expect(rows).toEqual([
      { month: '2026-10-01', incomeCents: 100000, expenseCents: 40000, savingsCents: 60000 },
      { month: '2026-11-01', incomeCents: 0, expenseCents: 0, savingsCents: 0 },
      { month: '2026-12-01', incomeCents: 0, expenseCents: 5000, savingsCents: -5000 },
    ]);
  });

  it('per un periodo libero considera solo i giorni dentro il periodo', () => {
    const rows = monthlyBreakdown(
      data([tx({ type: 'uscita', amountCents: 100, date: '2026-10-05' }), tx({ type: 'uscita', amountCents: 200, date: '2026-10-20' })]),
      '2026-10-10',
      '2026-10-25',
    );
    expect(rows).toEqual([{ month: '2026-10-01', incomeCents: 0, expenseCents: 200, savingsCents: -200 }]);
  });

  it('la somma dei mesi coincide con il riepilogo del periodo', () => {
    const transactions = [
      tx({ type: 'entrata', amountCents: 100000, date: '2026-01-05' }),
      tx({ type: 'uscita', amountCents: 40000, date: '2026-02-06' }),
      tx({ type: 'rettifica', amountCents: -300, date: '2026-03-06' }),
    ];
    const rows = monthlyBreakdown(data(transactions), '2026-01-01', '2026-03-31');
    const total = summarizePeriod(data(transactions), '2026-01-01', '2026-03-31');
    expect(rows.reduce((sum, row) => sum + row.savingsCents, 0)).toBe(total.savingsCents);
  });
});

describe('autonomyMonths', () => {
  it('divide la liquidità per la media delle spese', () => {
    expect(autonomyMonths(300000, 100000)).toBe(3);
    expect(autonomyMonths(150000, 100000)).toBe(1.5);
  });

  it('non è definita senza una media di spese', () => {
    expect(autonomyMonths(300000, null)).toBeNull();
    expect(autonomyMonths(300000, 0)).toBeNull();
  });

  it('con liquidità negativa vale zero', () => {
    expect(autonomyMonths(-5000, 100000)).toBe(0);
  });
});
