import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from './categories';
import { transactionsToCsv } from './csv';
import type { Account, Transaction } from './types';

function account(id: string, name: string): Account {
  return {
    id,
    name,
    type: 'corrente',
    currency: 'EUR',
    initialBalanceCents: 0,
    initialBalanceDate: '2026-01-01',
    archived: false,
    contaComeLiquidita: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const accounts = [account('a', 'Corrente'), account('b', 'Deposito')];

function lines(transactions: Transaction[]): string[] {
  return transactionsToCsv(transactions, accounts, [...DEFAULT_CATEGORIES]).split('\r\n');
}

const base: Transaction = {
  id: 't',
  date: '2026-10-30',
  amountCents: 123456,
  type: 'uscita',
  accountId: 'a',
  categoryId: 'cat-spesa',
  createdAt: '2026-10-30T10:00:00.000Z',
};

describe('transactionsToCsv', () => {
  it('inizia con il BOM e l’intestazione', () => {
    const [header] = lines([]);
    expect(header).toBe('﻿Data;Tipo;Importo;Conto;Conto di destinazione;Categoria;Nota;Tag');
  });

  it('scrive gli importi con la virgola, senza separatore delle migliaia', () => {
    expect(lines([base])[1]).toBe('2026-10-30;Uscita;1234,56;Corrente;;Spesa alimentare;;');
    expect(lines([{ ...base, amountCents: 5 }])[1]).toContain(';0,05;');
  });

  it('scrive i trasferimenti con entrambi i conti', () => {
    const transfer: Transaction = {
      id: 'g',
      date: '2026-10-30',
      amountCents: 50000,
      type: 'trasferimento',
      accountId: 'a',
      toAccountId: 'b',
      createdAt: '2026-10-30T10:00:00.000Z',
    };
    expect(lines([transfer])[1]).toBe('2026-10-30;Trasferimento;500,00;Corrente;Deposito;;;');
  });

  it('conserva il segno delle rettifiche', () => {
    const adjustment: Transaction = { ...base, type: 'rettifica', amountCents: -2550, categoryId: 'cat-non-tracciato' };
    expect(lines([adjustment])[1]).toBe('2026-10-30;Rettifica;-25,50;Corrente;;Non tracciato;;');
  });

  it('protegge i testi con separatori, virgolette e a capo', () => {
    expect(lines([{ ...base, note: 'pane; latte' }])[1]).toContain(';"pane; latte";');
    expect(lines([{ ...base, note: 'il "solito"' }])[1]).toContain(';"il ""solito""";');
    expect(transactionsToCsv([{ ...base, note: 'a\nb' }], accounts, [...DEFAULT_CATEGORIES])).toContain('"a\nb"');
  });

  it('neutralizza i testi che Excel leggerebbe come formule', () => {
    expect(lines([{ ...base, note: '=SOMMA(A1)' }])[1]).toContain(";'=SOMMA(A1);");
    expect(lines([{ ...base, note: '-10 sconto' }])[1]).toContain(";'-10 sconto;");
  });

  it('elenca tag e ordine, dal più recente', () => {
    const older = { ...base, id: 'old', date: '2026-10-01', tags: ['viaggio', 'Roma'] };
    const rows = lines([older, base]);
    expect(rows[1]).toContain('2026-10-30');
    expect(rows[2]).toContain('2026-10-01');
    expect(rows[2]?.endsWith(';viaggio, Roma')).toBe(true);
  });
});
