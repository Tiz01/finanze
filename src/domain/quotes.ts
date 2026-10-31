import { toIsoDate } from './dates';
import { MICROS } from './investments';
import type { IsoDate } from './types';

const MILAN = '_MIL';
const XETRA = '_GER';
// Una borsa preferita con un prezzo molto più vecchio degli altri non è più quella giusta da guardare.
const MAX_BEHIND_MS = 7 * 86_400_000;

export interface InstrumentMatch {
  /** Dove leggere il prezzo: `FUND/123`. */
  source: string;
  isin: string;
  name: string;
}

export interface Quote {
  priceMicros: number;
  date: IsoDate;
  market: string;
  /** Il numero di quello strumento su quella borsa: serve per chiederne lo storico. */
  notation: number | null;
}

export interface PricePoint {
  date: IsoDate;
  priceMicros: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeCode(text: string): string {
  return text.trim().toUpperCase();
}

export function isIsin(code: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(code);
}

/** Solo codici e ISIN: un nome scritto a parole non esce dal telefono. */
export function isSearchable(code: string): boolean {
  return /^[A-Z0-9.-]{2,12}$/.test(code);
}

export function isQuoteSource(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z_]+\/[A-Za-z0-9:_-]+$/.test(value);
}

/** Nei risultati di ricerca vale solo una corrispondenza esatta: il prezzo di uno strumento simile sarebbe sbagliato. */
export function findMatch(response: unknown, code: string): InstrumentMatch | null {
  if (!isRecord(response) || !Array.isArray(response.list)) return null;
  for (const item of response.list) {
    if (!isRecord(item) || item.type !== 'Instrument') continue;
    const { entityType, entityValue, isin, name, symbol } = item;
    const source = `${String(entityType)}/${String(entityValue)}`;
    if (!isQuoteSource(source) || typeof name !== 'string') continue;
    const sameIsin = typeof isin === 'string' && isin.toUpperCase() === code;
    const sameSymbol = typeof symbol === 'string' && symbol.toUpperCase() === code;
    if (sameIsin || sameSymbol) return { source, isin: typeof isin === 'string' ? isin : '', name };
  }
  return null;
}

/** Il prezzo in euro: prima Milano, dove è quotata la maggior parte degli ETF per chi investe dall'Italia, poi Xetra, poi il più recente. */
export function pickQuote(response: unknown): Quote | null {
  if (!isRecord(response) || !Array.isArray(response.list)) return null;
  const candidates = response.list.flatMap((item: unknown) => {
    if (!isRecord(item) || item.isoCurrency !== 'EUR' || !isRecord(item.market)) return [];
    const { datetimeLast, last, market } = item;
    const at = typeof datetimeLast === 'string' ? Date.parse(datetimeLast) : Number.NaN;
    if (typeof last !== 'number' || !Number.isFinite(last) || last <= 0 || Number.isNaN(at)) return [];
    return [{ code: market.codeMarket, name: String(market.name), notation: market.idNotation, last, at }];
  });
  const newest = Math.max(...candidates.map(({ at }) => at));
  const recentOn = (code: string) => candidates.find((quote) => quote.code === code && newest - quote.at <= MAX_BEHIND_MS);
  const chosen = recentOn(MILAN) ?? recentOn(XETRA) ?? candidates.find(({ at }) => at === newest);
  if (!chosen) return null;
  const priceMicros = Math.round(chosen.last * MICROS);
  if (!Number.isSafeInteger(priceMicros)) return null;
  const notation = typeof chosen.notation === 'number' ? chosen.notation : null;
  return { priceMicros, date: toIsoDate(new Date(chosen.at)), market: chosen.name, notation };
}

/** Le chiusure giorno per giorno. Il server le segna alle 12 UTC: il giorno giusto è quello in UTC, ovunque ci si trovi. */
export function parseHistory(response: unknown): PricePoint[] {
  if (!isRecord(response) || response.isoCurrency !== 'EUR') return [];
  const { datetimeLast, last } = response;
  if (!Array.isArray(datetimeLast) || !Array.isArray(last)) return [];
  return datetimeLast.flatMap((seconds: unknown, index) => {
    const close: unknown = last[index];
    if (typeof seconds !== 'number' || typeof close !== 'number' || !Number.isFinite(close) || close <= 0) return [];
    const moment = new Date(seconds * 1000);
    const priceMicros = Math.round(close * MICROS);
    if (Number.isNaN(moment.getTime()) || !Number.isSafeInteger(priceMicros)) return [];
    return [{ date: moment.toISOString().slice(0, 10), priceMicros }];
  });
}
