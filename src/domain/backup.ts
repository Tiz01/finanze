import { isValidIsoDate } from './dates';
import { compareNewestFirst, validateTransaction } from './transactions';
import {
  ACCOUNT_TYPES,
  type Account,
  type Budget,
  type Category,
  type Holding,
  type ImportProfile,
  type ImportRule,
  type IsoDate,
  type Recurring,
  type Reconciliation,
  type Setting,
  type Transaction,
} from './types';

/** Stessa versione dello schema Dexie: va aumentata insieme a ogni migrazione. */
export const SCHEMA_VERSION = 1;

const APP_ID = 'finanze';

export interface BackupData {
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  recurring: Recurring[];
  reconciliations: Reconciliation[];
  importProfiles: ImportProfile[];
  importRules: ImportRule[];
  holdings: Holding[];
  settings: Setting[];
}

export const BACKUP_TABLES = [
  'accounts',
  'transactions',
  'categories',
  'budgets',
  'recurring',
  'reconciliations',
  'importProfiles',
  'importRules',
  'holdings',
  'settings',
] as const satisfies readonly (keyof BackupData)[];

export interface BackupFile {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  data: BackupData;
}

export function buildBackup(data: BackupData, now: Date = new Date()): BackupFile {
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), data };
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 1);
}

export type BackupParseResult = { ok: true; backup: BackupFile } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

// Le trasformazioni da una versione alla successiva: la chiave è la versione di partenza.
const MIGRATIONS: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {};

export function parseBackup(text: string): BackupParseResult {
  const fail = (error: string): BackupParseResult => ({ ok: false, error });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('Il file non è un JSON valido.');
  }
  if (!isRecord(raw) || raw.app !== APP_ID) return fail('Questo file non è un backup di Finanze.');

  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail('Versione del backup non riconosciuta.');
  }
  if (version > SCHEMA_VERSION) {
    return fail('Il backup viene da una versione più recente dell’app: aggiornala e riprova.');
  }
  if (!isRecord(raw.data)) return fail('Il backup non contiene dati.');
  if (typeof raw.exportedAt !== 'string' || Number.isNaN(Date.parse(raw.exportedAt))) {
    return fail('Il backup non indica una data valida.');
  }

  let source = raw.data;
  for (let step = version; step < SCHEMA_VERSION; step += 1) {
    const migrate = MIGRATIONS[step];
    if (migrate) source = migrate(source);
  }

  const tables: Record<string, unknown[]> = {};
  for (const name of BACKUP_TABLES) {
    const table = source[name] ?? [];
    if (!Array.isArray(table)) return fail(`La tabella ${name} non è valida.`);
    if (!table.every(isRecord)) return fail(`La tabella ${name} contiene righe non valide.`);
    tables[name] = table;
  }
  const data = tables as unknown as BackupData;

  const problem = findProblem(data);
  if (problem) return fail(problem);

  return {
    ok: true,
    backup: { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: raw.exportedAt, data },
  };
}

function firstDuplicate(values: unknown[]): unknown {
  const seen = new Set<unknown>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function accountProblem(account: Account): string | null {
  if (!isNonEmptyString(account.id)) return 'manca l’identificatore';
  if (!isNonEmptyString(account.name)) return 'manca il nome';
  if (!ACCOUNT_TYPES.includes(account.type)) return `tipo sconosciuto (${String(account.type)})`;
  if (!isNonEmptyString(account.currency)) return 'manca la valuta';
  if (!Number.isSafeInteger(account.initialBalanceCents)) return 'il saldo iniziale non è in centesimi interi';
  if (!isValidIsoDate(account.initialBalanceDate)) return 'la data del saldo iniziale non è valida';
  if (typeof account.archived !== 'boolean' || typeof account.contaComeLiquidita !== 'boolean') {
    return 'i campi sì/no non sono validi';
  }
  return null;
}

function categoryProblem(category: Category): string | null {
  if (!isNonEmptyString(category.id)) return 'manca l’identificatore';
  if (!isNonEmptyString(category.name)) return 'manca il nome';
  if (!['entrata', 'uscita', 'rettifica'].includes(category.kind)) return `tipo sconosciuto (${String(category.kind)})`;
  if (typeof category.group !== 'string' || typeof category.emoji !== 'string' || typeof category.color !== 'string') {
    return 'gruppo, emoji o colore non validi';
  }
  if (typeof category.fissa !== 'boolean' || typeof category.archived !== 'boolean' || typeof category.system !== 'boolean') {
    return 'i campi sì/no non sono validi';
  }
  if (typeof category.order !== 'number') return 'l’ordine non è valido';
  return null;
}

function findProblem(data: BackupData): string | null {
  for (const account of data.accounts) {
    const problem = accountProblem(account);
    if (problem) return `Conto «${String(account.name ?? account.id)}»: ${problem}.`;
  }
  for (const category of data.categories) {
    const problem = categoryProblem(category);
    if (problem) return `Categoria «${String(category.name ?? category.id)}»: ${problem}.`;
  }

  const duplicateAccount = firstDuplicate(data.accounts.map((account) => account.id));
  if (duplicateAccount !== undefined) return `Conto duplicato: ${String(duplicateAccount)}.`;
  const duplicateCategory = firstDuplicate(data.categories.map((category) => category.id));
  if (duplicateCategory !== undefined) return `Categoria duplicata: ${String(duplicateCategory)}.`;
  const duplicateMovement = firstDuplicate(data.transactions.map((transaction) => transaction.id));
  if (duplicateMovement !== undefined) return `Movimento duplicato: ${String(duplicateMovement)}.`;

  const accountIds = new Set(data.accounts.map((account) => account.id));
  const categoryIds = new Set(data.categories.map((category) => category.id));
  const expenseIds = new Set(data.transactions.filter((item) => item.type === 'uscita').map((item) => item.id));

  for (const transaction of data.transactions) {
    const label = `Movimento del ${String(transaction.date)}`;
    if (!isNonEmptyString(transaction.id)) return `${label}: manca l’identificatore.`;
    if (!isNonEmptyString(transaction.createdAt)) return `${label}: manca la data di inserimento.`;
    const problem = validateTransaction(transaction);
    if (problem) return `${label}: ${problem}.`;
    if (!accountIds.has(transaction.accountId)) return `${label}: il conto non esiste.`;
    if (transaction.toAccountId && !accountIds.has(transaction.toAccountId)) {
      return `${label}: il conto di destinazione non esiste.`;
    }
    if (transaction.categoryId && !categoryIds.has(transaction.categoryId)) return `${label}: la categoria non esiste.`;
    if (transaction.reimbursesId && !expenseIds.has(transaction.reimbursesId)) {
      return `${label}: la spesa rimborsata non esiste.`;
    }
  }

  for (const name of ['budgets', 'recurring', 'reconciliations', 'importProfiles', 'importRules', 'holdings'] as const) {
    const rows = data[name] as { id?: unknown }[];
    if (!rows.every((row) => isNonEmptyString(row.id))) return `La tabella ${name} ha righe senza identificatore.`;
    const duplicate = firstDuplicate(rows.map((row) => row.id));
    if (duplicate !== undefined) return `La tabella ${name} ha righe duplicate.`;
  }
  if (!data.settings.every((row) => isNonEmptyString(row.key))) return 'Le impostazioni non sono valide.';
  if (firstDuplicate(data.settings.map((row) => row.key)) !== undefined) return 'Le impostazioni non sono valide.';

  return null;
}

export interface BackupSummary {
  accounts: number;
  categories: number;
  transactions: number;
  firstDate?: IsoDate;
  lastDate?: IsoDate;
}

export function summarizeData(data: Pick<BackupData, 'accounts' | 'categories' | 'transactions'>): BackupSummary {
  const sorted = [...data.transactions].sort(compareNewestFirst);
  return {
    accounts: data.accounts.length,
    categories: data.categories.length,
    transactions: data.transactions.length,
    firstDate: sorted[sorted.length - 1]?.date,
    lastDate: sorted[0]?.date,
  };
}
