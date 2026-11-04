import { balanceEffects } from './balances';
import { CATEGORY_IDS } from './categories';
import { addMonths, daysBetween, formatFullDate, isValidIsoDate } from './dates';
import { formatMicros, MICROS, parseMicros } from './investments';
import type { Account, InterestRateKind, InterestTerms, IsoDate, Transaction } from './types';

const HUNDRED_PERCENT = 100 * MICROS;
export const DEFAULT_TAX_PERCENT = 26 * MICROS;
export const MAX_INTERVAL_MONTHS = 12;
const MAX_TERM_MONTHS = 600;
// Senza una scadenza, la stima guarda ai prossimi dodici mesi.
const OPEN_ENDED_MONTHS = 12;
// Anno civile: le banche dividono i «numeri» (saldo × giorni) per 365.
const YEAR_PERCENT_MICROS = 365n * 100n * BigInt(MICROS);

export function interestTermsProblem(terms: InterestTerms): string | null {
  const { creditedThrough, intervalMonths, rateKind, ratePercentMicros, startDate, taxPercentMicros, termMonths } = terms;
  if (!Number.isSafeInteger(ratePercentMicros) || ratePercentMicros <= 0 || ratePercentMicros > HUNDRED_PERCENT) {
    return 'Scrivi il tasso come numero, per esempio 4';
  }
  if (rateKind !== 'lordo' && rateKind !== 'netto') return 'Scegli se il tasso è lordo o netto';
  if (!Number.isSafeInteger(taxPercentMicros) || taxPercentMicros < 0 || taxPercentMicros >= HUNDRED_PERCENT) {
    return 'Scrivi la ritenuta come numero, per esempio 26';
  }
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > MAX_INTERVAL_MONTHS) {
    return 'Scegli ogni quanti mesi arrivano gli interessi';
  }
  if (!isValidIsoDate(startDate)) return 'La data di inizio non è valida';
  if (termMonths !== null && (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > MAX_TERM_MONTHS)) {
    return 'Scrivi la durata in mesi, per esempio 12';
  }
  if (creditedThrough !== undefined && !isValidIsoDate(creditedThrough)) return 'La data dell’ultimo accredito non è valida';
  return null;
}

export interface InterestFormValues {
  rateText: string;
  rateKind: InterestRateKind;
  taxText: string;
  intervalMonths: number;
  startDate: IsoDate;
  termText: string;
}

export function interestFormValues(terms: InterestTerms | undefined, defaultStart: IsoDate): InterestFormValues {
  return {
    rateText: terms ? formatMicros(terms.ratePercentMicros) : '',
    rateKind: terms?.rateKind ?? 'lordo',
    taxText: formatMicros(terms?.taxPercentMicros ?? DEFAULT_TAX_PERCENT),
    intervalMonths: terms?.intervalMonths ?? 1,
    startDate: terms?.startDate ?? defaultStart,
    termText: terms?.termMonths ? String(terms.termMonths) : '',
  };
}

export type ParsedInterestForm = { terms: InterestTerms; error?: undefined } | { terms?: undefined; error: string };

export function parseInterestForm(values: InterestFormValues): ParsedInterestForm {
  const term = values.termText.trim();
  if (term !== '' && !/^\d+$/.test(term)) return { error: 'Scrivi la durata in mesi, per esempio 12' };
  const terms: InterestTerms = {
    ratePercentMicros: parseMicros(values.rateText.replace('%', '')) ?? 0,
    rateKind: values.rateKind,
    // Un tasso netto è già al netto: la ritenuta non entra nei calcoli e non deve bloccare il modulo.
    taxPercentMicros: values.rateKind === 'netto' ? DEFAULT_TAX_PERCENT : (parseMicros(values.taxText.replace('%', '')) ?? -1),
    intervalMonths: values.intervalMonths,
    startDate: values.startDate,
    termMonths: term === '' ? null : Number(term),
  };
  const error = interestTermsProblem(terms);
  return error ? { error } : { terms };
}

export function interestEndDate({ startDate, termMonths }: InterestTerms): IsoDate | null {
  return termMonths === null ? null : addMonths(startDate, termMonths);
}

/** «4% lordo · ogni mese · fino al 1 mag 2027». */
export function interestTermsLabel(terms: InterestTerms): string {
  const rate = `${formatMicros(terms.ratePercentMicros)}% ${terms.rateKind}`;
  const interval = terms.intervalMonths === 1 ? 'ogni mese' : `ogni ${terms.intervalMonths} mesi`;
  const end = interestEndDate(terms);
  return [rate, interval, ...(end ? [`fino al ${formatFullDate(end)}`] : [])].join(' · ');
}

/** Il primo accredito dopo quella data. Le date si calcolano dall'inizio, così un 31 non scivola al 28 per sempre. */
function nextCreditDate(terms: InterestTerms, after: IsoDate): IsoDate | null {
  const end = interestEndDate(terms);
  if (end !== null && after >= end) return null;
  for (let step = 1; ; step += 1) {
    const date = addMonths(terms.startDate, step * terms.intervalMonths);
    if (end !== null && date >= end) return end;
    if (date > after) return date;
  }
}

interface Ledger {
  start: IsoDate;
  startCents: number;
  /** Le variazioni del saldo, dalla più vecchia. */
  deltas: { date: IsoDate; cents: number }[];
}

function ledgerOf(account: Account, transactions: Transaction[]): Ledger {
  const deltas = transactions.flatMap((transaction) =>
    balanceEffects(transaction).flatMap(([accountId, cents]) =>
      accountId === account.id && transaction.date >= account.initialBalanceDate ? [{ date: transaction.date, cents }] : [],
    ),
  );
  deltas.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { start: account.initialBalanceDate, startCents: account.initialBalanceCents, deltas };
}

function ledgerBalanceAt({ deltas, startCents }: Ledger, date: IsoDate): number {
  return deltas.reduce((balance, delta) => (delta.date <= date ? balance + delta.cents : balance), startCents);
}

/**
 * I «numeri»: la somma del saldo di fine giornata per ogni giorno da `from` compreso a `to` escluso.
 * Prima del saldo iniziale il saldo non si conosce, e un saldo negativo non rende niente.
 */
function balanceDays(ledger: Ledger, from: IsoDate, to: IsoDate, extraCents: number): number {
  const begin = from < ledger.start ? ledger.start : from;
  if (begin >= to) return 0;

  let balance = ledger.startCents + extraCents;
  let index = 0;
  const applyUntil = (date: IsoDate) => {
    for (let delta = ledger.deltas[index]; delta && delta.date <= date; delta = ledger.deltas[index]) {
      balance += delta.cents;
      index += 1;
    }
  };
  applyUntil(begin);

  let total = 0;
  for (let cursor = begin; cursor < to; ) {
    const change = ledger.deltas[index]?.date;
    const segmentEnd = change !== undefined && change < to ? change : to;
    total += Math.max(balance, 0) * daysBetween(cursor, segmentEnd);
    cursor = segmentEnd;
    applyUntil(cursor);
  }
  return total;
}

export interface InterestAmounts {
  grossCents: number;
  taxCents: number;
  netCents: number;
}

function roundedDivide(value: bigint, divisor: bigint): number {
  return Number((value + divisor / 2n) / divisor);
}

function amountsFor(terms: InterestTerms, days: number): InterestAmounts {
  const grossCents = roundedDivide(BigInt(days) * BigInt(terms.ratePercentMicros), YEAR_PERCENT_MICROS);
  const taxCents = terms.rateKind === 'netto' ? 0 : roundedDivide(BigInt(grossCents) * BigInt(terms.taxPercentMicros), BigInt(HUNDRED_PERCENT));
  return { grossCents, taxCents, netCents: grossCents - taxCents };
}

export interface InterestCredit extends InterestAmounts {
  date: IsoDate;
  periodStart: IsoDate;
}

function firstOpenDate({ creditedThrough, startDate }: InterestTerms): IsoDate {
  return creditedThrough !== undefined && creditedThrough > startDate ? creditedThrough : startDate;
}

/**
 * Gli accrediti fino a `until`. Quelli non ancora registrati contano come arrivati, altrimenti
 * il periodo dopo uscirebbe più basso del vero.
 */
function walkCredits(ledger: Ledger, terms: InterestTerms, until: IsoDate) {
  const credits: InterestCredit[] = [];
  let from = firstOpenDate(terms);
  let extraCents = 0;
  for (let date = nextCreditDate(terms, from); date !== null && date <= until; date = nextCreditDate(terms, from)) {
    const amounts = amountsFor(terms, balanceDays(ledger, from, date, extraCents));
    credits.push({ ...amounts, date, periodStart: from });
    extraCents += amounts.netCents;
    from = date;
  }
  return { credits, from, extraCents };
}

export interface InterestProjection {
  date: IsoDate;
  balanceCents: number;
  interestNetCents: number;
}

export interface InterestStatus {
  /** Gli accrediti già scaduti e non ancora registrati, dal più vecchio. Uno a zero non chiede niente. */
  pending: InterestCredit[];
  /** Netti maturati nel periodo in corso, fino a ieri. */
  accruedNetCents: number;
  next: InterestCredit | null;
  endDate: IsoDate | null;
  finished: boolean;
  /** Alla scadenza, o tra dodici mesi: null se il periodo è finito. */
  projection: InterestProjection | null;
}

export function interestStatus(account: Account, transactions: Transaction[], today: IsoDate): InterestStatus | null {
  const terms = account.interest;
  if (!terms) return null;

  const ledger = ledgerOf(account, transactions);
  const { credits, extraCents, from } = walkCredits(ledger, terms, today);
  const nextDate = nextCreditDate(terms, from);
  const endDate = interestEndDate(terms);
  const finished = endDate !== null && today >= endDate;

  let next: InterestCredit | null = null;
  let accruedNetCents = 0;
  if (nextDate !== null) {
    next = { ...amountsFor(terms, balanceDays(ledger, from, nextDate, extraCents)), date: nextDate, periodStart: from };
    accruedNetCents = amountsFor(terms, balanceDays(ledger, from, today, extraCents)).netCents;
  }

  let projection: InterestProjection | null = null;
  if (!finished) {
    const date = endDate ?? addMonths(today, OPEN_ENDED_MONTHS);
    const interestNetCents = walkCredits(ledger, terms, date).credits.reduce((sum, { netCents }) => sum + netCents, 0);
    projection = { date, interestNetCents, balanceCents: ledgerBalanceAt(ledger, date) + interestNetCents };
  }

  return { pending: credits.filter(({ netCents }) => netCents > 0), accruedNetCents, next, endDate, finished, projection };
}

export interface InterestPreview extends InterestAmounts {
  months: number;
  finalCents: number;
}

/** Cosa succede con questa somma, se non si muove niente. */
export function previewInterest(terms: InterestTerms, cents: number): InterestPreview {
  // Si riparte dall'inizio anche se il conto ha già degli accrediti registrati.
  const { creditedThrough: _ignored, ...fresh } = terms;
  const months = terms.termMonths ?? OPEN_ENDED_MONTHS;
  const ledger: Ledger = { start: terms.startDate, startCents: cents, deltas: [] };
  const { credits, extraCents } = walkCredits(ledger, fresh, addMonths(terms.startDate, months));
  const sum = (key: keyof InterestAmounts) => credits.reduce((total, credit) => total + credit[key], 0);
  return { months, grossCents: sum('grossCents'), taxCents: sum('taxCents'), netCents: sum('netCents'), finalCents: cents + extraCents };
}

export function isInterestMovement({ categoryId, type }: Transaction): boolean {
  return type === 'entrata' && categoryId === CATEGORY_IDS.interessi;
}

export interface InterestOverview {
  account: Account;
  status: InterestStatus;
  balanceCents: number;
  receivedCents: number;
  /** I soldi versati: il saldo senza gli interessi ricevuti. */
  capitalCents: number;
}

/** I conti remunerati in uso. */
export function interestOverviews(
  accounts: Account[],
  transactions: Transaction[],
  balances: Map<string, number>,
  today: IsoDate,
): InterestOverview[] {
  return accounts.flatMap((account) => {
    if (account.type !== 'remunerato' || account.archived) return [];
    const status = interestStatus(account, transactions, today);
    if (!status) return [];
    const balanceCents = balances.get(account.id) ?? 0;
    const receivedCents = transactions.reduce(
      (sum, transaction) => (transaction.accountId === account.id && isInterestMovement(transaction) ? sum + transaction.amountCents : sum),
      0,
    );
    return [{ account, status, balanceCents, receivedCents, capitalCents: balanceCents - receivedCents }];
  });
}
