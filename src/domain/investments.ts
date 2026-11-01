import { thinOut } from './balances';
import { addDays, daysBetween } from './dates';
import { groupThousands } from './money';
import type { Account, Holding, HoldingSnapshot, IsoDate } from './types';

export const MICROS = 1_000_000;
const MAX_WHOLE_UNITS = 1_000_000_000;
const MAX_SERIES_POINTS = 400;

// Quote e prezzi sono in milionesimi: da milionesimi × milionesimi a centesimi si divide per 10¹⁰.
const MICROS_SQUARED_PER_CENT = 10_000_000_000n;

/**
 * Legge quote e prezzi scritti a mano o copiati dal broker: 12,5 · 10,356 · 1.234,56 · 168.39.
 * Restituisce i milionesimi, oppure null se non è un numero valido o ha più di 6 decimali.
 */
export function parseMicros(text: string): number | null {
  const value = text.replace(/[\s'€]/g, '');
  if (!/^[\d.,]*\d[\d.,]*$/.test(value)) return null;

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  let whole = value;
  let decimals = '';

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalIndex = Math.max(lastComma, lastDot);
    const thousands = lastComma > lastDot ? '.' : ',';
    whole = value.slice(0, decimalIndex);
    decimals = value.slice(decimalIndex + 1);
    if (!isGrouped(whole, thousands)) return null;
    whole = whole.split(thousands).join('');
  } else if (lastComma >= 0) {
    if (value.indexOf(',') !== lastComma) {
      if (!isGrouped(value, ',')) return null;
      whole = value.split(',').join('');
    } else {
      whole = value.slice(0, lastComma);
      decimals = value.slice(lastComma + 1);
    }
  } else if (lastDot >= 0) {
    // Come negli importi: 1.234 è milleduecentotrentaquattro, 168.39 ha i decimali.
    if (isGrouped(value, '.')) {
      whole = value.split('.').join('');
    } else {
      if (value.indexOf('.') !== lastDot) return null;
      whole = value.slice(0, lastDot);
      decimals = value.slice(lastDot + 1);
    }
  }

  if (decimals.length > 6 || !/^\d*$/.test(whole) || !/^\d*$/.test(decimals)) return null;
  const units = Number(whole || '0');
  if (units > MAX_WHOLE_UNITS) return null;
  return units * MICROS + Number(decimals.padEnd(6, '0') || '0');
}

function isGrouped(value: string, separator: string): boolean {
  const [first, ...rest] = value.split(separator);
  return rest.length > 0 && /^\d{1,3}$/.test(first ?? '') && rest.every((part) => /^\d{3}$/.test(part));
}

/** Senza gli zeri inutili: 12,5 · 10,356. `minDecimals` tiene i centesimi nei prezzi: 168,39 · 170,00. */
export function formatMicros(micros: number, minDecimals = 0): string {
  const whole = groupThousands(String(Math.trunc(micros / MICROS)));
  const fraction = String(micros % MICROS).padStart(6, '0').replace(/0+$/, '').padEnd(minDecimals, '0');
  return fraction ? `${whole},${fraction}` : whole;
}

/** Il controvalore in centesimi. BigInt perché il prodotto supera i numeri che JavaScript tiene esatti. */
export function positionValueCents(quantityMicros: number, priceMicros: number): number {
  const product = BigInt(quantityMicros) * BigInt(priceMicros);
  return Number((product + MICROS_SQUARED_PER_CENT / 2n) / MICROS_SQUARED_PER_CENT);
}

export function snapshotId(holdingId: string, date: IsoDate): string {
  return `${holdingId}|${date}`;
}

/** Gli aggiornamenti di ogni strumento, dal più vecchio al più recente. */
export function snapshotsByHolding(snapshots: HoldingSnapshot[]): Map<string, HoldingSnapshot[]> {
  const grouped = new Map<string, HoldingSnapshot[]>();
  for (const snapshot of snapshots) {
    const list = grouped.get(snapshot.holdingId);
    if (list) list.push(snapshot);
    else grouped.set(snapshot.holdingId, [snapshot]);
  }
  for (const list of grouped.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return grouped;
}

/** L'ultimo aggiornamento fino a quella data: dà il prezzo. */
export function snapshotAt(sorted: HoldingSnapshot[], date: IsoDate): HoldingSnapshot | undefined {
  return sorted.findLast((snapshot) => snapshot.date <= date);
}

type PositionSnapshot = HoldingSnapshot & { quantityMicros: number; avgPriceMicros: number };

export function hasPosition(snapshot: HoldingSnapshot): snapshot is PositionSnapshot {
  return snapshot.quantityMicros !== undefined && snapshot.avgPriceMicros !== undefined;
}

/** L'ultimo aggiornamento con le quote fino a quella data: dà quote e prezzo medio. */
export function positionAt(sorted: HoldingSnapshot[], date: IsoDate): PositionSnapshot | undefined {
  return sorted.findLast((snapshot): snapshot is PositionSnapshot => snapshot.date <= date && hasPosition(snapshot));
}

export interface HoldingSummary {
  holding: Holding;
  quantityMicros: number;
  avgPriceMicros: number;
  priceMicros: number;
  priceDate: IsoDate;
  valueCents: number;
  costCents: number;
  gainCents: number;
  /** Null se il costo è zero: senza un costo non c'è una percentuale. */
  gainRate: number | null;
}

function rate(gainCents: number, costCents: number): number | null {
  return costCents > 0 ? gainCents / costCents : null;
}

/** Com'è ogni strumento oggi. Uno strumento senza aggiornamenti fino a oggi non compare. */
export function summarizeHoldings(holdings: Holding[], snapshots: HoldingSnapshot[], today: IsoDate): HoldingSummary[] {
  const grouped = snapshotsByHolding(snapshots);
  return holdings.flatMap((holding) => {
    const list = grouped.get(holding.id) ?? [];
    const latest = snapshotAt(list, today);
    const position = positionAt(list, today);
    if (!latest || !position) return [];
    const { date, priceMicros } = latest;
    const { avgPriceMicros, quantityMicros } = position;
    const valueCents = positionValueCents(quantityMicros, priceMicros);
    const costCents = positionValueCents(quantityMicros, avgPriceMicros);
    const gainCents = valueCents - costCents;
    return [
      {
        holding,
        quantityMicros,
        avgPriceMicros,
        priceMicros,
        priceDate: date,
        valueCents,
        costCents,
        gainCents,
        gainRate: rate(gainCents, costCents),
      },
    ];
  });
}

export interface PortfolioTotals {
  valueCents: number;
  costCents: number;
  gainCents: number;
  gainRate: number | null;
  /** Il prezzo più vecchio: dice quanto è aggiornato il totale. Null se non ci sono strumenti. */
  oldestPriceDate: IsoDate | null;
}

export function portfolioTotals(summaries: HoldingSummary[]): PortfolioTotals {
  let valueCents = 0;
  let costCents = 0;
  let oldestPriceDate: IsoDate | null = null;
  for (const summary of summaries) {
    valueCents += summary.valueCents;
    costCents += summary.costCents;
    if (oldestPriceDate === null || summary.priceDate < oldestPriceDate) oldestPriceDate = summary.priceDate;
  }
  const gainCents = valueCents - costCents;
  return { valueCents, costCents, gainCents, gainRate: rate(gainCents, costCents), oldestPriceDate };
}

export interface AccountOverview {
  account: Account;
  holdings: HoldingSummary[];
  investedCents: number;
  /** Null se il conto ha degli strumenti ma la liquidità non è ancora stata indicata. */
  cashCents: number | null;
  totalCents: number;
}

/** Ogni conto investimento diviso tra soldi investiti e soldi non investiti. */
export function accountOverviews(
  accounts: Account[],
  summaries: HoldingSummary[],
  balances: Map<string, number>,
): AccountOverview[] {
  return accounts
    .filter(({ archived, type }) => type === 'investimento' && !archived)
    .map((account) => {
      const holdings = summaries.filter(({ holding }) => holding.accountId === account.id);
      const investedCents = portfolioTotals(holdings).valueCents;
      // Senza strumenti, i soldi registrati nel conto sono tutti non investiti.
      const cashCents = account.cashCents ?? (holdings.length === 0 ? (balances.get(account.id) ?? 0) : null);
      return { account, holdings, investedCents, cashCents, totalCents: investedCents + (cashCents ?? 0) };
    });
}

export interface OverviewTotals {
  investedCents: number;
  cashCents: number;
  totalCents: number;
  /** Quanti conti non hanno ancora la liquidità indicata: il totale non la comprende. */
  missingCash: number;
  /** La parte investita del totale, da 0 a 1. Null se non c'è niente da dividere. */
  investedShare: number | null;
}

export function overviewTotals(overviews: AccountOverview[]): OverviewTotals {
  let investedCents = 0;
  let cashCents = 0;
  let missingCash = 0;
  for (const overview of overviews) {
    investedCents += overview.investedCents;
    cashCents += overview.cashCents ?? 0;
    if (overview.cashCents === null) missingCash += 1;
  }
  const parts = investedCents + Math.max(cashCents, 0);
  return {
    investedCents,
    cashCents,
    totalCents: investedCents + cashCents,
    missingCash,
    investedShare: parts > 0 ? investedCents / parts : null,
  };
}

/** Gli strumenti dei conti investimento in uso: quelli dei conti archiviati restano da parte. */
export function activeHoldings(holdings: Holding[], accounts: Account[]): Holding[] {
  const active = new Set(accounts.filter(({ archived, type }) => type === 'investimento' && !archived).map(({ id }) => id));
  return holdings.filter((holding) => active.has(holding.accountId));
}

export interface InvestmentPoint {
  date: IsoDate;
  cents: number;
  baselineCents: number;
}

/**
 * Valore e costo di acquisto giorno per giorno, dal primo aggiornamento a oggi.
 * Tra un aggiornamento e l'altro vale l'ultimo noto: sono i soli numeri che l'app ha davvero.
 */
export function investmentSeries(holdings: Holding[], snapshots: HoldingSnapshot[], today: IsoDate): InvestmentPoint[] {
  const ids = new Set(holdings.map(({ id }) => id));
  const lists = [...snapshotsByHolding(snapshots.filter(({ holdingId, date }) => ids.has(holdingId) && date <= today)).values()];
  const firstDates = lists.flatMap((list) => list.find(hasPosition)?.date ?? []);
  if (firstDates.length === 0) return [];
  const start = firstDates.reduce((first, date) => (date < first ? date : first));

  // Una riga per giorno di borsa, anche per anni: un cursore per strumento evita di ripartire ogni giorno da capo.
  const cursors = lists.map((list) => ({
    list,
    next: 0,
    priceMicros: null as number | null,
    position: null as ReturnType<typeof positionAt> | null,
  }));

  const points: InvestmentPoint[] = [];
  for (let date = start; date <= today; date = addDays(date, 1)) {
    let cents = 0;
    let baselineCents = 0;
    for (const cursor of cursors) {
      for (let row = cursor.list[cursor.next]; row && row.date <= date; row = cursor.list[cursor.next]) {
        cursor.priceMicros = row.priceMicros;
        if (hasPosition(row)) cursor.position = row;
        cursor.next += 1;
      }
      if (!cursor.position || cursor.priceMicros === null) continue;
      cents += positionValueCents(cursor.position.quantityMicros, cursor.priceMicros);
      baselineCents += positionValueCents(cursor.position.quantityMicros, cursor.position.avgPriceMicros);
    }
    points.push({ date, cents, baselineCents });
  }
  return thinOut(points, MAX_SERIES_POINTS);
}

/** Il prezzo automatico c'è, ma mancano le chiusure dal primo acquisto in poi. */
export function isHistoryMissing(holding: Holding, sorted: HoldingSnapshot[], today: IsoDate): boolean {
  const first = sorted.find(hasPosition)?.date;
  if (!holding.quoteSource || !first || first >= today) return false;
  return holding.historyFrom === undefined || first < holding.historyFrom;
}

export interface HistoryRequest {
  /** Da questo giorno in poi servono le chiusure. */
  from: IsoDate;
  /** Tutta la storia dello strumento, oppure solo i giorni da `from` in poi. */
  whole: boolean;
}

/** Quali chiusure passate servono: la storia dal primo acquisto, o i giorni in cui l'app è rimasta chiusa. */
export function historyNeeded(
  holding: Holding,
  sorted: HoldingSnapshot[],
  lastPriceDate: IsoDate,
  today: IsoDate,
): HistoryRequest | null {
  const first = sorted.find(hasPosition)?.date;
  const latest = sorted.at(-1)?.date;
  if (!holding.quoteSource || !first || !latest) return null;
  if (isHistoryMissing(holding, sorted, today)) return { from: first, whole: true };
  return daysBetween(latest, lastPriceDate) > 1 ? { from: latest, whole: false } : null;
}

export function priceAgeLabel(priceDate: IsoDate, today: IsoDate): string {
  const days = daysBetween(priceDate, today);
  if (days <= 0) return 'prezzi di oggi';
  if (days === 1) return 'prezzi di ieri';
  return `prezzi di ${days} giorni fa`;
}
