import { isValidIsoDate } from '../domain/dates';
import { snapshotAt, snapshotId, snapshotsByHolding } from '../domain/investments';
import type { Holding, HoldingSnapshot, IsoDate } from '../domain/types';
import { db } from './db';
import type { Undo } from './transactions';

export interface HoldingDraft {
  accountId: string;
  instrument: string;
  isin: string;
}

export type PositionDraft = Pick<HoldingSnapshot, 'date' | 'quantityMicros' | 'avgPriceMicros' | 'priceMicros'>;

function prepareHolding(draft: HoldingDraft): HoldingDraft {
  const instrument = draft.instrument.trim();
  if (!instrument) throw new Error('Scrivi il nome dello strumento');
  if (!draft.accountId) throw new Error('Scegli il conto');
  return { accountId: draft.accountId, instrument, isin: draft.isin.trim().toUpperCase() };
}

function isMicros(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkPosition(position: PositionDraft, today: IsoDate): void {
  if (!isValidIsoDate(position.date)) throw new Error('Data non valida');
  if (position.date > today) throw new Error('La data non può essere futura');
  if (!isMicros(position.quantityMicros)) throw new Error('Quote non valide');
  if (!isMicros(position.avgPriceMicros)) throw new Error('Prezzo medio non valido');
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
    await db.holdings.put({ ...previous, ...prepared });
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

/**
 * Un solo aggiornamento al giorno per strumento: rifarlo lo corregge.
 * Quote e prezzo medio restano quelli di quella data, così si può inserire anche un prezzo passato.
 */
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
        const base = snapshotAt(list, date) ?? list[0];
        if (!base) throw new Error('Lo strumento non esiste più');
        const { avgPriceMicros, quantityMicros } = base;
        return snapshotOf(holdingId, { date, quantityMicros, avgPriceMicros, priceMicros });
      }),
    );
    return () =>
      db.transaction('rw', db.holdingSnapshots, async () => {
        await db.holdingSnapshots.bulkDelete(ids);
        await db.holdingSnapshots.bulkAdd(replaced);
      });
  });
}

/** Serve a togliere un errore di battitura dallo storico. L'ultimo rimasto resta: senza, lo strumento sparirebbe. */
export async function deleteSnapshot(id: string): Promise<Undo> {
  return db.transaction('rw', db.holdingSnapshots, async () => {
    const snapshot = await db.holdingSnapshots.get(id);
    if (!snapshot) throw new Error('L’aggiornamento non esiste più');
    const count = await db.holdingSnapshots.where('holdingId').equals(snapshot.holdingId).count();
    if (count <= 1) throw new Error('È l’unico aggiornamento: per toglierlo elimina lo strumento');
    await db.holdingSnapshots.delete(id);
    return () => db.holdingSnapshots.add(snapshot).then(() => undefined);
  });
}
