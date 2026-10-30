import type { IsoDate } from './types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parts(date: IsoDate): [number, number, number] {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`Data non valida: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** La data locale di un istante: mai `toISOString`, che è in UTC. */
export function toIsoDate(moment: Date): IsoDate {
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`;
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

export function isValidIsoDate(date: unknown): date is IsoDate {
  if (typeof date !== 'string' || !ISO_DATE.test(date)) return false;
  const [year, month, day] = parts(date);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

// I calcoli passano da UTC solo per non dipendere dai cambi di ora legale.
function fromUtc(moment: Date): IsoDate {
  return `${moment.getUTCFullYear()}-${pad(moment.getUTCMonth() + 1)}-${pad(moment.getUTCDate())}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [year, month, day] = parts(date);
  return fromUtc(new Date(Date.UTC(year, month - 1, day + days)));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Sposta di n mesi; il giorno si ferma all'ultimo del mese (31 gennaio + 1 mese = 28 febbraio). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = parts(date);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = first.getUTCFullYear();
  const targetMonth = first.getUTCMonth() + 1;
  return `${targetYear}-${pad(targetMonth)}-${pad(Math.min(day, daysInMonth(targetYear, targetMonth)))}`;
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const [year, month] = parts(date);
  return `${date.slice(0, 7)}-${pad(daysInMonth(year, month))}`;
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const [fromYear, fromMonth, fromDay] = parts(from);
  const [toYear, toMonth, toDay] = parts(to);
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000,
  );
}

function localDate(date: IsoDate): Date {
  const [year, month, day] = parts(date);
  return new Date(year, month - 1, day);
}

const DAY_FORMAT = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const SHORT_FORMAT = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const SHORT_YEAR_FORMAT = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });

function relativeDay(date: IsoDate, today: IsoDate): string | null {
  if (date === today) return 'Oggi';
  if (date === addDays(today, -1)) return 'Ieri';
  if (date === addDays(today, 1)) return 'Domani';
  return null;
}

export function formatDayHeading(date: IsoDate, today: IsoDate): string {
  const relative = relativeDay(date, today);
  if (relative) return relative;
  const format = date.slice(0, 4) === today.slice(0, 4) ? DAY_FORMAT : DAY_YEAR_FORMAT;
  const text = format.format(localDate(date));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatShortDate(date: IsoDate, today: IsoDate): string {
  const relative = relativeDay(date, today);
  if (relative) return relative;
  const format = date.slice(0, 4) === today.slice(0, 4) ? SHORT_FORMAT : SHORT_YEAR_FORMAT;
  return format.format(localDate(date));
}

export function formatFullDate(date: IsoDate): string {
  return SHORT_YEAR_FORMAT.format(localDate(date));
}
