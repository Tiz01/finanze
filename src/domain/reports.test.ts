import { describe, expect, it } from 'vitest';
import { computeBalances } from './balances';
import { summarizePeriod } from './reports';
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

describe('summarizePeriod', () => {
  it('somma entrate e uscite del periodo, estremi compresi', () => {
    const summary = summarizePeriod(
      [
        tx({ type: 'entrata', amountCents: 100000, date: '2026-10-01' }),
        tx({ type: 'uscita', amountCents: 30000, date: '2026-10-31' }),
        tx({ type: 'uscita', amountCents: 999, date: '2026-09-30' }),
        tx({ type: 'entrata', amountCents: 999, date: '2026-11-01' }),
      ],
      from,
      to,
    );
    expect(summary.incomeCents).toBe(100000);
    expect(summary.expenseCents).toBe(30000);
    expect(summary.savingsCents).toBe(70000);
    expect(summary.savingsRate).toBeCloseTo(0.7);
  });

  it('un trasferimento non è né entrata né spesa, nemmeno verso un conto investimento', () => {
    const summary = summarizePeriod(
      [
        tx({ type: 'entrata', amountCents: 100000 }),
        tx({ type: 'trasferimento', amountCents: 50000, toAccountId: 'deposito' }),
        tx({ type: 'trasferimento', amountCents: 10000, toAccountId: 'broker' }),
      ],
      from,
      to,
    );
    expect(summary.expenseCents).toBe(0);
    expect(summary.incomeCents).toBe(100000);
    expect(summary.savingsCents).toBe(100000);
  });

  it('un rimborso collegato riduce la spesa e non conta tra le entrate', () => {
    const cena = tx({ type: 'uscita', amountCents: 8000 });
    const summary = summarizePeriod(
      [
        tx({ type: 'entrata', amountCents: 100000 }),
        cena,
        tx({ type: 'entrata', amountCents: 4000, reimbursesId: cena.id }),
      ],
      from,
      to,
    );
    expect(summary.expenseCents).toBe(4000);
    expect(summary.incomeCents).toBe(100000);
    expect(summary.savingsCents).toBe(96000);
  });

  it('più rimborsi sulla stessa spesa si sommano', () => {
    const cena = tx({ type: 'uscita', amountCents: 9000 });
    const summary = summarizePeriod(
      [cena, tx({ type: 'entrata', amountCents: 3000, reimbursesId: cena.id }), tx({ type: 'entrata', amountCents: 3000, reimbursesId: cena.id })],
      from,
      to,
    );
    expect(summary.expenseCents).toBe(3000);
    expect(summary.incomeCents).toBe(0);
  });

  it('un rimborso del mese dopo riduce la spesa nel mese della spesa', () => {
    const cena = tx({ type: 'uscita', amountCents: 8000, date: '2026-09-20' });
    const rimborso = tx({ type: 'entrata', amountCents: 4000, reimbursesId: cena.id, date: '2026-10-05' });
    const settembre = summarizePeriod([cena, rimborso], '2026-09-01', '2026-09-30');
    const ottobre = summarizePeriod([cena, rimborso], from, to);
    expect(settembre.expenseCents).toBe(4000);
    expect(ottobre.expenseCents).toBe(0);
    expect(ottobre.incomeCents).toBe(0);
  });

  it('se i rimborsi superano la spesa l’eccedenza è un’entrata', () => {
    const cena = tx({ type: 'uscita', amountCents: 4000 });
    const summary = summarizePeriod([cena, tx({ type: 'entrata', amountCents: 5000, reimbursesId: cena.id })], from, to);
    expect(summary.expenseCents).toBe(0);
    expect(summary.incomeCents).toBe(1000);
  });

  it('un rimborso non collegato è un’entrata normale', () => {
    const summary = summarizePeriod([tx({ type: 'uscita', amountCents: 8000 }), tx({ type: 'entrata', amountCents: 4000 })], from, to);
    expect(summary.expenseCents).toBe(8000);
    expect(summary.incomeCents).toBe(4000);
  });

  it('un collegamento a una spesa inesistente non fa perdere l’entrata', () => {
    const summary = summarizePeriod([tx({ type: 'entrata', amountCents: 4000, reimbursesId: 'sparita' })], from, to);
    expect(summary.incomeCents).toBe(4000);
  });

  it('le rettifiche sono una voce separata ma entrano nel risparmio', () => {
    const summary = summarizePeriod(
      [
        tx({ type: 'entrata', amountCents: 100000 }),
        tx({ type: 'rettifica', amountCents: -2500 }),
        tx({ type: 'rettifica', amountCents: 500 }),
      ],
      from,
      to,
    );
    expect(summary.adjustmentCents).toBe(-2000);
    expect(summary.expenseCents).toBe(0);
    expect(summary.savingsCents).toBe(98000);
    expect(summary.savingsRate).toBeCloseTo(0.98);
  });

  it('senza entrate il tasso di risparmio non è definito', () => {
    const summary = summarizePeriod([tx({ type: 'uscita', amountCents: 100 })], from, to);
    expect(summary.savingsRate).toBeNull();
    expect(summary.savingsCents).toBe(-100);
  });

  it('il tasso può essere negativo', () => {
    const summary = summarizePeriod([tx({ type: 'entrata', amountCents: 1000 }), tx({ type: 'uscita', amountCents: 1500 })], from, to);
    expect(summary.savingsRate).toBeCloseTo(-0.5);
  });

  it('il risparmio coincide con la variazione dei saldi di tutti i conti', () => {
    const account = (id: string): Account => ({
      id,
      name: id,
      type: 'corrente',
      currency: 'EUR',
      initialBalanceCents: 100000,
      initialBalanceDate: '2026-01-01',
      archived: false,
      contaComeLiquidita: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const accounts = [account('a'), account('b')];
    const cena = tx({ type: 'uscita', amountCents: 8000 });
    const transactions = [
      tx({ type: 'entrata', amountCents: 150000 }),
      cena,
      tx({ type: 'entrata', amountCents: 4000, reimbursesId: cena.id }),
      tx({ type: 'trasferimento', amountCents: 50000, toAccountId: 'b' }),
      tx({ type: 'rettifica', amountCents: -1250 }),
      tx({ type: 'uscita', amountCents: 333, accountId: 'b' }),
    ];
    const total = [...computeBalances(accounts, transactions, to).values()].reduce((sum, value) => sum + value, 0);
    expect(total - 200000).toBe(summarizePeriod(transactions, from, to).savingsCents);
  });
});
