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
  /** Solo per un tetto senza conto: le categorie da sommare. */
  categoryIds: string[];
  /**
   * Un tetto conta le uscite pagate da questo conto, qualunque sia la categoria.
   * Un obiettivo conta i trasferimenti verso questo conto; senza, quelli verso i conti investimento.
   */
  accountId?: string;
  order: number;
}

export type RecurringTemplate = Pick<
  TransactionDraft,
  'type' | 'amountCents' | 'accountId' | 'toAccountId' | 'categoryId'
>;

export const RECURRING_UNITS = ['giorni', 'settimane', 'mesi'] as const;
export type RecurringUnit = (typeof RECURRING_UNITS)[number];

export interface RecurringRule {
  frequency: 'mensile' | 'annuale' | 'personalizzata';
  /** Solo per la frequenza personalizzata: ogni quante unità. */
  interval?: number;
  intervalUnit?: RecurringUnit;
  /** La prima scadenza: da qui si calcolano tutte le altre. */
  anchorDate: IsoDate;
}

export interface Recurring extends RecurringRule {
  id: string;
  name: string;
  template: RecurringTemplate;
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

/** Come leggere le date ambigue: 03/04 è il 3 aprile (gma) o il 4 marzo (mga). */
export type DateOrder = 'gma' | 'mga';

/** Le colonne sono null finché non sono state scelte. */
export type AmountMapping =
  /** Una colonna con il segno; `invert` per i file in cui le spese sono positive. */
  | { mode: 'segno'; column: number | null; invert: boolean }
  | { mode: 'due-colonne'; incomeColumn: number | null; expenseColumn: number | null }
  /** Importo senza segno più una colonna che dice la direzione, per esempio Dare/Avere. */
  | { mode: 'tipo'; column: number | null; typeColumn: number | null; incomeValue: string };

export interface ImportMapping {
  /** La riga con le intestazioni, contando da 0; null se il file non ne ha. */
  headerRow: number | null;
  dateColumn: number | null;
  dateOrder: DateOrder;
  descriptionColumn: number | null;
  /** Una seconda colonna da aggiungere alla descrizione. */
  detailsColumn: number | null;
  amount: AmountMapping;
}

export interface ImportProfile {
  id: string;
  name: string;
  /** Le intestazioni del file: servono a riconoscere la banca la volta dopo. */
  signature: string;
  mapping: ImportMapping;
  /** L'ultimo conto su cui si è importato con questa mappatura. */
  accountId?: string;
}

export interface ImportRule {
  id: string;
  contains: string;
  /** Cosa diventa la riga: un movimento di questa categoria… */
  categoryId?: string;
  /** …oppure un trasferimento con questo conto, verso o da a seconda del segno dell'importo. */
  transferAccountId?: string;
}

export interface Holding {
  id: string;
  accountId: string;
  /** Il nome o il codice dello strumento, come lo mostra il broker. */
  instrument: string;
  /** Facoltativo: vuoto se non indicato. */
  isin: string;
  createdAt: string;
  /** Dove leggere il prezzo in automatico. Se manca, il prezzo lo scrive la persona. */
  quoteSource?: string;
  /** Da che giorno sono già state lette le chiusure passate. */
  historyFrom?: IsoDate;
}

/**
 * Lo strumento a una certa data, con i numeri che mostra il broker: l'ultimo è la situazione di oggi.
 * In milionesimi interi: quote e prezzi hanno più decimali dei centesimi, e i float sbaglierebbero i conti.
 */
export interface HoldingSnapshot {
  /** `strumento|data`: un solo aggiornamento al giorno per strumento. */
  id: string;
  holdingId: string;
  date: IsoDate;
  /** Assenti se cambia solo il prezzo: valgono quelli dell'ultimo aggiornamento che li ha. */
  quantityMicros?: number;
  /** Prezzo medio di carico, per quota. */
  avgPriceMicros?: number;
  /** Prezzo di mercato a quella data, per quota. */
  priceMicros: number;
}

export interface Setting {
  key: string;
  value: unknown;
}
