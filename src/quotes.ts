import { useEffect, useState, useSyncExternalStore } from 'react';
import { linkHolding, recordHistory, recordQuotes, type QuoteUpdate } from './db/investments';
import { historyNeeded, isHistoryMissing, snapshotsByHolding, type HistoryRequest } from './domain/investments';
import {
  findMatch,
  isSearchable,
  normalizeCode,
  parseHistory,
  pickQuote,
  type InstrumentMatch,
  type PricePoint,
  type Quote,
} from './domain/quotes';
import type { Holding, HoldingSnapshot, IsoDate } from './domain/types';

// L'unica connessione esterna dell'app, permessa dalla Content Security Policy in vite.config.ts.
// Riceve solo il codice dello strumento: quote e importi restano sul telefono.
const API = 'https://api.onvista.de/api/v1';
const TIMEOUT_MS = 10_000;
const REFRESH_MS = 10 * 60_000;
const RETRY_MS = 60_000;
const LOOKUP_DELAY_MS = 500;
// Prima di qualsiasi strumento: si chiede sempre tutta la storia, così la data di acquisto non esce dal telefono.
const WHOLE_HISTORY_START = '2000-01-01';

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${API}/${path}`, {
    // Chiede sempre conferma al server: altrimenti il prezzo potrebbe restare in cache per un'ora.
    cache: 'no-cache',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Risposta ${response.status}`);
  return response.json();
}

export async function findInstrument(code: string): Promise<InstrumentMatch | null> {
  return findMatch(await getJson(`instruments/query?perType=5&searchValue=${encodeURIComponent(code)}`), code);
}

export async function fetchQuote(source: string): Promise<Quote | null> {
  return pickQuote(await getJson(`instruments/${source}/quotes`));
}

export async function fetchHistory(source: string, notation: number, { from, whole }: HistoryRequest): Promise<PricePoint[]> {
  const window = whole ? `range=MAX&startDate=${WHOLE_HISTORY_START}` : `range=Y1&startDate=${from}`;
  return parseHistory(await getJson(`instruments/${source}/eod_history?idNotation=${notation}&${window}`));
}

export type InstrumentLookup =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; match: InstrumentMatch; quote: Quote }
  | { status: 'notFound' }
  | { status: 'failed' };

/** Cerca lo strumento mentre lo si scrive, con un attimo di attesa per non fare una ricerca a ogni lettera. */
export function useInstrumentLookup(code: string): InstrumentLookup {
  const [result, setResult] = useState<{ code: string; lookup: InstrumentLookup } | null>(null);
  const searchable = isSearchable(code);

  useEffect(() => {
    if (!searchable) return;
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        let lookup: InstrumentLookup = { status: 'notFound' };
        try {
          const match = await findInstrument(code);
          const quote = match && (await fetchQuote(match.source));
          if (match && quote) lookup = { status: 'found', match, quote };
        } catch {
          lookup = { status: 'failed' };
        }
        if (!stale) setResult({ code, lookup });
      })();
    }, LOOKUP_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [code, searchable]);

  if (!searchable) return { status: 'idle' };
  return result?.code === code ? result.lookup : { status: 'searching' };
}

export type PriceSyncState = 'idle' | 'ok' | 'failed';

let state: PriceSyncState = 'idle';
let running = false;
let lastKey = '';
let lastAt = 0;
const triedCodes = new Set<string>();
const listeners = new Set<() => void>();

function setState(next: PriceSyncState) {
  state = next;
  for (const listener of listeners) listener();
}

export function currentPriceSyncState(): PriceSyncState {
  return state;
}

export function usePriceSyncState(): PriceSyncState {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, currentPriceSyncState);
}

function syncKey(holdings: Holding[]): string {
  return holdings.map(({ id, quoteSource }) => `${id}:${quoteSource ?? ''}`).join();
}

/** Collega al prezzo automatico gli strumenti che non lo hanno ancora, una sola prova per apertura dell'app. */
async function linkMissing(holdings: Holding[]): Promise<{ holdings: Holding[]; failed: boolean }> {
  let failed = false;
  const linked = await Promise.all(
    holdings.map(async (holding) => {
      const code = normalizeCode(holding.isin || holding.instrument);
      if (holding.quoteSource || !isSearchable(code) || triedCodes.has(code)) return holding;
      triedCodes.add(code);
      try {
        const match = await findInstrument(code);
        if (!match) return holding;
        await linkHolding(holding.id, match);
        return { ...holding, quoteSource: match.source };
      } catch {
        triedCodes.delete(code);
        failed = true;
        return holding;
      }
    }),
  );
  return { holdings: linked, failed };
}

/** Legge il prezzo di uno strumento e, se mancano, le chiusure passate. */
async function readPrices(holding: Holding, rows: HoldingSnapshot[], today: IsoDate) {
  const source = holding.quoteSource ?? '';
  const quote = await fetchQuote(source);
  const request = historyNeeded(holding, rows, quote?.date ?? today, today);
  // Senza un prezzo in euro non c'è storia da leggere: resta segnato come fatto, per non riprovare a ogni giro.
  const points = request && quote?.notation ? await fetchHistory(source, quote.notation, request) : [];
  return { holdingId: holding.id, quote, history: request ? { from: request.from, points } : null };
}

/** Aggiorna i prezzi degli strumenti collegati. Non fa niente se l'ha già fatto da poco. */
export async function syncPrices(holdings: Holding[], snapshots: HoldingSnapshot[], today: IsoDate): Promise<void> {
  const grouped = snapshotsByHolding(snapshots);
  const wait = state === 'failed' ? RETRY_MS : REFRESH_MS;
  const upToDate = syncKey(holdings) === lastKey && Date.now() - lastAt < wait;
  // Una data di acquisto appena indicata non aspetta il giro successivo, a meno che l'ultimo non sia fallito.
  const missing = state !== 'failed' && holdings.some((holding) => isHistoryMissing(holding, grouped.get(holding.id) ?? [], today));
  if (running || holdings.length === 0 || (upToDate && !missing)) return;

  running = true;
  try {
    const { holdings: current, failed: linkFailed } = await linkMissing(holdings);
    lastKey = syncKey(current);
    lastAt = Date.now();

    const linked = current.filter(({ quoteSource }) => quoteSource);
    if (linked.length === 0 && !linkFailed) return;

    const results = await Promise.allSettled(linked.map((holding) => readPrices(holding, grouped.get(holding.id) ?? [], today)));
    const quotes: QuoteUpdate[] = [];
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { history, holdingId, quote } = result.value;
      if (history) await recordHistory(holdingId, history.points, history.from, today);
      if (quote) quotes.push({ holdingId, date: quote.date, priceMicros: quote.priceMicros });
    }
    await recordQuotes(quotes, today);
    setState(linkFailed || results.some(({ status }) => status === 'rejected') ? 'failed' : 'ok');
  } catch {
    setState('failed');
  } finally {
    running = false;
  }
}

/** Per i test: lo stato vive per tutta l'apertura dell'app. */
export function resetPriceSync(): void {
  state = 'idle';
  running = false;
  lastKey = '';
  lastAt = 0;
  triedCodes.clear();
}
