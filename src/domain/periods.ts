import { addMonths, daysBetween, endOfMonth, formatFullDate, formatMonthYear, startOfMonth } from './dates';
import type { IsoDate } from './types';

export const PERIOD_KINDS = ['mese', 'trimestre', 'anno', 'personalizzato'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export type StepPeriodKind = Exclude<PeriodKind, 'personalizzato'>;

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

const MONTHS_IN: Record<StepPeriodKind, number> = { mese: 1, trimestre: 3, anno: 12 };

/** Il periodo di calendario che contiene la data. */
export function periodRangeFor(kind: StepPeriodKind, anchor: IsoDate): DateRange {
  const month = Number(anchor.slice(5, 7));
  const firstMonth = kind === 'mese' ? month : kind === 'trimestre' ? month - ((month - 1) % 3) : 1;
  const from = `${anchor.slice(0, 4)}-${String(firstMonth).padStart(2, '0')}-01`;
  return { from, to: endOfMonth(addMonths(from, MONTHS_IN[kind] - 1)) };
}

export function shiftPeriod(kind: StepPeriodKind, anchor: IsoDate, steps: number): IsoDate {
  return addMonths(startOfMonth(anchor), MONTHS_IN[kind] * steps);
}

const SHORT_MONTH = new Intl.DateTimeFormat('it-IT', { month: 'short' });

function shortMonth(date: IsoDate): string {
  const text = SHORT_MONTH.format(new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatMonthShort(date: IsoDate): string {
  return `${shortMonth(date)} ${date.slice(0, 4)}`;
}

export function formatPeriod(kind: PeriodKind, { from, to }: DateRange): string {
  switch (kind) {
    case 'mese':
      return formatMonthYear(from);
    case 'trimestre':
      return `${shortMonth(from)}–${shortMonth(to)} ${from.slice(0, 4)}`;
    case 'anno':
      return from.slice(0, 4);
    case 'personalizzato':
      return `${formatFullDate(from)} – ${formatFullDate(to)}`;
  }
}

/** Il primo giorno di ogni mese toccato dall'intervallo. */
export function monthStarts(from: IsoDate, to: IsoDate): IsoDate[] {
  const months: IsoDate[] = [];
  for (let month = startOfMonth(from); month <= to; month = addMonths(month, 1)) months.push(month);
  return months;
}

const AVERAGE_MONTH_DAYS = 30.4375;

/** Quanti mesi vale l'intervallo: serve a confrontarlo con una media mensile. Almeno uno. */
export function periodMonths(from: IsoDate, to: IsoDate): number {
  return Math.max(1, Math.round((daysBetween(from, to) + 1) / AVERAGE_MONTH_DAYS));
}
