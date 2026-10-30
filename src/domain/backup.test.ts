import { describe, expect, it } from 'vitest';
import {
  backupReminder,
  buildBackup,
  parseBackup,
  SCHEMA_VERSION,
  serializeBackup,
  summarizeData,
  type BackupData,
} from './backup';
import { DEFAULT_CATEGORIES } from './categories';
import type { Account, Recurring, Reconciliation, Transaction } from './types';

const account: Account = {
  id: 'a',
  name: 'Corrente',
  type: 'corrente',
  currency: 'EUR',
  initialBalanceCents: 100000,
  initialBalanceDate: '2026-01-01',
  archived: false,
  contaComeLiquidita: true,
  createdAt: '2026-01-01T10:00:00.000Z',
};

const expense: Transaction = {
  id: 'cena',
  date: '2026-02-01',
  amountCents: 8000,
  type: 'uscita',
  accountId: 'a',
  categoryId: 'cat-ristoranti',
  note: 'Cena',
  createdAt: '2026-02-01T20:00:00.000Z',
};

const refund: Transaction = {
  id: 'rimborso',
  date: '2026-02-03',
  amountCents: 4000,
  type: 'entrata',
  accountId: 'a',
  categoryId: 'cat-rimborsi',
  reimbursesId: 'cena',
  createdAt: '2026-02-03T20:00:00.000Z',
};

function data(fields: Partial<BackupData> = {}): BackupData {
  return {
    accounts: [account],
    transactions: [expense, refund],
    categories: [...DEFAULT_CATEGORIES],
    budgets: [],
    recurring: [],
    reconciliations: [],
    importProfiles: [],
    importRules: [],
    holdings: [],
    settings: [{ key: 'lastBackupAt', value: '2026-02-03T20:00:00.000Z' }],
    ...fields,
  };
}

function serialized(fields: Partial<BackupData> = {}): string {
  return serializeBackup(buildBackup(data(fields), new Date('2026-10-30T12:00:00.000Z')));
}

function errorOf(text: string): string {
  const result = parseBackup(text);
  if (result.ok) throw new Error('Doveva essere rifiutato');
  return result.error;
}

describe('parseBackup', () => {
  it('rilegge fedelmente un backup appena creato', () => {
    const result = parseBackup(serialized());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.backup.exportedAt).toBe('2026-10-30T12:00:00.000Z');
    expect(result.backup.data).toEqual(data());
  });

  it('conserva i centesimi esatti', () => {
    const precise = { ...expense, amountCents: 1 };
    const result = parseBackup(serialized({ transactions: [precise] }));
    expect(result.ok && result.backup.data.transactions[0]?.amountCents).toBe(1);
  });

  it('rifiuta file che non sono JSON o non sono backup', () => {
    expect(errorOf('non è json')).toMatch(/JSON/);
    expect(errorOf('[]')).toMatch(/non è un backup/);
    expect(errorOf('{"app":"altra"}')).toMatch(/non è un backup/);
  });

  it('rifiuta versioni sconosciute o più recenti', () => {
    const file = JSON.parse(serialized());
    expect(errorOf(JSON.stringify({ ...file, schemaVersion: 0 }))).toMatch(/non riconosciuta/);
    expect(errorOf(JSON.stringify({ ...file, schemaVersion: '1' }))).toMatch(/non riconosciuta/);
    expect(errorOf(JSON.stringify({ ...file, schemaVersion: SCHEMA_VERSION + 1 }))).toMatch(/più recente/);
  });

  it('rifiuta un file senza dati o con tabelle non valide', () => {
    const file = JSON.parse(serialized());
    expect(errorOf(JSON.stringify({ ...file, data: null }))).toMatch(/non contiene dati/);
    expect(errorOf(JSON.stringify({ ...file, data: { accounts: 'x' } }))).toMatch(/accounts/);
    expect(errorOf(JSON.stringify({ ...file, data: { accounts: [1] } }))).toMatch(/accounts/);
  });

  it('considera vuote le tabelle assenti', () => {
    const file = JSON.parse(serialized());
    delete file.data.holdings;
    const result = parseBackup(JSON.stringify(file));
    expect(result.ok && result.backup.data.holdings).toEqual([]);
  });

  it('rifiuta importi non interi', () => {
    expect(errorOf(serialized({ transactions: [{ ...expense, amountCents: 12.5 }] }))).toMatch(/centesimi/);
    expect(errorOf(serialized({ accounts: [{ ...account, initialBalanceCents: 0.1 }] }))).toMatch(/centesimi/);
  });

  it('rifiuta date non valide', () => {
    expect(errorOf(serialized({ transactions: [{ ...expense, date: '2026-02-30' }] }))).toMatch(/Data non valida/);
    expect(errorOf(serialized({ accounts: [{ ...account, initialBalanceDate: 'ieri' }] }))).toMatch(/data del saldo/);
  });

  it('rifiuta riferimenti a conti, categorie o spese inesistenti', () => {
    expect(errorOf(serialized({ transactions: [{ ...expense, accountId: 'x' }] }))).toMatch(/conto non esiste/);
    expect(errorOf(serialized({ transactions: [{ ...expense, categoryId: 'x' }] }))).toMatch(/categoria non esiste/);
    expect(errorOf(serialized({ transactions: [refund] }))).toMatch(/spesa rimborsata non esiste/);
    expect(
      errorOf(
        serialized({
          transactions: [
            { id: 't', date: '2026-02-01', amountCents: 100, type: 'trasferimento', accountId: 'a', toAccountId: 'x', createdAt: 'z' },
          ],
        }),
      ),
    ).toMatch(/destinazione non esiste/);
  });

  it('un rimborso deve riferirsi a una spesa, non a un’entrata', () => {
    const income: Transaction = { ...expense, type: 'entrata' };
    expect(errorOf(serialized({ transactions: [income, refund] }))).toMatch(/spesa rimborsata/);
  });

  it('rifiuta identificatori duplicati', () => {
    expect(errorOf(serialized({ accounts: [account, account] }))).toMatch(/duplicato/);
    expect(errorOf(serialized({ transactions: [expense, expense] }))).toMatch(/duplicato/);
  });

  it('rifiuta conti e categorie incompleti', () => {
    expect(errorOf(serialized({ accounts: [{ ...account, name: '' }] }))).toMatch(/nome/);
    expect(errorOf(serialized({ accounts: [{ ...account, type: 'boh' as Account['type'] }] }))).toMatch(/tipo/);
    const [first] = DEFAULT_CATEGORIES;
    if (!first) throw new Error('Categorie vuote');
    expect(errorOf(serialized({ categories: [{ ...first, kind: 'boh' as never }] }))).toMatch(/tipo/);
  });
});

describe('summarizeData', () => {
  it('conta le righe e trova il periodo coperto', () => {
    const summary = summarizeData(data());
    expect(summary.accounts).toBe(1);
    expect(summary.transactions).toBe(2);
    expect(summary.categories).toBe(DEFAULT_CATEGORIES.length);
    expect(summary.firstDate).toBe('2026-02-01');
    expect(summary.lastDate).toBe('2026-02-03');
  });

  it('non ha periodo se non ci sono movimenti', () => {
    const summary = summarizeData(data({ transactions: [] }));
    expect(summary.firstDate).toBeUndefined();
    expect(summary.lastDate).toBeUndefined();
  });
});

describe('parseBackup: verifiche e ricorrenze', () => {
  const reconciliation: Reconciliation = { id: 'v', accountId: 'a', date: '2026-02-05', realBalanceCents: 92000 };
  const recurring: Recurring = {
    id: 'r',
    name: 'Affitto',
    frequency: 'mensile',
    anchorDate: '2026-01-01',
    nextDue: '2026-11-01',
    active: true,
    template: { type: 'uscita', amountCents: 50000, accountId: 'a', categoryId: 'cat-casa' },
  };

  it('accetta dati validi e li conserva', () => {
    const result = parseBackup(serialized({ reconciliations: [reconciliation], recurring: [recurring] }));
    expect(result.ok && result.backup.data.reconciliations).toEqual([reconciliation]);
    expect(result.ok && result.backup.data.recurring).toEqual([recurring]);
  });

  it('rifiuta verifiche non coerenti', () => {
    expect(errorOf(serialized({ reconciliations: [{ ...reconciliation, accountId: 'x' }] }))).toMatch(/conto non esiste/);
    expect(errorOf(serialized({ reconciliations: [{ ...reconciliation, date: 'ieri' }] }))).toMatch(/data non è valida/);
    expect(errorOf(serialized({ reconciliations: [{ ...reconciliation, realBalanceCents: 0.5 }] }))).toMatch(/centesimi/);
    expect(errorOf(serialized({ reconciliations: [{ ...reconciliation, adjustmentId: 'x' }] }))).toMatch(/rettifica collegata/);
  });

  it('rifiuta ricorrenze non coerenti', () => {
    const template = recurring.template;
    expect(errorOf(serialized({ recurring: [{ ...recurring, name: '' }] }))).toMatch(/nome/);
    expect(errorOf(serialized({ recurring: [{ ...recurring, nextDue: 'mai' }] }))).toMatch(/date/);
    expect(errorOf(serialized({ recurring: [{ ...recurring, frequency: 'boh' as never }] }))).toMatch(/frequenza/);
    expect(errorOf(serialized({ recurring: [{ ...recurring, frequency: 'personalizzata' }] }))).toMatch(/intervallo/);
    expect(errorOf(serialized({ recurring: [{ ...recurring, template: { ...template, amountCents: 0 } }] }))).toMatch(/importo/i);
    expect(errorOf(serialized({ recurring: [{ ...recurring, template: { ...template, accountId: 'x' } }] }))).toMatch(/conto non esiste/);
    expect(errorOf(serialized({ recurring: [{ ...recurring, template: { ...template, categoryId: 'x' } }] }))).toMatch(/categoria non esiste/);
  });
});

describe('backupReminder', () => {
  const today = '2026-10-30';
  const atNoon = (date: string) => new Date(`${date}T12:00:00`).toISOString();

  it('non dice nulla finché non ci sono dati', () => {
    expect(backupReminder(undefined, false, today)).toBeNull();
    expect(backupReminder(atNoon('2026-01-01'), false, today)).toBeNull();
  });

  it('segnala se non è mai stato fatto un backup', () => {
    expect(backupReminder(undefined, true, today)).toEqual({ kind: 'never' });
  });

  it('avvisa solo oltre i 14 giorni', () => {
    expect(backupReminder(atNoon('2026-10-30'), true, today)).toBeNull();
    expect(backupReminder(atNoon('2026-10-16'), true, today)).toBeNull();
    expect(backupReminder(atNoon('2026-10-15'), true, today)).toEqual({ kind: 'old', days: 15 });
  });
});
