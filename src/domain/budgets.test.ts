import { describe, expect, it } from 'vitest';
import { budgetProgress, defaultBudgets } from './budgets';
import { DEFAULT_CATEGORIES } from './categories';
import type { Account, Budget, Transaction } from './types';

const from = '2026-10-01';
const to = '2026-10-31';

function account(id: string, type: Account['type'] = 'corrente'): Account {
  return {
    id,
    name: id,
    type,
    currency: 'EUR',
    initialBalanceCents: 0,
    initialBalanceDate: '2026-01-01',
    archived: false,
    contaComeLiquidita: type !== 'investimento',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const accounts = [account('a'), account('b'), account('broker', 'investimento')];

let counter = 0;
function tx(fields: Partial<Transaction> & Pick<Transaction, 'type' | 'amountCents'>): Transaction {
  counter += 1;
  return { id: `t${counter}`, date: '2026-10-15', accountId: 'a', createdAt: '2026-10-15T10:00:00.000Z', ...fields };
}

const tetto: Budget = { id: 'b1', name: 'Svago', kind: 'tetto', amountCents: 30000, categoryIds: ['cat-ristoranti', 'cat-regali-fatti'], order: 1 };
const obiettivo: Budget = { id: 'b2', name: 'PAC', kind: 'obiettivo', amountCents: 10000, categoryIds: [], order: 2 };

function progress(budget: Budget, transactions: Transaction[]) {
  const [result] = budgetProgress([budget], { accounts, categories: [...DEFAULT_CATEGORIES], transactions }, from, to);
  if (!result) throw new Error('Busta mancante');
  return result;
}

const spesa = (amountCents: number, categoryId = 'cat-ristoranti', fields: Partial<Transaction> = {}) =>
  tx({ type: 'uscita', amountCents, categoryId, ...fields });

describe('tetto di spesa', () => {
  it('somma le spese di tutte le sue categorie', () => {
    const result = progress(tetto, [spesa(5000), spesa(7000, 'cat-regali-fatti')]);
    expect(result.usedCents).toBe(12000);
    expect(result.remainingCents).toBe(18000);
    expect(result.fill).toBeCloseTo(0.4);
    expect(result.status).toBe('regolare');
  });

  it('ignora le altre categorie e gli altri mesi', () => {
    const result = progress(tetto, [
      spesa(5000, 'cat-spesa'),
      spesa(5000, 'cat-ristoranti', { date: '2026-09-30' }),
      spesa(5000, 'cat-ristoranti', { date: '2026-11-01' }),
    ]);
    expect(result.usedCents).toBe(0);
  });

  it('conta le spese di qualunque conto', () => {
    expect(progress(tetto, [spesa(5000), spesa(5000, 'cat-ristoranti', { accountId: 'b' })]).usedCents).toBe(10000);
  });

  it('usa gli importi al netto dei rimborsi, anche se il rimborso arriva dopo', () => {
    const cena = spesa(8000);
    const result = progress(tetto, [cena, tx({ type: 'entrata', amountCents: 4000, reimbursesId: cena.id, date: '2026-11-05' })]);
    expect(result.usedCents).toBe(4000);
  });

  it('non conta trasferimenti, entrate e rettifiche', () => {
    const result = progress(tetto, [
      tx({ type: 'trasferimento', amountCents: 5000, toAccountId: 'b' }),
      tx({ type: 'entrata', amountCents: 5000, categoryId: 'cat-ristoranti' }),
      tx({ type: 'rettifica', amountCents: -5000, categoryId: 'cat-ristoranti' }),
    ]);
    expect(result.usedCents).toBe(0);
  });

  it('è vicino dall’85% in su, superato solo oltre il limite', () => {
    expect(progress(tetto, [spesa(25499)]).status).toBe('regolare');
    expect(progress(tetto, [spesa(25500)]).status).toBe('vicino');
    expect(progress(tetto, [spesa(30000)]).status).toBe('vicino');
    expect(progress(tetto, [spesa(30000)]).remainingCents).toBe(0);
    expect(progress(tetto, [spesa(30001)]).status).toBe('superato');
  });

  it('oltre il limite la barra si ferma al massimo e il resto è negativo', () => {
    const result = progress(tetto, [spesa(45000)]);
    expect(result.fill).toBe(1);
    expect(result.remainingCents).toBe(-15000);
  });

  it('senza categorie resta a zero', () => {
    const result = progress({ ...tetto, categoryIds: [] }, [spesa(5000)]);
    expect(result.usedCents).toBe(0);
    expect(result.status).toBe('regolare');
  });
});

describe('obiettivo di risparmio', () => {
  const versamento = (amountCents: number, fields: Partial<Transaction> = {}) =>
    tx({ type: 'trasferimento', amountCents, toAccountId: 'broker', ...fields });

  it('sotto l’obiettivo è in corso, non "verde"', () => {
    const result = progress(obiettivo, [versamento(4000)]);
    expect(result.usedCents).toBe(4000);
    expect(result.remainingCents).toBe(6000);
    expect(result.status).toBe('in-corso');
  });

  it('diventa raggiunto quando arriva all’obiettivo, e resta tale oltre', () => {
    expect(progress(obiettivo, [versamento(10000)]).status).toBe('raggiunto');
    const oltre = progress(obiettivo, [versamento(25000)]);
    expect(oltre.status).toBe('raggiunto');
    expect(oltre.fill).toBe(1);
  });

  it('senza versamenti è in corso, mai superato', () => {
    const result = progress(obiettivo, []);
    expect(result.status).toBe('in-corso');
    expect(result.fill).toBe(0);
  });

  it('non conta i trasferimenti verso conti normali né le spese', () => {
    const result = progress(obiettivo, [tx({ type: 'trasferimento', amountCents: 50000, toAccountId: 'b' }), spesa(5000)]);
    expect(result.usedCents).toBe(0);
  });

  it('un prelievo dal conto investimento riduce il versato', () => {
    const result = progress(obiettivo, [versamento(10000), tx({ type: 'trasferimento', amountCents: 3000, accountId: 'broker', toAccountId: 'a' })]);
    expect(result.usedCents).toBe(7000);
    expect(result.status).toBe('in-corso');
  });

  it('con più prelievi che versamenti la barra resta a zero', () => {
    const result = progress(obiettivo, [tx({ type: 'trasferimento', amountCents: 3000, accountId: 'broker', toAccountId: 'a' })]);
    expect(result.usedCents).toBe(-3000);
    expect(result.fill).toBe(0);
  });

  it('non conta i mesi fuori dal periodo', () => {
    expect(progress(obiettivo, [versamento(10000, { date: '2026-09-30' })]).status).toBe('in-corso');
  });
});

describe('defaultBudgets', () => {
  const all = new Set(DEFAULT_CATEGORIES.map((category) => category.id));

  it('ha le quattro buste iniziali, con il PAC come obiettivo', () => {
    const budgets = defaultBudgets(all);
    expect(budgets.map((budget) => [budget.name, budget.amountCents, budget.kind])).toEqual([
      ['Svago + spese', 30000, 'tetto'],
      ['Viaggi', 20000, 'tetto'],
      ['Spese previste', 20000, 'tetto'],
      ['PAC ETF', 10000, 'obiettivo'],
    ]);
  });

  it('usa solo categorie che esistono tra quelle iniziali', () => {
    for (const budget of defaultBudgets(all)) {
      expect(budget.categoryIds.every((id) => all.has(id))).toBe(true);
    }
    expect(defaultBudgets(all)[0]?.categoryIds.length).toBeGreaterThan(0);
  });

  it('toglie le categorie che non esistono più', () => {
    const without = new Set([...all].filter((id) => id !== 'cat-viaggi'));
    expect(defaultBudgets(without)[1]?.categoryIds).toEqual([]);
  });
});
