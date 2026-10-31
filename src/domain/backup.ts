import { defaultBudgets } from './budgets';
import { daysBetween, isValidIsoDate, toIsoDate } from './dates';
import { isQuoteSource } from './quotes';
import { validateRule } from './recurring';
import { mappingShapeProblem } from './statementMapping';
import { compareNewestFirst, validateTransaction } from './transactions';
import {
  ACCOUNT_TYPES,
  type Account,
  type Budget,
  type Category,
  type Holding,
  type HoldingSnapshot,
  type ImportProfile,
  type ImportRule,
  type IsoDate,
  type Recurring,
  type Reconciliation,
  type Setting,
  type Transaction,
} from './types';

/** Stessa versione dello schema Dexie: va aumentata insieme a ogni migrazione. */
export const SCHEMA_VERSION = 4;

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
  holdingSnapshots: HoldingSnapshot[];
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
  'holdingSnapshots',
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
const MIGRATIONS: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {
  // Nella versione 1 non si potevano creare buste: si parte da quelle iniziali.
  1(data) {
    const { budgets, categories } = data;
    if (Array.isArray(budgets) && budgets.length > 0) return data;
    const categoryIds = Array.isArray(categories)
      ? categories.filter(isRecord).map((category) => String(category.id))
      : [];
    return { ...data, budgets: defaultBudgets(new Set(categoryIds)) };
  },
};

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

function recurringProblem(recurring: Recurring, accountIds: Set<string>, categoryIds: Set<string>): string | null {
  if (!isNonEmptyString(recurring.name)) return 'manca il nome';
  if (!['mensile', 'annuale', 'personalizzata'].includes(recurring.frequency)) return 'la frequenza non è valida';
  if (!isValidIsoDate(recurring.anchorDate) || !isValidIsoDate(recurring.nextDue)) return 'le date non sono valide';
  if (typeof recurring.active !== 'boolean') return 'i campi sì/no non sono validi';
  if (!isRecord(recurring.template)) return 'manca il movimento da ripetere';
  const ruleProblem = validateRule(recurring);
  if (ruleProblem) return ruleProblem;
  const templateProblem = validateTransaction({ ...recurring.template, date: recurring.anchorDate });
  if (templateProblem) return templateProblem;
  const { accountId, toAccountId, categoryId } = recurring.template;
  if (!accountIds.has(accountId)) return 'il conto non esiste';
  if (toAccountId && !accountIds.has(toAccountId)) return 'il conto di destinazione non esiste';
  if (categoryId && !categoryIds.has(categoryId)) return 'la categoria non esiste';
  return null;
}

function budgetProblem(budget: Budget, accountIds: Set<string>, categoryIds: Set<string>): string | null {
  if (!isNonEmptyString(budget.name)) return 'manca il nome';
  if (budget.kind !== 'tetto' && budget.kind !== 'obiettivo') return 'il tipo non è valido';
  if (!Number.isSafeInteger(budget.amountCents) || budget.amountCents <= 0) return 'l’importo non è valido';
  if (!Array.isArray(budget.categoryIds)) return 'le categorie non sono valide';
  if (!budget.categoryIds.every((id) => categoryIds.has(id))) return 'una categoria non esiste';
  if (budget.accountId !== undefined && !accountIds.has(budget.accountId)) return 'il conto non esiste';
  if (typeof budget.order !== 'number') return 'l’ordine non è valido';
  return null;
}

function profileProblem(profile: ImportProfile, accountIds: Set<string>): string | null {
  if (!isNonEmptyString(profile.name)) return 'manca il nome';
  if (typeof profile.signature !== 'string') return 'le intestazioni non sono valide';
  if (profile.accountId !== undefined && !accountIds.has(profile.accountId)) return 'il conto non esiste';
  return mappingShapeProblem(profile.mapping);
}

function importRuleProblem(rule: ImportRule, accountIds: Set<string>, categoryIds: Set<string>): string | null {
  if (!isNonEmptyString(rule.contains)) return 'manca il testo da cercare';
  if (rule.transferAccountId === undefined) return categoryIds.has(rule.categoryId ?? '') ? null : 'la categoria non esiste';
  if (rule.categoryId !== undefined) return 'non può avere sia una categoria sia un conto';
  return accountIds.has(rule.transferAccountId) ? null : 'il conto non esiste';
}

function holdingProblem(holding: Holding, accountIds: Set<string>): string | null {
  if (!isNonEmptyString(holding.instrument)) return 'manca il nome';
  if (typeof holding.isin !== 'string') return 'l’ISIN non è valido';
  if (!accountIds.has(holding.accountId)) return 'il conto non esiste';
  if (holding.quoteSource !== undefined && !isQuoteSource(holding.quoteSource)) return 'la fonte dei prezzi non è valida';
  if (holding.historyFrom !== undefined && !isValidIsoDate(holding.historyFrom)) return 'la data dello storico non è valida';
  return isNonEmptyString(holding.createdAt) ? null : 'manca la data di inserimento';
}

function holdingSnapshotProblem(snapshot: HoldingSnapshot, holdingIds: Set<string>): string | null {
  if (!holdingIds.has(snapshot.holdingId)) return 'lo strumento non esiste';
  if (!isValidIsoDate(snapshot.date)) return 'la data non è valida';
  const { avgPriceMicros, priceMicros, quantityMicros } = snapshot;
  if ((quantityMicros === undefined) !== (avgPriceMicros === undefined)) return 'quote o prezzi non sono validi';
  const values = [priceMicros, quantityMicros ?? 0, avgPriceMicros ?? 0];
  return values.every((value) => Number.isSafeInteger(value) && value >= 0) ? null : 'quote o prezzi non sono validi';
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

  const movementIds = new Set(data.transactions.map((transaction) => transaction.id));
  for (const reconciliation of data.reconciliations) {
    const label = `Verifica del saldo del ${String(reconciliation.date)}`;
    if (!accountIds.has(reconciliation.accountId)) return `${label}: il conto non esiste.`;
    if (!isValidIsoDate(reconciliation.date)) return `${label}: la data non è valida.`;
    if (!Number.isSafeInteger(reconciliation.realBalanceCents)) return `${label}: il saldo non è in centesimi interi.`;
    if (reconciliation.adjustmentId && !movementIds.has(reconciliation.adjustmentId)) {
      return `${label}: la rettifica collegata non esiste.`;
    }
  }

  for (const budget of data.budgets) {
    const problem = budgetProblem(budget, accountIds, categoryIds);
    if (problem) return `Busta «${String(budget.name)}»: ${problem}.`;
  }

  for (const profile of data.importProfiles) {
    const problem = profileProblem(profile, accountIds);
    if (problem) return `Banca «${String(profile.name)}»: ${problem}.`;
  }

  for (const rule of data.importRules) {
    const problem = importRuleProblem(rule, accountIds, categoryIds);
    if (problem) return `Regola «${String(rule.contains)}»: ${problem}.`;
  }

  for (const holding of data.holdings) {
    const problem = holdingProblem(holding, accountIds);
    if (problem) return `Strumento «${String(holding.instrument)}»: ${problem}.`;
  }

  const holdingIds = new Set(data.holdings.map((holding) => holding.id));
  for (const snapshot of data.holdingSnapshots) {
    const problem = holdingSnapshotProblem(snapshot, holdingIds);
    if (problem) return `Aggiornamento del ${String(snapshot.date)} di uno strumento: ${problem}.`;
  }

  for (const recurring of data.recurring) {
    const label = `Ricorrenza «${String(recurring.name)}»`;
    const problem = recurringProblem(recurring, accountIds, categoryIds);
    if (problem) return `${label}: ${problem}.`;
  }

  for (const name of ['budgets', 'recurring', 'reconciliations', 'importProfiles', 'importRules', 'holdings', 'holdingSnapshots'] as const) {
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
  holdings: number;
  firstDate?: IsoDate;
  lastDate?: IsoDate;
}

export function summarizeData(data: Pick<BackupData, 'accounts' | 'categories' | 'transactions' | 'holdings'>): BackupSummary {
  const sorted = [...data.transactions].sort(compareNewestFirst);
  return {
    accounts: data.accounts.length,
    categories: data.categories.length,
    transactions: data.transactions.length,
    holdings: data.holdings.length,
    firstDate: sorted[sorted.length - 1]?.date,
    lastDate: sorted[0]?.date,
  };
}

export const BACKUP_REMINDER_DAYS = 14;

export type BackupReminder = { kind: 'never' } | { kind: 'old'; days: number };

/** Se e perché ricordare di fare un backup: mai finché non ci sono dati da perdere. */
export function backupReminder(
  lastBackupAt: string | undefined,
  hasData: boolean,
  today: IsoDate,
): BackupReminder | null {
  if (!hasData) return null;
  if (!lastBackupAt) return { kind: 'never' };
  const days = daysBetween(toIsoDate(new Date(lastBackupAt)), today);
  return days > BACKUP_REMINDER_DAYS ? { kind: 'old', days } : null;
}
