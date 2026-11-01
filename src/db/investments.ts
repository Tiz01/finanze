import { isValidIsoDate } from '../domain/dates';
import { hasPosition, snapshotId, snapshotsByHolding } from '../domain/investments';
import type { InstrumentMatch, PricePoint } from '../domain/quotes';
import type { Holding, HoldingSnapshot, IsoDate } from '../domain/types';
import { db } from './db';
import type { Undo } from './transactions';

export interface HoldingDraft {
  accountId: string;
  instrument: string;
  isin: string;
  quoteSource?: string;
}

export interface PositionDraft {
  date: IsoDate;
  quantityMicros: number;
  avgPriceMicros: number;
  priceMicros: number;
}

function prepareHolding(draft: HoldingDraft): HoldingDraft {
  const instrument = draft.instrument.trim();
  if (!instrument) throw new Error('Scrivi il nome dello strumento');
  if (!draft.accountId) throw new Error('Scegli il conto');
  const { accountId, quoteSource } = draft;
  return { accountId, instrument, isin: draft.isin.trim().toUpperCase(), ...(quoteSource ? { quoteSource } : {}) };
}

function isMicros(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkPosition(position: PositionDraft, today: IsoDate): void {
  if (!isValidIsoDate(position.date)) throw new Error('Data non valida');
  if (position.date > today) throw new Error('La data non può essere futura');
  if (!isMicros(position.quantityMicros)) throw new Error('Quote non valide');
  if (!isMicros(position.avgPriceMicros)) throw new Error('Prezzo di acquisto non valido');
  if (!isMicros(position.priceMicros) || position.priceMicros === 0) throw new Error('Prezzo attuale non valido');
}

async function assertInvestmentAccount(accountId: string): Promise<void> {
  const account = await db.accounts.get(accountId);
  if (account?.type !== 'investimento') throw new Error('Scegli un conto di tipo Investimento');
}

function snapshotOf(holdingId: string, position: PositionDraft): HoldingSnapshot {
  return { ...position, id: snapshotId(holdingId, position.date), holdingId };
}

export async function createHolding(draft: HoldingDraft, position: PositionDraft, today: IsoDate): Promise<string> {
  const prepared = prepareHolding(draft);
  checkPosition(position, today);
  if (position.quantityMicros === 0) throw new Error('Scrivi quante quote hai');
  const id = crypto.randomUUID();
  await db.transaction('rw', db.accounts, db.holdings, db.holdingSnapshots, async () => {
    await assertInvestmentAccount(prepared.accountId);
    await db.holdings.add({ ...prepared, id, createdAt: new Date().toISOString() });
    await db.holdingSnapshots.add(snapshotOf(id, position));
  });
  return id;
}

/** `position` è null se sono cambiati solo nome, ISIN o conto: non è un nuovo aggiornamento. */
export async function updateHolding(
  id: string,
  draft: HoldingDraft,
  position: PositionDraft | null,
  today: IsoDate,
): Promise<void> {
  const prepared = prepareHolding(draft);
  if (position) checkPosition(position, today);
  await db.transaction('rw', db.accounts, db.holdings, db.holdingSnapshots, async () => {
    const previous = await db.holdings.get(id);
    if (!previous) throw new Error('Lo strumento non esiste più');
    await assertInvestmentAccount(prepared.accountId);
    // Senza una fonte il prezzo torna a mano: quella vecchia non deve restare.
    // Con una fonte nuova lo storico letto finora è di un altro strumento: va riletto.
    const { historyFrom, quoteSource: previousSource, ...rest } = previous;
    const keepHistory = historyFrom !== undefined && prepared.quoteSource === previousSource;
    await db.holdings.put({ ...rest, ...prepared, ...(keepHistory ? { historyFrom } : {}) });
    if (position) await db.holdingSnapshots.put(snapshotOf(id, position));
  });
}

export async function deleteHolding(id: string): Promise<Undo> {
  return db.transaction('rw', db.holdings, db.holdingSnapshots, async () => {
    const holding: Holding | undefined = await db.holdings.get(id);
    if (!holding) throw new Error('Lo strumento non esiste più');
    const snapshots = await db.holdingSnapshots.where('holdingId').equals(id).toArray();
    await db.holdings.delete(id);
    await db.holdingSnapshots.where('holdingId').equals(id).delete();
    return () =>
      db.transaction('rw', db.holdings, db.holdingSnapshots, async () => {
        await db.holdings.add(holding);
        await db.holdingSnapshots.bulkAdd(snapshots);
      });
  });
}

export interface PriceUpdate {
  holdingId: string;
  priceMicros: number;
}

/** Un solo aggiornamento al giorno per strumento: rifarlo lo corregge, senza toccare quote e prezzo medio. */
export async function recordPrices(date: IsoDate, updates: PriceUpdate[], today: IsoDate): Promise<Undo> {
  if (!isValidIsoDate(date)) throw new Error('Data non valida');
  if (date > today) throw new Error('La data non può essere futura');
  for (const { priceMicros } of updates) {
    if (!isMicros(priceMicros) || priceMicros === 0) throw new Error('Prezzo non valido');
  }
  return db.transaction('rw', db.holdingSnapshots, async () => {
    const grouped = snapshotsByHolding(await db.holdingSnapshots.toArray());
    const ids = updates.map(({ holdingId }) => snapshotId(holdingId, date));
    const replaced = (await db.holdingSnapshots.bulkGet(ids)).flatMap((snapshot) => (snapshot ? [snapshot] : []));
    await db.holdingSnapshots.bulkPut(
      updates.map(({ holdingId, priceMicros }) => {
        const list = grouped.get(holdingId) ?? [];
        if (list.length === 0) throw new Error('Lo strumento non esiste più');
        const sameDay = list.find((snapshot) => snapshot.date === date);
        return sameDay ? { ...sameDay, priceMicros } : { id: snapshotId(holdingId, date), holdingId, date, priceMicros };
      }),
    );
    return () =>
      db.transaction('rw', db.holdingSnapshots, async () => {
        await db.holdingSnapshots.bulkDelete(ids);
        await db.holdingSnapshots.bulkAdd(replaced);
      });
  });
}

export interface QuoteUpdate {
  holdingId: string;
  date: IsoDate;
  priceMicros: number;
}

/** Scrive i prezzi letti in automatico e dice quanti sono cambiati. Non si annulla: non è un'azione della persona. */
export async function recordQuotes(quotes: QuoteUpdate[], today: IsoDate): Promise<number> {
  if (quotes.length === 0) return 0;
  return db.transaction('rw', db.holdingSnapshots, async () => {
    const grouped = snapshotsByHolding(await db.holdingSnapshots.toArray());
    const changes: HoldingSnapshot[] = [];
    for (const { holdingId, date: quoteDate, priceMicros } of quotes) {
      const list = grouped.get(holdingId) ?? [];
      const latest = list.at(-1);
      // Lo strumento può essere stato eliminato mentre si leggeva il prezzo.
      if (!latest || !isMicros(priceMicros) || priceMicros === 0) continue;
      const date = quoteDate > today ? today : quoteDate;
      const sameDay = list.find((snapshot) => snapshot.date === date);
      if (sameDay) {
        if (sameDay.priceMicros !== priceMicros) changes.push({ ...sameDay, priceMicros });
      } else if (date > latest.date) {
        changes.push({ id: snapshotId(holdingId, date), holdingId, date, priceMicros });
      }
    }
    if (changes.length > 0) await db.holdingSnapshots.bulkPut(changes);
    return changes.length;
  });
}

/** Scrive le chiusure passate da `from` in poi, senza toccare quote e prezzo di acquisto delle righe che li hanno. */
export async function recordHistory(holdingId: string, points: PricePoint[], from: IsoDate, today: IsoDate): Promise<void> {
  await db.transaction('rw', db.holdings, db.holdingSnapshots, async () => {
    const holding = await db.holdings.get(holdingId);
    if (!holding) return;
    const rows = await db.holdingSnapshots.where('holdingId').equals(holdingId).toArray();
    const byDate = new Map(rows.map((row) => [row.date, row]));
    const changes = points.flatMap(({ date, priceMicros }): HoldingSnapshot[] => {
      if (date < from || date > today || !isMicros(priceMicros) || priceMicros === 0) return [];
      const sameDay = byDate.get(date);
      if (!sameDay) return [{ id: snapshotId(holdingId, date), holdingId, date, priceMicros }];
      return sameDay.priceMicros === priceMicros ? [] : [{ ...sameDay, priceMicros }];
    });
    if (changes.length > 0) await db.holdingSnapshots.bulkPut(changes);
    const historyFrom = holding.historyFrom !== undefined && holding.historyFrom < from ? holding.historyFrom : from;
    if (holding.historyFrom !== historyFrom) await db.holdings.put({ ...holding, historyFrom });
  });
}

/** Collega uno strumento alla fonte dei prezzi, completando l'ISIN se manca. */
export async function linkHolding(id: string, match: InstrumentMatch): Promise<void> {
  await db.transaction('rw', db.holdings, async () => {
    const holding = await db.holdings.get(id);
    if (holding) await db.holdings.put({ ...holding, quoteSource: match.source, isin: holding.isin || match.isin });
  });
}

/** Serve a togliere un errore di battitura dallo storico. L'ultimo con le quote resta: senza, lo strumento sparirebbe. */
export async function deleteSnapshot(id: string): Promise<Undo> {
  return db.transaction('rw', db.holdingSnapshots, async () => {
    const snapshot = await db.holdingSnapshots.get(id);
    if (!snapshot) throw new Error('L’aggiornamento non esiste più');
    const rows = await db.holdingSnapshots.where('holdingId').equals(snapshot.holdingId).toArray();
    if (hasPosition(snapshot) && rows.filter(hasPosition).length <= 1) {
      throw new Error('È l’unico aggiornamento con le quote: per toglierlo elimina lo strumento');
    }
    await db.holdingSnapshots.delete(id);
    return () => db.holdingSnapshots.add(snapshot).then(() => undefined);
  });
}
