import { describe, expect, it } from 'vitest';
import { firstGrapheme } from './categories';
import {
  compareNewestFirst,
  defaultAccountId,
  filterTransactions,
  groupByDay,
  normalizeText,
  parseTags,
  periodRange,
  rankCategories,
  reimbursedTotals,
  validateTransaction,
} from './transactions';
import type { Account, Category, Transaction, TransactionDraft } from './types';

const today = '2026-10-30';

function draft(fields: Partial<TransactionDraft> = {}): TransactionDraft {
  return { date: today, amountCents: 1000, type: 'uscita', accountId: 'a', categoryId: 'c', ...fields };
}

let counter = 0;
function tx(fields: Partial<Transaction> = {}): Transaction {
  counter += 1;
  return { ...draft(), id: `t${counter}`, createdAt: `2026-10-01T00:00:${String(counter % 60).padStart(2, '0')}.000Z`, ...fields };
}

function category(id: string, kind: Category['kind'], order: number, archived = false): Category {
  return { id, name: id, kind, group: 'g', emoji: '🙂', color: '#000000', fissa: false, archived, system: false, order };
}

function account(id: string, fields: Partial<Account> = {}): Account {
  return {
    id,
    name: id,
    type: 'corrente',
    currency: 'EUR',
    initialBalanceCents: 0,
    initialBalanceDate: '2026-01-01',
    archived: false,
    contaComeLiquidita: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...fields,
  };
}

describe('validateTransaction', () => {
  it('accetta movimenti corretti di ogni tipo', () => {
    expect(validateTransaction(draft())).toBeNull();
    expect(validateTransaction(draft({ type: 'entrata' }))).toBeNull();
    expect(validateTransaction(draft({ type: 'entrata', reimbursesId: 'x' }))).toBeNull();
    expect(
      validateTransaction({ date: today, amountCents: 1000, type: 'trasferimento', accountId: 'a', toAccountId: 'b' }),
    ).toBeNull();
    expect(validateTransaction(draft({ type: 'rettifica', amountCents: -500 }))).toBeNull();
  });

  it('rifiuta importi non interi, nulli o negativi', () => {
    expect(validateTransaction(draft({ amountCents: 12.5 }))).not.toBeNull();
    expect(validateTransaction(draft({ amountCents: 0 }))).not.toBeNull();
    expect(validateTransaction(draft({ amountCents: -100 }))).not.toBeNull();
    expect(validateTransaction(draft({ type: 'rettifica', amountCents: 0 }))).not.toBeNull();
  });

  it('rifiuta date non valide', () => {
    expect(validateTransaction(draft({ date: '30/10/2026' }))).not.toBeNull();
    expect(validateTransaction(draft({ date: '2026-02-30' }))).not.toBeNull();
  });

  it('un trasferimento richiede due conti diversi e nessuna categoria', () => {
    const base = { date: today, amountCents: 1000, type: 'trasferimento', accountId: 'a' } as const;
    expect(validateTransaction(base)).not.toBeNull();
    expect(validateTransaction({ ...base, toAccountId: 'a' })).not.toBeNull();
    expect(validateTransaction({ ...base, toAccountId: 'b', categoryId: 'c' })).not.toBeNull();
  });

  it('entrate e uscite richiedono una categoria', () => {
    expect(validateTransaction(draft({ categoryId: undefined }))).not.toBeNull();
  });

  it('solo un’entrata può essere un rimborso', () => {
    expect(validateTransaction(draft({ reimbursesId: 'x' }))).not.toBeNull();
    expect(
      validateTransaction({
        date: today,
        amountCents: 1000,
        type: 'trasferimento',
        accountId: 'a',
        toAccountId: 'b',
        reimbursesId: 'x',
      }),
    ).not.toBeNull();
  });
});

describe('ordinamento e raggruppamento', () => {
  it('ordina dal più recente, e a parità di giorno per ora di inserimento', () => {
    const older = tx({ id: 'old', date: '2026-10-01' });
    const first = tx({ id: 'first', date: '2026-10-02', createdAt: '2026-10-02T08:00:00.000Z' });
    const second = tx({ id: 'second', date: '2026-10-02', createdAt: '2026-10-02T09:00:00.000Z' });
    const sorted = [older, first, second].sort(compareNewestFirst);
    expect(sorted.map((item) => item.id)).toEqual(['second', 'first', 'old']);
  });

  it('raggruppa per giorno', () => {
    const groups = groupByDay([
      tx({ date: '2026-10-02' }),
      tx({ date: '2026-10-02' }),
      tx({ date: '2026-10-01' }),
    ]);
    expect(groups.map((group) => [group.date, group.transactions.length])).toEqual([
      ['2026-10-02', 2],
      ['2026-10-01', 1],
    ]);
  });
});

describe('rankCategories', () => {
  const categories = [
    category('a', 'uscita', 1),
    category('b', 'uscita', 2),
    category('c', 'uscita', 3),
    category('nascosta', 'uscita', 4, true),
    category('entrata', 'entrata', 5),
  ];

  it('mette prima le più usate negli ultimi 90 giorni', () => {
    const ranked = rankCategories(
      categories,
      [
        tx({ categoryId: 'c', date: '2026-10-29' }),
        tx({ categoryId: 'c', date: '2026-10-28' }),
        tx({ categoryId: 'b', date: '2026-10-27' }),
      ],
      'uscita',
      today,
    );
    expect(ranked.map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('ignora gli usi troppo vecchi e usa l’ordine predefinito a parità', () => {
    const ranked = rankCategories(categories, [tx({ categoryId: 'c', date: '2026-01-01' })], 'uscita', today);
    expect(ranked.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('esclude le categorie archiviate e quelle di altro tipo', () => {
    const ranked = rankCategories(categories, [], 'uscita', today);
    expect(ranked.map((item) => item.id)).not.toContain('nascosta');
    expect(ranked.map((item) => item.id)).not.toContain('entrata');
  });
});

describe('defaultAccountId', () => {
  const accounts = [
    account('contanti', { type: 'contanti' }),
    account('corrente'),
    account('chiuso', { archived: true }),
  ];

  it('senza movimenti sceglie il primo conto corrente', () => {
    expect(defaultAccountId(accounts, [], 'uscita')).toBe('corrente');
  });

  it('senza conti correnti sceglie il primo conto attivo', () => {
    expect(defaultAccountId([account('x', { type: 'contanti' })], [], 'uscita')).toBe('x');
  });

  it('senza conti attivi non sceglie nulla', () => {
    expect(defaultAccountId([account('x', { archived: true })], [], 'uscita')).toBeUndefined();
  });

  it('sceglie l’ultimo conto usato per quel tipo di movimento', () => {
    const transactions = [
      tx({ accountId: 'corrente', createdAt: '2026-10-01T00:00:00.000Z' }),
      tx({ accountId: 'contanti', createdAt: '2026-10-02T00:00:00.000Z' }),
      tx({ accountId: 'corrente', type: 'entrata', createdAt: '2026-10-03T00:00:00.000Z' }),
    ];
    expect(defaultAccountId(accounts, transactions, 'uscita')).toBe('contanti');
    expect(defaultAccountId(accounts, transactions, 'entrata')).toBe('corrente');
  });

  it('non propone un conto archiviato', () => {
    const transactions = [tx({ accountId: 'chiuso' })];
    expect(defaultAccountId(accounts, transactions, 'uscita')).toBe('corrente');
  });
});

describe('reimbursedTotals', () => {
  it('somma i rimborsi di ogni spesa', () => {
    const totals = reimbursedTotals([
      tx({ id: 'cena', amountCents: 8000 }),
      tx({ type: 'entrata', amountCents: 2000, reimbursesId: 'cena' }),
      tx({ type: 'entrata', amountCents: 1500, reimbursesId: 'cena' }),
      tx({ type: 'entrata', amountCents: 999 }),
    ]);
    expect(totals.get('cena')).toBe(3500);
    expect(totals.size).toBe(1);
  });
});

describe('parseTags e normalizeText', () => {
  it('divide per virgola, toglie spazi e doppioni', () => {
    expect(parseTags(' viaggio, Roma ,, viaggio ')).toEqual(['viaggio', 'Roma']);
    expect(parseTags('')).toEqual([]);
  });

  it('ignora maiuscole e accenti', () => {
    expect(normalizeText('Università')).toBe('universita');
  });
});

describe('filterTransactions', () => {
  const context = {
    accountNames: new Map([
      ['a', 'Corrente'],
      ['b', 'Deposito'],
    ]),
    categoryNames: new Map([
      ['c', 'Spesa alimentare'],
      ['u', 'Università'],
    ]),
  };
  const spesa = tx({ id: 'spesa', note: 'Panetteria', amountCents: 123456, date: '2026-10-10' });
  const tasse = tx({ id: 'tasse', categoryId: 'u', tags: ['ateneo'], amountCents: 5000, date: '2026-09-10' });
  const giroconto: Transaction = {
    id: 'giroconto',
    date: '2026-08-10',
    amountCents: 20000,
    type: 'trasferimento',
    accountId: 'a',
    toAccountId: 'b',
    createdAt: '2026-08-10T00:00:00.000Z',
  };
  const all = [spesa, tasse, giroconto];
  const ids = (filter: Parameters<typeof filterTransactions>[1]) =>
    filterTransactions(all, filter, context).map((item) => item.id);

  it('senza filtri restituisce tutto', () => {
    expect(ids({})).toEqual(['spesa', 'tasse', 'giroconto']);
  });

  it('cerca in nota, categoria, conto e tag, ignorando maiuscole e accenti', () => {
    expect(ids({ query: 'panetteria' })).toEqual(['spesa']);
    expect(ids({ query: 'universita' })).toEqual(['tasse']);
    expect(ids({ query: 'ATENEO' })).toEqual(['tasse']);
    expect(ids({ query: 'deposito' })).toEqual(['giroconto']);
    expect(ids({ query: 'trasferimento' })).toEqual(['giroconto']);
  });

  it('richiede tutte le parole cercate', () => {
    expect(ids({ query: 'spesa panetteria' })).toEqual(['spesa']);
    expect(ids({ query: 'spesa ateneo' })).toEqual([]);
  });

  it('cerca per importo, con e senza il punto delle migliaia', () => {
    expect(ids({ query: '1.234,56' })).toEqual(['spesa']);
    expect(ids({ query: '1234,56' })).toEqual(['spesa']);
    expect(ids({ query: '50,00' })).toEqual(['tasse']);
  });

  it('filtra per categoria', () => {
    expect(ids({ categoryId: 'u' })).toEqual(['tasse']);
  });

  it('filtra per conto, comprese le destinazioni dei trasferimenti', () => {
    expect(ids({ accountId: 'b' })).toEqual(['giroconto']);
    expect(ids({ accountId: 'a' })).toEqual(['spesa', 'tasse', 'giroconto']);
  });

  it('filtra per periodo, estremi compresi', () => {
    expect(ids({ from: '2026-09-10', to: '2026-10-09' })).toEqual(['tasse']);
    expect(ids({ from: '2026-10-10' })).toEqual(['spesa']);
    expect(ids({ to: '2026-08-10' })).toEqual(['giroconto']);
  });

  it('combina i filtri', () => {
    expect(ids({ accountId: 'a', query: 'spesa', from: '2026-10-01' })).toEqual(['spesa']);
    expect(ids({ categoryId: 'u', from: '2026-10-01' })).toEqual([]);
  });
});

describe('periodRange', () => {
  it('calcola i periodi rispetto a oggi', () => {
    expect(periodRange('tutto', today)).toEqual({});
    expect(periodRange('personalizzato', today)).toEqual({});
    expect(periodRange('mese', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('mese-scorso', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('tre-mesi', today)).toEqual({ from: '2026-08-01', to: '2026-10-31' });
    expect(periodRange('anno', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('attraversa il cambio di anno', () => {
    expect(periodRange('mese-scorso', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(periodRange('tre-mesi', '2026-01-15')).toEqual({ from: '2025-11-01', to: '2026-01-31' });
  });
});

describe('firstGrapheme', () => {
  it('tiene una sola emoji, anche se composta', () => {
    expect(firstGrapheme('🧑‍🎓 testo')).toBe('🧑‍🎓');
    expect(firstGrapheme('🇮🇹🇮🇹')).toBe('🇮🇹');
    expect(firstGrapheme(' a')).toBe('a');
    expect(firstGrapheme('')).toBe('');
  });
});
