import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, serializeBackup } from '../domain/backup';
import { computeBalances } from '../domain/balances';
import { buildPreview, previewDrafts, type PreviewRow } from '../domain/importPreview';
import { summarizePeriod } from '../domain/reports';
import { parseDelimitedText } from '../domain/statementFile';
import { extractRows, findHeaderRow, findProfile, guessMapping, signatureOf } from '../domain/statementMapping';
import type { ImportMapping, TransactionDraft } from '../domain/types';
import { createAccount, deleteAccount, type AccountDraft } from './accounts';
import { createCategory, deleteCategory } from './categories';
import { clearAllData, readAllData } from './data';
import { db } from './db';
import { createRule, deleteProfile, deleteRule, importMovements, renameProfile, saveProfile, updateRule } from './imports';

const accountDraft: AccountDraft = {
  name: 'Corrente',
  type: 'corrente',
  currency: 'EUR',
  initialBalanceCents: 100000,
  initialBalanceDate: '2026-10-01',
  archived: false,
  contaComeLiquidita: true,
};

const STATEMENT = `Movimenti del conto;;;
;;;
Data;Descrizione;Uscite;Entrate
03/10/2026;PAGAMENTO POS SUPERMERCATO ROSSI;45,20;
05/10/2026;BONIFICO STIPENDIO;;1.400,00
07/10/2026;BONIFICO VERSO DEPOSITO;200,00;
07/10/2026;CAFFE CENTRALE;1,50;
07/10/2026;CAFFE CENTRALE;1,50;
`;

const mapping: ImportMapping = {
  headerRow: 2,
  dateColumn: 0,
  dateOrder: 'gma',
  descriptionColumn: 1,
  detailsColumn: null,
  amount: { mode: 'due-colonne', incomeColumn: 3, expenseColumn: 2 },
};

function draft(fields: Partial<TransactionDraft> = {}): TransactionDraft {
  return { date: '2026-10-05', amountCents: 1000, type: 'uscita', accountId: 'a', categoryId: 'cat-spesa', importId: 'x', ...fields };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('importMovements', () => {
  it('aggiunge i movimenti', async () => {
    const { count } = await importMovements([draft(), draft({ importId: 'y', note: 'Spesa' })]);
    expect(count).toBe(2);
    expect(await db.transactions.count()).toBe(2);
    expect(await db.transactions.where('importId').equals('y').first()).toMatchObject({ note: 'Spesa', amountCents: 1000 });
  });

  it('annullando toglie solo quelli importati', async () => {
    await importMovements([draft({ importId: 'prima' })]);
    const { undo } = await importMovements([draft({ importId: 'a' }), draft({ importId: 'b' })]);
    await undo();
    expect((await db.transactions.toArray()).map((item) => item.importId)).toEqual(['prima']);
  });

  it('un secondo tocco non crea doppioni', async () => {
    await importMovements([draft()]);
    const { count } = await importMovements([draft(), draft({ importId: 'nuovo' })]);
    expect(count).toBe(1);
    expect(await db.transactions.count()).toBe(2);
  });

  it('è tutto o niente: una riga sbagliata non lascia un import a metà', async () => {
    await expect(importMovements([draft(), draft({ importId: 'y', categoryId: undefined })])).rejects.toThrow(/categoria/);
    expect(await db.transactions.count()).toBe(0);
  });

  it('accetta una lista vuota', async () => {
    expect((await importMovements([])).count).toBe(0);
  });
});

describe('mappature salvate', () => {
  it('ne tiene una per banca: stesse intestazioni, stessa mappatura', async () => {
    const first = await saveProfile({ name: ' Banca ', signature: 'data|importo', mapping });
    const second = await saveProfile({ name: 'Banca nuova', signature: 'data|importo', mapping, accountId: 'c' });
    expect(second).toBe(first);
    expect(await db.importProfiles.count()).toBe(1);
    expect(await db.importProfiles.get(first)).toMatchObject({ name: 'Banca nuova', accountId: 'c' });
  });

  it('banche diverse hanno mappature diverse', async () => {
    await saveProfile({ name: 'A', signature: 'a', mapping });
    await saveProfile({ name: 'B', signature: 'b', mapping });
    expect(await db.importProfiles.count()).toBe(2);
  });

  it('senza intestazioni non sovrascrive un’altra banca', async () => {
    await saveProfile({ name: 'A', signature: '', mapping });
    await saveProfile({ name: 'B', signature: '', mapping });
    expect(await db.importProfiles.count()).toBe(2);
  });

  it('richiede un nome', async () => {
    await expect(saveProfile({ name: '  ', signature: 'a', mapping })).rejects.toThrow(/nome/);
    const id = await saveProfile({ name: 'A', signature: 'a', mapping });
    await expect(renameProfile(id, ' ')).rejects.toThrow(/nome/);
  });

  it('si rinomina e si elimina', async () => {
    const id = await saveProfile({ name: 'A', signature: 'a', mapping });
    await renameProfile(id, ' B ');
    expect((await db.importProfiles.get(id))?.name).toBe('B');
    await deleteProfile(id);
    expect(await db.importProfiles.count()).toBe(0);
  });

  it('eliminando il conto la mappatura resta, senza il conto', async () => {
    const accountId = await createAccount(accountDraft);
    const id = await saveProfile({ name: 'A', signature: 'a', mapping, accountId });
    await deleteAccount(accountId);
    const profile = await db.importProfiles.get(id);
    expect(profile?.name).toBe('A');
    expect(profile?.accountId).toBeUndefined();
  });
});

describe('regole', () => {
  it('toglie gli spazi e richiede testo e categoria', async () => {
    const rule = await createRule({ contains: ' ROSSI ', categoryId: 'cat-spesa' });
    expect(await db.importRules.get(rule.id)).toEqual({ id: rule.id, contains: 'ROSSI', categoryId: 'cat-spesa' });
    await expect(createRule({ contains: '  ', categoryId: 'cat-spesa' })).rejects.toThrow(/testo/);
    await expect(createRule({ contains: 'x', categoryId: '' })).rejects.toThrow(/categoria/);
  });

  it('una regola di trasferimento ha il conto e non la categoria', async () => {
    const rule = await createRule({ contains: ' DEPOSITO ', transferAccountId: 'conto', categoryId: 'cat-spesa' });
    expect(await db.importRules.get(rule.id)).toEqual({ id: rule.id, contains: 'DEPOSITO', transferAccountId: 'conto' });
    await updateRule(rule.id, { contains: 'DEPOSITO', categoryId: 'cat-spesa' });
    expect(await db.importRules.get(rule.id)).toEqual({ id: rule.id, contains: 'DEPOSITO', categoryId: 'cat-spesa' });
  });

  it('spariscono con il conto a cui puntano', async () => {
    const accountId = await createAccount(accountDraft);
    await createRule({ contains: 'A', transferAccountId: accountId });
    await createRule({ contains: 'B', categoryId: 'cat-spesa' });
    await deleteAccount(accountId);
    expect((await db.importRules.toArray()).map((rule) => rule.contains)).toEqual(['B']);
  });

  it('si modificano e si eliminano', async () => {
    const { id } = await createRule({ contains: 'ROSSI', categoryId: 'cat-spesa' });
    await updateRule(id, { contains: 'BIANCHI', categoryId: 'cat-viaggi' });
    expect(await db.importRules.get(id)).toEqual({ id, contains: 'BIANCHI', categoryId: 'cat-viaggi' });
    await deleteRule(id);
    expect(await db.importRules.count()).toBe(0);
  });

  it('spariscono con la categoria a cui puntano', async () => {
    const categoryId = await createCategory({ name: 'Mia', emoji: '🍎', color: '#000000', group: 'Altro', kind: 'uscita', fissa: false, archived: false });
    await createRule({ contains: 'A', categoryId });
    await createRule({ contains: 'B', categoryId: 'cat-spesa' });
    await deleteCategory(categoryId);
    expect((await db.importRules.toArray()).map((rule) => rule.contains)).toEqual(['B']);
  });
});

describe('backup', () => {
  it('regole e mappature tornano uguali', async () => {
    const accountId = await createAccount(accountDraft);
    await saveProfile({ name: 'Banca', signature: 'data|importo', mapping, accountId });
    await createRule({ contains: 'ROSSI', categoryId: 'cat-spesa' });
    const data = await readAllData();
    const result = parseBackup(serializeBackup(buildBackup(data)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.backup.data.importProfiles).toEqual(data.importProfiles);
      expect(result.backup.data.importRules).toEqual(data.importRules);
    }
  });

  it('rifiuta regole e mappature rovinate', async () => {
    const data = await readAllData();
    const errorOf = (fields: object) => {
      const result = parseBackup(serializeBackup(buildBackup({ ...data, ...fields })));
      return result.ok ? '' : result.error;
    };
    expect(errorOf({ importRules: [{ id: 'r', contains: '', categoryId: 'cat-spesa' }] })).toMatch(/testo/);
    expect(errorOf({ importRules: [{ id: 'r', contains: 'x', categoryId: 'boh' }] })).toMatch(/categoria/);
    expect(errorOf({ importRules: [{ id: 'r', contains: 'x' }] })).toMatch(/categoria/);
    expect(errorOf({ importRules: [{ id: 'r', contains: 'x', transferAccountId: 'boh' }] })).toMatch(/conto non esiste/);
    expect(errorOf({ importRules: [{ id: 'r', contains: 'x', categoryId: 'cat-spesa', transferAccountId: 'boh' }] })).toMatch(/sia una categoria sia un conto/);
    expect(errorOf({ importProfiles: [{ id: 'p', name: '', signature: '', mapping }] })).toMatch(/nome/);
    expect(errorOf({ importProfiles: [{ id: 'p', name: 'A', signature: 1, mapping }] })).toMatch(/intestazioni/);
    expect(errorOf({ importProfiles: [{ id: 'p', name: 'A', signature: '', mapping: {} }] })).toMatch(/colonne/);
    expect(errorOf({ importProfiles: [{ id: 'p', name: 'A', signature: '', mapping, accountId: 'boh' }] })).toMatch(/conto/);
  });

  it('cancellando tutto spariscono anche regole e mappature', async () => {
    await saveProfile({ name: 'Banca', signature: 'a', mapping });
    await createRule({ contains: 'ROSSI', categoryId: 'cat-spesa' });
    await clearAllData();
    expect(await db.importProfiles.count()).toBe(0);
    expect(await db.importRules.count()).toBe(0);
  });
});

describe('dal file ai report', () => {
  async function previewOfStatement(accountId: string): Promise<PreviewRow[]> {
    const rows = parseDelimitedText(STATEMENT);
    const headerRow = findHeaderRow(rows);
    const { rows: read } = extractRows(rows, guessMapping(rows, headerRow));
    const data = await readAllData();
    return buildPreview(read, { accountId, accounts: data.accounts, transactions: data.transactions, rules: data.importRules, categories: data.categories });
  }

  it('un trasferimento segnato in anteprima non diventa una spesa, e il file non si importa due volte', async () => {
    const accountId = await createAccount(accountDraft);
    const depositId = await createAccount({ ...accountDraft, name: 'Deposito', initialBalanceCents: 0, type: 'deposito' });
    await createRule({ contains: 'supermercato', categoryId: 'cat-spesa' });
    await createRule({ contains: 'stipendio', categoryId: 'cat-stipendio' });

    const first = await previewOfStatement(accountId);
    expect(first).toHaveLength(5);
    const edited = first.map((row): PreviewRow =>
      row.description.includes('DEPOSITO') ? { ...row, type: 'trasferimento', categoryId: undefined, otherAccountId: depositId, edited: true } : row,
    );
    const { count } = await importMovements(previewDrafts(edited, accountId));
    expect(count).toBe(5);

    const data = await readAllData();
    const summary = summarizePeriod(data, '2026-10-01', '2026-10-31');
    expect(summary.incomeCents).toBe(140000);
    expect(summary.expenseCents).toBe(4820);
    expect(summary.savingsCents).toBe(135180);
    expect(summary.sources.salaryCents).toBe(140000);

    const balances = computeBalances(data.accounts, data.transactions, '2026-10-31');
    expect(balances.get(accountId)).toBe(100000 - 4520 + 140000 - 20000 - 150 - 150);
    expect(balances.get(depositId)).toBe(20000);

    const second = await previewOfStatement(accountId);
    expect(second.every((row) => !row.include && row.status === 'gia-importato')).toBe(true);
    expect((await importMovements(previewDrafts(second, accountId))).count).toBe(0);
    expect(await db.transactions.count()).toBe(5);
  });

  it('con una regola il trasferimento si riconosce da solo, e dall’altro conto risulta già presente', async () => {
    const accountId = await createAccount(accountDraft);
    const depositId = await createAccount({ ...accountDraft, name: 'Deposito', initialBalanceCents: 0, type: 'deposito' });
    await createRule({ contains: 'verso deposito', transferAccountId: depositId });

    const preview = await previewOfStatement(accountId);
    expect(preview.find((row) => row.description.includes('DEPOSITO'))).toMatchObject({ type: 'trasferimento', otherAccountId: depositId });
    await importMovements(previewDrafts(preview, accountId));

    const data = await readAllData();
    const summary = summarizePeriod(data, '2026-10-01', '2026-10-31');
    expect(summary.expenseCents).toBe(4820);
    const balances = computeBalances(data.accounts, data.transactions, '2026-10-31');
    expect(balances.get(depositId)).toBe(20000);

    const [fromDeposit] = buildPreview([{ date: '2026-10-08', description: 'BONIFICO RICEVUTO', amountCents: 20000 }], {
      accountId: depositId,
      accounts: data.accounts,
      transactions: data.transactions,
      rules: data.importRules,
      categories: data.categories,
    });
    expect(fromDeposit).toMatchObject({ status: 'forse-presente', include: false });
  });

  it('la banca salvata viene riconosciuta al file successivo', async () => {
    const rows = parseDelimitedText(STATEMENT);
    const headerRow = findHeaderRow(rows) ?? 0;
    const id = await saveProfile({ name: 'Banca', signature: signatureOf(rows[headerRow] ?? []), mapping: guessMapping(rows, headerRow) });
    const found = findProfile(parseDelimitedText(`Una riga in più;;;\n${STATEMENT}`), await db.importProfiles.toArray());
    expect(found?.profile.id).toBe(id);
    expect(found?.headerRow).toBe(headerRow + 1);
  });
});
