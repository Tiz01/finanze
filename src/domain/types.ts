// Data in ora locale nel formato YYYY-MM-DD: mai timestamp UTC, altrimenti un movimento
// del 1° del mese a mezzanotte finirebbe nel mese precedente.
export type IsoDate = string;

export const ACCOUNT_TYPES = [
  'corrente',
  'contanti',
  'deposito',
  'carta_prepagata',
  'investimento',
  'altro',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  initialBalanceCents: number;
  initialBalanceDate: IsoDate;
  archived: boolean;
  contaComeLiquidita: boolean;
  createdAt: string;
}

export const TRANSACTION_TYPES = ['entrata', 'uscita', 'trasferimento', 'rettifica'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface Transaction {
  id: string;
  date: IsoDate;
  /** Sempre positivo, tranne per le rettifiche che hanno segno. */
  amountCents: number;
  type: TransactionType;
  /** Per i trasferimenti è il conto di partenza. */
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  note?: string;
  tags?: string[];
  recurringId?: string;
  importId?: string;
  /** Per un rimborso: la spesa originale. */
  reimbursesId?: string;
  createdAt: string;
}

export type TransactionDraft = Omit<Transaction, 'id' | 'createdAt'>;

export type CategoryKind = 'entrata' | 'uscita' | 'rettifica';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  /** Macro-categoria. */
  group: string;
  emoji: string;
  color: string;
  fissa: boolean;
  archived: boolean;
  /** Le categorie di sistema si possono rinominare ma non eliminare. */
  system: boolean;
  order: number;
}

export interface Budget {
  id: string;
  name: string;
  kind: 'tetto' | 'obiettivo';
  amountCents: number;
  categoryIds: string[];
}

export interface Recurring {
  id: string;
  name: string;
  template: TransactionDraft;
  frequency: 'mensile' | 'annuale' | 'personalizzata';
  intervalDays?: number;
  anchorDate: IsoDate;
  nextDue: IsoDate;
  active: boolean;
}

export interface Reconciliation {
  id: string;
  accountId: string;
  date: IsoDate;
  realBalanceCents: number;
  adjustmentId?: string;
}

export interface ImportProfile {
  id: string;
  name: string;
  mapping: Record<string, string>;
}

export interface ImportRule {
  id: string;
  contains: string;
  categoryId: string;
}

export interface Holding {
  id: string;
  accountId: string;
  instrument: string;
  isin: string;
  quantity: number;
  avgPriceCents: number;
}

export interface Setting {
  key: string;
  value: unknown;
}
