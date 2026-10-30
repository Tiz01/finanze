import { addDays, addMonths } from './dates';
import { formatCents, formatSignedCents } from './money';
import type { IsoDate, Recurring, RecurringRule, RecurringTemplate } from './types';

/**
 * L'n-esima scadenza si calcola sempre dalla prima: una ricorrenza del 31 passa dal 28 febbraio
 * e torna al 31 marzo, invece di restare ferma al 28 per sempre.
 */
export function occurrenceDate(rule: RecurringRule, index: number): IsoDate {
  const { anchorDate, frequency, interval = 1, intervalUnit = 'mesi' } = rule;
  switch (frequency) {
    case 'mensile':
      return addMonths(anchorDate, index);
    case 'annuale':
      return addMonths(anchorDate, 12 * index);
    case 'personalizzata':
      if (intervalUnit === 'giorni') return addDays(anchorDate, interval * index);
      if (intervalUnit === 'settimane') return addDays(anchorDate, 7 * interval * index);
      return addMonths(anchorDate, interval * index);
  }
}

function indexOnOrAfter(rule: RecurringRule, date: IsoDate): number {
  let index = 0;
  while (occurrenceDate(rule, index) < date) index += 1;
  return index;
}

export function firstOccurrenceOnOrAfter(rule: RecurringRule, date: IsoDate): IsoDate {
  return occurrenceDate(rule, indexOnOrAfter(rule, date));
}

export function nextOccurrence(rule: RecurringRule, after: IsoDate): IsoDate {
  const index = indexOnOrAfter(rule, after);
  const occurrence = occurrenceDate(rule, index);
  return occurrence === after ? occurrenceDate(rule, index + 1) : occurrence;
}

export interface PendingRecurring {
  recurring: Recurring;
  /** Le scadenze da gestire, dalla più vecchia: si confermano o saltano una alla volta. */
  dates: IsoDate[];
}

/** Una ricorrenza giornaliera con una data molto vecchia non deve bloccare l'apertura dell'app. */
export const MAX_PENDING_DATES = 120;

export function pendingRecurring(recurring: Recurring[], today: IsoDate): PendingRecurring[] {
  const pending: PendingRecurring[] = [];
  for (const item of recurring) {
    if (!item.active || item.nextDue > today) continue;
    const dates: IsoDate[] = [];
    let index = indexOnOrAfter(item, item.nextDue);
    let occurrence = item.nextDue;
    while (occurrence <= today && dates.length < MAX_PENDING_DATES) {
      dates.push(occurrence);
      if (occurrence === occurrenceDate(item, index)) index += 1;
      occurrence = occurrenceDate(item, index);
    }
    pending.push({ recurring: item, dates });
  }
  return pending.sort(
    (a, b) => (a.dates[0] ?? '').localeCompare(b.dates[0] ?? '') || a.recurring.name.localeCompare(b.recurring.name),
  );
}

export function pendingCount(pending: PendingRecurring[]): number {
  return pending.reduce((total, item) => total + item.dates.length, 0);
}

const UNIT_LABELS = {
  giorni: ['Ogni giorno', 'giorni'],
  settimane: ['Ogni settimana', 'settimane'],
  mesi: ['Ogni mese', 'mesi'],
} as const;

export function describeFrequency(rule: RecurringRule): string {
  if (rule.frequency === 'mensile') return 'Ogni mese';
  if (rule.frequency === 'annuale') return 'Ogni anno';
  const [single, plural] = UNIT_LABELS[rule.intervalUnit ?? 'mesi'];
  const interval = rule.interval ?? 1;
  return interval === 1 ? single : `Ogni ${interval} ${plural}`;
}

export function templateAmountText({ type, amountCents }: RecurringTemplate): string {
  if (type === 'uscita') return formatCents(-amountCents);
  if (type === 'entrata') return formatSignedCents(amountCents);
  return formatCents(amountCents);
}

export function validateRule(rule: RecurringRule): string | null {
  if (rule.frequency !== 'personalizzata') return null;
  const { interval } = rule;
  if (interval === undefined || !Number.isInteger(interval) || interval < 1 || interval > 999) {
    return 'L’intervallo deve essere un numero intero da 1 a 999';
  }
  if (!rule.intervalUnit) return 'Scegli giorni, settimane o mesi';
  return null;
}
