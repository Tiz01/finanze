import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  formatDayHeading,
  formatMonthYear,
  formatShortDate,
  isValidIsoDate,
  startOfMonth,
  toIsoDate,
  todayIso,
} from './dates';

describe('data locale', () => {
  it('la mezzanotte del 1° del mese resta nel suo mese, in ogni fuso orario', () => {
    expect(toIsoDate(new Date(2026, 9, 1, 0, 0, 0))).toBe('2026-10-01');
    expect(toIsoDate(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
  });

  it("l'ultimo secondo del mese resta nel suo mese, in ogni fuso orario", () => {
    expect(toIsoDate(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
  });

  it('todayIso usa la data locale', () => {
    expect(todayIso(new Date(2026, 2, 29, 0, 30))).toBe('2026-03-29');
  });
});

describe('isValidIsoDate', () => {
  it('accetta solo date reali nel formato giusto', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('01/02/2026')).toBe(false);
    expect(isValidIsoDate('2026-2-1')).toBe(false);
    expect(isValidIsoDate(20260201)).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
  });
});

describe('calcoli sulle date', () => {
  it('addDays attraversa mesi, anni e cambi di ora legale', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('addMonths si ferma alla fine del mese', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-02-15', -3)).toBe('2025-11-15');
  });

  it('startOfMonth ed endOfMonth', () => {
    expect(startOfMonth('2026-10-30')).toBe('2026-10-01');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-12-01')).toBe('2026-12-31');
  });

  it('daysBetween conta i giorni di calendario anche col cambio di ora', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-30', '2026-10-30')).toBe(0);
    expect(daysBetween('2026-10-30', '2026-10-01')).toBe(-29);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
  });
});

describe('etichette', () => {
  const today = '2026-10-30';

  it('usa Oggi, Ieri e Domani', () => {
    expect(formatDayHeading('2026-10-30', today)).toBe('Oggi');
    expect(formatDayHeading('2026-10-29', today)).toBe('Ieri');
    expect(formatDayHeading('2026-10-31', today)).toBe('Domani');
    expect(formatShortDate('2026-10-29', today)).toBe('Ieri');
  });

  it('scrive il giorno in italiano, con la maiuscola', () => {
    expect(formatDayHeading('2026-10-26', today)).toBe('Lunedì 26 ottobre');
  });

  it("aggiunge l'anno se è diverso da quello corrente", () => {
    expect(formatDayHeading('2025-10-26', today)).toBe('Domenica 26 ottobre 2025');
    expect(formatShortDate('2026-10-26', today)).toBe('26 ott');
    expect(formatShortDate('2025-10-26', today)).toBe('26 ott 2025');
  });
});

describe('formatMonthYear', () => {
  it('scrive mese e anno in italiano, anche il primo e l’ultimo giorno', () => {
    expect(formatMonthYear('2026-10-30')).toBe('Ottobre 2026');
    expect(formatMonthYear('2026-01-01')).toBe('Gennaio 2026');
    expect(formatMonthYear('2026-12-31')).toBe('Dicembre 2026');
  });
});
